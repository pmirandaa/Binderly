"""SurfaceDataset — converts ``LabelledGradingSample`` list into numpy arrays.

Data loading
------------
Surface training data is loaded through the shared
``grading.ml_common.MergedDataLoader`` keyed to the ``'surface'`` sub-grade
(``MergedDataLoader(..., subgrade_key='surface')``).  The surface label lands
in ``LabelledGradingSample.subgrade_score`` — the generic label slot shared by
all three sub-grade modules.  The parallel ``SurfaceMergedDataLoader`` that
originally lived here was folded into that single shared code path by #FU-44
(see Q-017 in open-questions.md).

The SQL equivalents for the filter the shared loader applies are:
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

from typing import Optional

import numpy as np

from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.types import LabelledGradingSample
from grading.surface.types import NUM_SURFACE_SHOTS_V1, NUM_SURFACE_SHOTS_WITH_RAKING


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
        samples: Filtered list (all with ``subgrade_score`` non-null = surface-labelled).
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
        self._samples = [s for s in samples if s.is_labelled()]
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
        """Return ``(feature_vector, subgrade_score)`` for one sample.

        The feature vector has shape ``(input_dim,)``; it is the concatenation
        of ``num_shots`` flattened image-patch arrays.
        """
        sample = self._samples[idx]
        patches = self._load_patches(sample.image_urls)
        feature = patches.flatten().astype(np.float32)
        label = float(sample.subgrade_score)  # type: ignore[arg-type]
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
