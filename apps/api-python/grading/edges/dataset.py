"""EdgesDataset + EdgesMergedDataLoader.

EdgesMergedDataLoader
~~~~~~~~~~~~~~~~~~~~~
Reads from the same three scraper table row formats as ``ml_common``'s
``MergedDataLoader`` but extracts the ``edges`` sub-grade label instead of
``corners``.  Introduced here rather than patching ml_common because
T-GR-SURFACE runs in parallel and may want a different generalisation
(see Q-44 in open-questions.md).

EdgesDataset
~~~~~~~~~~~~
Converts ``EdgesLabelledSample`` list into numpy ``(X, y)`` arrays.

Each training sample has 1+ image URLs.  The dataset:
1. Loads images via ``ImageLoader`` (mock in CI; live behind env flag).
2. Pads or truncates to exactly ``NUM_STRIPS`` images per sample.
3. Flattens the 4 strip arrays into a single feature vector.

The resulting ``(X, y)`` pair is ready for ``TrainingLoop.run()``.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from grading.edges.types import EdgesLabelledSample, NUM_STRIPS
from grading.ml_common.image_loader import ImageLoader


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------


class _EdgesPSALoader:
    """Extract edges-labelled samples from ``grading_training_sample`` rows."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[EdgesLabelledSample]:
        samples: list[EdgesLabelledSample] = []
        for row in self._rows:
            if row.get("grade_company") != "PSA":
                continue
            subgrades: dict = row.get("subgrades") or {}
            edges_score = _to_float(subgrades.get("edges"))
            images: dict = row.get("images") or {}
            urls: list[str] = [v for v in images.values() if isinstance(v, str)]
            edge_arr = images.get("edges")
            if isinstance(edge_arr, list):
                urls.extend(str(u) for u in edge_arr if u)
            samples.append(
                EdgesLabelledSample(
                    source="psa_cert",
                    source_id=str(row.get("source_id", "")),
                    grade_company="PSA",
                    overall_grade=_to_float(row.get("grade")),
                    edges_score=edges_score,
                    image_urls=urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata=row.get("raw_metadata") or {},
                )
            )
        return samples


class _EdgesEbayLoader:
    """Extract edges-labelled samples from ``ebay_graded_listing_observation`` rows."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[EdgesLabelledSample]:
        samples: list[EdgesLabelledSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            edges_score = _to_float(sub.get("edges"))
            thumbnail = row.get("thumbnail_url")
            urls: list[str] = [thumbnail] if thumbnail else []
            company = row.get("parsed_grading_company") or "OTHER"
            samples.append(
                EdgesLabelledSample(
                    source="ebay_sold",
                    source_id=str(row.get("listing_id", "")),
                    grade_company=company,
                    overall_grade=_to_float(row.get("parsed_overall_grade")),
                    edges_score=edges_score,
                    image_urls=urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata={"title": row.get("title", "")},
                )
            )
        return samples


class _EdgesAuctionLoader:
    """Extract edges-labelled samples from ``auction_lot_observation`` rows."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[EdgesLabelledSample]:
        samples: list[EdgesLabelledSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            edges_score = _to_float(sub.get("edges"))
            image_urls: list[str] = list(row.get("lot_image_urls") or [])
            house = row.get("auction_house") or "unknown"
            source = f"auction_{house}"
            company = row.get("parsed_grading_company") or "OTHER"
            samples.append(
                EdgesLabelledSample(
                    source=source,
                    source_id=str(row.get("lot_id", "")),
                    grade_company=company,
                    overall_grade=_to_float(row.get("parsed_overall_grade")),
                    edges_score=edges_score,
                    image_urls=image_urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata={"lot_title": row.get("lot_title", "")},
                )
            )
        return samples


class EdgesMergedDataLoader:
    """Union of PSA + eBay + Auction loaders, filtered by ``edges_score``.

    Args:
        psa_rows: ``grading_training_sample`` rows (source='psa_cert').
        ebay_rows: ``ebay_graded_listing_observation`` rows.
        auction_rows: ``auction_lot_observation`` rows.
    """

    def __init__(
        self,
        psa_rows: list[dict[str, Any]],
        ebay_rows: list[dict[str, Any]],
        auction_rows: list[dict[str, Any]],
    ) -> None:
        self._psa = _EdgesPSALoader(psa_rows)
        self._ebay = _EdgesEbayLoader(ebay_rows)
        self._auction = _EdgesAuctionLoader(auction_rows)

    def load_all(self) -> list[EdgesLabelledSample]:
        """Return all samples regardless of label availability."""
        return self._psa.load() + self._ebay.load() + self._auction.load()

    def load_labelled(self) -> list[EdgesLabelledSample]:
        """Return only samples with a non-null ``edges_score``."""
        return [s for s in self.load_all() if s.is_labelled_for_edges()]

    def load(self) -> list[EdgesLabelledSample]:
        return self.load_labelled()

    def __len__(self) -> int:
        return len(self.load_labelled())


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class EdgesDataset:
    """Build (X, y) arrays from a list of edges-labelled grading samples.

    Each sample contributes one row to the feature matrix.  Four strip images
    are loaded per sample (or synthesised from available URLs), each resized to
    ``patch_size × patch_size`` by ``ImageLoader``, then flattened and
    concatenated.

    Feature vector shape: ``(NUM_STRIPS * patch_size * patch_size * 3,)``
    Label: ``edges_score`` (float in [1.0, 10.0]).

    Args:
        samples: Filtered list — all must have ``edges_score`` non-null.
        image_loader: ``ImageLoader`` instance.  Defaults to mock mode.
        patch_size: Side length (pixels) for each strip representation.
    """

    def __init__(
        self,
        samples: list[EdgesLabelledSample],
        image_loader: Optional[ImageLoader] = None,
        patch_size: int = 8,
    ) -> None:
        self._samples = [s for s in samples if s.is_labelled_for_edges()]
        self._loader = image_loader or ImageLoader(live=False, size=patch_size)
        self._patch_size = patch_size
        self._input_dim = NUM_STRIPS * patch_size * patch_size * 3

    @property
    def input_dim(self) -> int:
        return self._input_dim

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, idx: int) -> tuple[np.ndarray, float]:
        """Return ``(feature_vector, edges_score)`` for one sample.

        The feature vector has shape ``(input_dim,)``; it is the concatenation
        of 4 flattened strip arrays.
        """
        sample = self._samples[idx]
        strips = self._load_strips(sample.image_urls)
        feature = strips.flatten().astype(np.float32)
        label = float(sample.edges_score)  # type: ignore[arg-type]
        return feature, label

    def build_arrays(self) -> tuple[np.ndarray, np.ndarray]:
        """Build the full ``(X, y)`` matrices for training.

        Returns:
            X: ``(N, input_dim)`` float32 feature matrix.
            y: ``(N,)`` float32 target vector.
        """
        if not self._samples:
            return (
                np.zeros((0, self._input_dim), dtype=np.float32),
                np.zeros(0, dtype=np.float32),
            )
        X_rows: list[np.ndarray] = []
        y_vals: list[float] = []
        for feature, label in (self[i] for i in range(len(self))):
            X_rows.append(feature)
            y_vals.append(label)
        return np.stack(X_rows, axis=0), np.array(y_vals, dtype=np.float32)

    def _load_strips(self, image_urls: list[str]) -> np.ndarray:
        """Load and tile exactly NUM_STRIPS strip images.

        If fewer than NUM_STRIPS URLs are available, the last is repeated.
        If more are available, only the first NUM_STRIPS are used.
        """
        if not image_urls:
            dummy_url = f"mock://no_image_{id(self)}"
            urls_to_use = [dummy_url] * NUM_STRIPS
        else:
            urls_to_use = (image_urls * NUM_STRIPS)[:NUM_STRIPS]

        strips = []
        for url in urls_to_use:
            img = self._loader.load(url)
            strips.append(img)
        return np.stack(strips, axis=0)


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
