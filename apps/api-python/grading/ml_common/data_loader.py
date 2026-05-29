"""Data loaders for the three grading scraper table shapes.

Each loader normalises rows from its source table into ``LabelledGradingSample``.
``MergedDataLoader`` unions all three sources and filters to rows labelled for
the requested sub-grade.

The sub-grade to extract is parameterised by ``subgrade_key`` (one of
``'corners'`` / ``'edges'`` / ``'surface'``; default ``'corners'``).  This is
the single shared code path for all three sub-grade models — corners, edges,
and surface each instantiate ``MergedDataLoader(..., subgrade_key=...)`` rather
than maintaining a parallel loader (see #FU-44 / Q-017).

In production the loaders would receive database rows (dicts from psycopg /
asyncpg / Supabase REST). For testing they accept in-memory lists of dicts,
making them fully mockable without a DB connection.

Schema references
-----------------
- ``grading_training_sample`` (source='psa_cert', grade_company='PSA'):
    subgrades JSONB → {<subgrade_key>: float, ...},
    images JSONB → {front: str, ..., <subgrade_key>: str[]}
- ``ebay_graded_listing_observation``:
    parsed_sub_grades JSONB → {<subgrade_key>: float, ...}, thumbnail_url text
- ``auction_lot_observation``:
    parsed_sub_grades JSONB → {<subgrade_key>: float, ...}, lot_image_urls text[]
"""

from __future__ import annotations

from typing import Any, Literal

from grading.ml_common.types import LabelledGradingSample

# The sub-grade label keys understood by every loader.  These match the JSON
# keys used in ``subgrades`` / ``parsed_sub_grades`` across all three scraper
# tables (see schema references above).
SubgradeKey = Literal["corners", "edges", "surface"]


# ---------------------------------------------------------------------------
# PSA loader — reads grading_training_sample rows (source = psa_cert)
# ---------------------------------------------------------------------------


class PSADataLoader:
    """Load PSA cert rows from ``grading_training_sample``.

    Args:
        rows: List of dicts matching the ``grading_training_sample`` column map.
            In production, supply rows fetched from the DB.  In tests, supply
            synthetic dicts.
        subgrade_key: Which sub-grade label to extract from ``subgrades``
            (and which per-subgrade image array to append from ``images``).
    """

    def __init__(
        self, rows: list[dict[str, Any]], subgrade_key: SubgradeKey = "corners"
    ) -> None:
        self._rows = rows
        self._subgrade_key = subgrade_key

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            if row.get("grade_company") != "PSA":
                continue
            subgrades: dict = row.get("subgrades") or {}
            subgrade_score = subgrades.get(self._subgrade_key)
            images: dict = row.get("images") or {}
            urls: list[str] = [v for v in images.values() if isinstance(v, str)]
            subgrade_arr = images.get(self._subgrade_key)
            if isinstance(subgrade_arr, list):
                urls.extend(str(u) for u in subgrade_arr if u)
            samples.append(
                LabelledGradingSample(
                    source="psa_cert",
                    source_id=str(row.get("source_id", "")),
                    grade_company="PSA",
                    overall_grade=_to_float(row.get("grade")),
                    subgrade_score=_to_float(subgrade_score),
                    image_urls=urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata=row.get("raw_metadata") or {},
                )
            )
        return samples

    def __len__(self) -> int:
        return len([r for r in self._rows if r.get("grade_company") == "PSA"])


# ---------------------------------------------------------------------------
# eBay loader — reads ebay_graded_listing_observation rows
# ---------------------------------------------------------------------------


class EbayDataLoader:
    """Load eBay sold-listing rows from ``ebay_graded_listing_observation``.

    Args:
        rows: List of dicts matching the ``ebay_graded_listing_observation`` schema.
        subgrade_key: Which sub-grade label to extract from ``parsed_sub_grades``.
    """

    def __init__(
        self, rows: list[dict[str, Any]], subgrade_key: SubgradeKey = "corners"
    ) -> None:
        self._rows = rows
        self._subgrade_key = subgrade_key

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            subgrade_score = sub.get(self._subgrade_key)
            thumbnail = row.get("thumbnail_url")
            urls: list[str] = [thumbnail] if thumbnail else []
            company = row.get("parsed_grading_company") or "OTHER"
            samples.append(
                LabelledGradingSample(
                    source="ebay_sold",
                    source_id=str(row.get("listing_id", "")),
                    grade_company=company,
                    overall_grade=_to_float(row.get("parsed_overall_grade")),
                    subgrade_score=_to_float(subgrade_score),
                    image_urls=urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata={"title": row.get("title", "")},
                )
            )
        return samples

    def __len__(self) -> int:
        return len(self._rows)


# ---------------------------------------------------------------------------
# Auction loader — reads auction_lot_observation rows
# ---------------------------------------------------------------------------


class AuctionDataLoader:
    """Load auction lot rows from ``auction_lot_observation``.

    ``auction_house`` ('pwcc' | 'goldin') is stored in the source field.

    Args:
        rows: List of dicts matching the ``auction_lot_observation`` schema.
        subgrade_key: Which sub-grade label to extract from ``parsed_sub_grades``.
    """

    def __init__(
        self, rows: list[dict[str, Any]], subgrade_key: SubgradeKey = "corners"
    ) -> None:
        self._rows = rows
        self._subgrade_key = subgrade_key

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            subgrade_score = sub.get(self._subgrade_key)
            image_urls: list[str] = list(row.get("lot_image_urls") or [])
            house = row.get("auction_house") or "unknown"
            source = f"auction_{house}"
            company = row.get("parsed_grading_company") or "OTHER"
            samples.append(
                LabelledGradingSample(
                    source=source,
                    source_id=str(row.get("lot_id", "")),
                    grade_company=company,
                    overall_grade=_to_float(row.get("parsed_overall_grade")),
                    subgrade_score=_to_float(subgrade_score),
                    image_urls=image_urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata={"lot_title": row.get("lot_title", "")},
                )
            )
        return samples

    def __len__(self) -> int:
        return len(self._rows)


# ---------------------------------------------------------------------------
# Merged loader
# ---------------------------------------------------------------------------


class MergedDataLoader:
    """Union of PSA + eBay + Auction loaders, keyed to one sub-grade.

    This is the shared loader for all three sub-grade models.  Pass
    ``subgrade_key='corners' | 'edges' | 'surface'`` to select which label
    column every underlying loader extracts; ``load_labelled()`` then returns
    only the rows that carry a non-null value for that sub-grade.

    Args:
        psa_rows: ``grading_training_sample`` rows (PSA).
        ebay_rows: ``ebay_graded_listing_observation`` rows.
        auction_rows: ``auction_lot_observation`` rows.
        subgrade_key: Which sub-grade label to extract + filter on.  Rows that
            lack a non-null value for this sub-grade are excluded from the
            labelled subset returned by ``load_labelled()``.
    """

    def __init__(
        self,
        psa_rows: list[dict[str, Any]],
        ebay_rows: list[dict[str, Any]],
        auction_rows: list[dict[str, Any]],
        subgrade_key: SubgradeKey = "corners",
    ) -> None:
        self._psa = PSADataLoader(psa_rows, subgrade_key)
        self._ebay = EbayDataLoader(ebay_rows, subgrade_key)
        self._auction = AuctionDataLoader(auction_rows, subgrade_key)
        self._subgrade_key = subgrade_key

    @property
    def subgrade_key(self) -> SubgradeKey:
        return self._subgrade_key

    def load_all(self) -> list[LabelledGradingSample]:
        """Return all samples regardless of label availability."""
        return self._psa.load() + self._ebay.load() + self._auction.load()

    def load_labelled(self) -> list[LabelledGradingSample]:
        """Return only samples carrying a non-null label for ``subgrade_key``."""
        return [s for s in self.load_all() if s.is_labelled()]

    def load(self) -> list[LabelledGradingSample]:
        return self.load_labelled()

    def __len__(self) -> int:
        return len(self.load_labelled())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
