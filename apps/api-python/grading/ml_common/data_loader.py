"""Data loaders for the three grading scraper table shapes.

Each loader normalises rows from its source table into ``LabelledGradingSample``.
``MergedDataLoader`` unions all three sources and filters to rows labelled for
the requested sub-grade (default: ``'corners'``).

In production the loaders would receive database rows (dicts from psycopg /
asyncpg / Supabase REST). For testing they accept in-memory lists of dicts,
making them fully mockable without a DB connection.

Schema references
-----------------
- ``grading_training_sample`` (source='psa_cert', grade_company='PSA'):
    subgrades JSONB → {corners: float, ...}, images JSONB → {front: str, ...}
- ``ebay_graded_listing_observation``:
    parsed_sub_grades JSONB → {corners: float, ...}, thumbnail_url text
- ``auction_lot_observation``:
    parsed_sub_grades JSONB → {corners: float, ...}, lot_image_urls text[]
"""

from __future__ import annotations

from typing import Any

from grading.ml_common.types import LabelledGradingSample


# ---------------------------------------------------------------------------
# PSA loader — reads grading_training_sample rows (source = psa_cert)
# ---------------------------------------------------------------------------


class PSADataLoader:
    """Load PSA cert rows from ``grading_training_sample``.

    Args:
        rows: List of dicts matching the ``grading_training_sample`` column map.
            In production, supply rows fetched from the DB.  In tests, supply
            synthetic dicts.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            if row.get("grade_company") != "PSA":
                continue
            subgrades: dict = row.get("subgrades") or {}
            corners_score = subgrades.get("corners")
            images: dict = row.get("images") or {}
            urls: list[str] = [v for v in images.values() if isinstance(v, str)]
            corners_arr = images.get("corners")
            if isinstance(corners_arr, list):
                urls.extend(str(u) for u in corners_arr if u)
            samples.append(
                LabelledGradingSample(
                    source="psa_cert",
                    source_id=str(row.get("source_id", "")),
                    grade_company="PSA",
                    overall_grade=_to_float(row.get("grade")),
                    corners_score=_to_float(corners_score),
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
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            corners_score = sub.get("corners")
            thumbnail = row.get("thumbnail_url")
            urls: list[str] = [thumbnail] if thumbnail else []
            company = row.get("parsed_grading_company") or "OTHER"
            samples.append(
                LabelledGradingSample(
                    source="ebay_sold",
                    source_id=str(row.get("listing_id", "")),
                    grade_company=company,
                    overall_grade=_to_float(row.get("parsed_overall_grade")),
                    corners_score=_to_float(corners_score),
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
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            corners_score = sub.get("corners")
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
                    corners_score=_to_float(corners_score),
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
    """Union of PSA + eBay + Auction loaders, filtered by sub-grade column.

    Args:
        psa_rows: ``grading_training_sample`` rows (PSA).
        ebay_rows: ``ebay_graded_listing_observation`` rows.
        auction_rows: ``auction_lot_observation`` rows.
        subgrade_column: Which sub-grade label to filter on.  Rows that lack
            a non-null value for this sub-grade are excluded from the labelled
            subset returned by ``load_labelled()``.
    """

    def __init__(
        self,
        psa_rows: list[dict[str, Any]],
        ebay_rows: list[dict[str, Any]],
        auction_rows: list[dict[str, Any]],
        subgrade_column: str = "corners",
    ) -> None:
        self._psa = PSADataLoader(psa_rows)
        self._ebay = EbayDataLoader(ebay_rows)
        self._auction = AuctionDataLoader(auction_rows)
        self._subgrade_column = subgrade_column

    def load_all(self) -> list[LabelledGradingSample]:
        """Return all samples regardless of label availability."""
        return self._psa.load() + self._ebay.load() + self._auction.load()

    def load_labelled(self) -> list[LabelledGradingSample]:
        """Return only samples with a non-null ``corners_score`` (or the
        requested sub-grade column for future sub-grades).

        For T-GR-CORNERS the filter is always on ``corners_score``.
        T-GR-EDGES / T-GR-SURFACE subclass or parameterise differently.
        """
        return [s for s in self.load_all() if s.is_labelled_for_corners()]

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
