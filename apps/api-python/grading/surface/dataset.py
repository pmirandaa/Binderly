"""SurfaceDataset — converts ``LabelledGradingSample`` list into numpy arrays.

Data loading
------------
``SurfaceMergedDataLoader`` reads raw DB row dicts from all three scraper
tables and normalises them into ``LabelledGradingSample`` objects with the
surface score stored in ``corners_score``.  (The field is named
``corners_score`` because that is the only numeric label slot in the shared
``LabelledGradingSample`` type in ml_common.  This naming mismatch is tracked
as #FU-44 and will be fixed with a rename once all sub-grade tasks merge.)

The SQL equivalents for the filter applied here are:
- PSA: ``subgrades->>'surface' IS NOT NULL``
- eBay / auctions: ``parsed_sub_grades->>'surface' IS NOT NULL``

Feature construction
---------------------
Each training sample produces a flat feature vector of shape
``(NUM_SURFACE_SHOTS_V1 * patch_size * patch_size * 3,)``.

v1 always uses 2 shots (frontFull + backFull).  Image URLs are drawn from the
sample's ``image_urls`` list; if fewer than 2 are available the last URL is
repeated to pad (consistent with CornersDataset behaviour).

Raking-light awareness
-----------------------
The dataset builds v1 feature vectors only.  When #FU-31 lands and training
data includes a third shot, ``SurfaceDataset`` can be instantiated with
``num_shots=NUM_SURFACE_SHOTS_WITH_RAKING`` to switch to 3-shot features.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.types import LabelledGradingSample
from grading.surface.types import NUM_SURFACE_SHOTS_V1, NUM_SURFACE_SHOTS_WITH_RAKING


# ---------------------------------------------------------------------------
# Surface-specific data loaders
# ---------------------------------------------------------------------------


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class _SurfacePSALoader:
    """Normalise ``grading_training_sample`` rows for surface training.

    Reads ``subgrades->>'surface'`` and stores it in ``corners_score``
    (the generic label slot in ``LabelledGradingSample``).
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            if row.get("grade_company") != "PSA":
                continue
            subgrades: dict = row.get("subgrades") or {}
            surface_score = _to_float(subgrades.get("surface"))
            images: dict = row.get("images") or {}
            urls: list[str] = [v for v in images.values() if isinstance(v, str)]
            samples.append(
                LabelledGradingSample(
                    source="psa_cert",
                    source_id=str(row.get("source_id", "")),
                    grade_company="PSA",
                    overall_grade=_to_float(row.get("grade")),
                    corners_score=surface_score,
                    image_urls=urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata=row.get("raw_metadata") or {},
                )
            )
        return samples


class _SurfaceEbayLoader:
    """Normalise ``ebay_graded_listing_observation`` rows for surface training."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            surface_score = _to_float(sub.get("surface"))
            thumbnail = row.get("thumbnail_url")
            urls: list[str] = [thumbnail] if thumbnail else []
            company = row.get("parsed_grading_company") or "OTHER"
            samples.append(
                LabelledGradingSample(
                    source="ebay_sold",
                    source_id=str(row.get("listing_id", "")),
                    grade_company=company,
                    overall_grade=_to_float(row.get("parsed_overall_grade")),
                    corners_score=surface_score,
                    image_urls=urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata={"title": row.get("title", "")},
                )
            )
        return samples


class _SurfaceAuctionLoader:
    """Normalise ``auction_lot_observation`` rows for surface training."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def load(self) -> list[LabelledGradingSample]:
        samples: list[LabelledGradingSample] = []
        for row in self._rows:
            sub: dict = row.get("parsed_sub_grades") or {}
            surface_score = _to_float(sub.get("surface"))
            image_urls: list[str] = list(row.get("lot_image_urls") or [])
            house = row.get("auction_house") or "unknown"
            company = row.get("parsed_grading_company") or "OTHER"
            samples.append(
                LabelledGradingSample(
                    source=f"auction_{house}",
                    source_id=str(row.get("lot_id", "")),
                    grade_company=company,
                    overall_grade=_to_float(row.get("parsed_overall_grade")),
                    corners_score=surface_score,
                    image_urls=image_urls,
                    printing_id=row.get("printing_id"),
                    raw_metadata={"lot_title": row.get("lot_title", "")},
                )
            )
        return samples


class SurfaceMergedDataLoader:
    """Union of PSA + eBay + Auction loaders, filtered to surface-labelled rows.

    Reads ``subgrades->>'surface'`` (PSA) and ``parsed_sub_grades->>'surface'``
    (eBay + auctions) from raw rows.  The surface score is stored in
    ``LabelledGradingSample.corners_score`` — the generic label slot shared by
    all sub-grade modules (naming tracked as #FU-44).

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
        self._psa = _SurfacePSALoader(psa_rows)
        self._ebay = _SurfaceEbayLoader(ebay_rows)
        self._auction = _SurfaceAuctionLoader(auction_rows)

    def load_all(self) -> list[LabelledGradingSample]:
        """Return all samples regardless of surface label availability."""
        return self._psa.load() + self._ebay.load() + self._auction.load()

    def load_labelled(self) -> list[LabelledGradingSample]:
        """Return only samples with a non-null surface score."""
        return [s for s in self.load_all() if s.corners_score is not None]

    def load(self) -> list[LabelledGradingSample]:
        return self.load_labelled()

    def __len__(self) -> int:
        return len(self.load_labelled())


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class SurfaceDataset:
    """Build (X, y) arrays from a list of labelled grading samples.

    Feature vectors are flat concatenations of ``num_shots`` image patches,
    each of size ``patch_size * patch_size * 3`` channels.

    v1 (default): ``num_shots = NUM_SURFACE_SHOTS_V1 = 2`` (frontFull + backFull).
    FU-31 path:   ``num_shots = NUM_SURFACE_SHOTS_WITH_RAKING = 3``.

    Image URLs from the sample are used in order; if fewer than ``num_shots``
    are available, the last URL is repeated to pad (same strategy as CornersDataset).

    Args:
        samples: Filtered list (all with ``corners_score`` non-null = surface-labelled).
        image_loader: ``ImageLoader`` instance. Defaults to mock mode.
        patch_size: Side length (pixels) for each image patch.
        num_shots: Number of shots to include in the feature vector (2 or 3).
    """

    def __init__(
        self,
        samples: list[LabelledGradingSample],
        image_loader: Optional[ImageLoader] = None,
        patch_size: int = 8,
        num_shots: int = NUM_SURFACE_SHOTS_V1,
    ) -> None:
        if num_shots not in (NUM_SURFACE_SHOTS_V1, NUM_SURFACE_SHOTS_WITH_RAKING):
            raise ValueError(
                f"num_shots must be {NUM_SURFACE_SHOTS_V1} (v1) or "
                f"{NUM_SURFACE_SHOTS_WITH_RAKING} (with raking light), got {num_shots}"
            )
        self._samples = [s for s in samples if s.corners_score is not None]
        self._loader = image_loader or ImageLoader(live=False, size=patch_size)
        self._patch_size = patch_size
        self._num_shots = num_shots
        self._input_dim = num_shots * patch_size * patch_size * 3

    @property
    def input_dim(self) -> int:
        return self._input_dim

    @property
    def num_shots(self) -> int:
        return self._num_shots

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, idx: int) -> tuple[np.ndarray, float]:
        """Return ``(feature_vector, surface_score)`` for one sample.

        The feature vector has shape ``(input_dim,)``; it is the concatenation
        of ``num_shots`` flattened image-patch arrays.
        """
        sample = self._samples[idx]
        patches = self._load_patches(sample.image_urls)
        feature = patches.flatten().astype(np.float32)
        label = float(sample.corners_score)  # type: ignore[arg-type]
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

    def _load_patches(self, image_urls: list[str]) -> np.ndarray:
        """Load and tile exactly ``num_shots`` patches.

        If fewer than ``num_shots`` URLs exist, the last patch is repeated to pad.
        If more exist, only the first ``num_shots`` are used.
        """
        if not image_urls:
            dummy_url = f"mock://no_image_{id(self)}"
            urls_to_use = [dummy_url] * self._num_shots
        else:
            urls_to_use = (image_urls * self._num_shots)[: self._num_shots]

        patches = [self._loader.load(url) for url in urls_to_use]
        return np.stack(patches, axis=0)
