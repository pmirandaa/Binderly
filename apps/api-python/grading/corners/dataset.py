"""CornersDataset — converts ``LabelledGradingSample`` list into numpy arrays.

Each training sample has 1+ image URLs.  The dataset:
1. Loads images via ``ImageLoader`` (mock in CI; live behind env flag).
2. Pads or truncates to exactly ``NUM_CORNERS`` patches per sample.
3. Flattens the 4 patches into a single feature vector.

The resulting ``(X, y)`` pair is ready for ``TrainingLoop.run()``.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from grading.corners.types import NUM_CORNERS
from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.types import LabelledGradingSample


class CornersDataset:
    """Build (X, y) arrays from a list of labelled grading samples.

    Args:
        samples: Filtered list (all with ``subgrade_score`` non-null).
        image_loader: ``ImageLoader`` instance.  Defaults to mock mode.
        patch_size: Side length (pixels) for each corner crop.
    """

    def __init__(
        self,
        samples: list[LabelledGradingSample],
        image_loader: Optional[ImageLoader] = None,
        patch_size: int = 8,
    ) -> None:
        self._samples = [s for s in samples if s.is_labelled()]
        self._loader = image_loader or ImageLoader(live=False, size=patch_size)
        self._patch_size = patch_size
        self._input_dim = NUM_CORNERS * patch_size * patch_size * 3

    @property
    def input_dim(self) -> int:
        return self._input_dim

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, idx: int) -> tuple[np.ndarray, float]:
        """Return ``(feature_vector, subgrade_score)`` for one sample.

        The feature vector has shape ``(input_dim,)``; it is the concatenation
        of 4 flattened corner-patch arrays.
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
        """Load and tile exactly NUM_CORNERS patches.

        If fewer than NUM_CORNERS URLs exist, the last patch is repeated to pad.
        If more exist, only the first NUM_CORNERS are used.
        """
        if not image_urls:
            dummy_url = f"mock://no_image_{id(self)}"
            urls_to_use = [dummy_url] * NUM_CORNERS
        else:
            urls_to_use = (image_urls * NUM_CORNERS)[:NUM_CORNERS]

        patches = []
        for url in urls_to_use:
            img = self._loader.load(url)
            patches.append(img)
        return np.stack(patches, axis=0)
