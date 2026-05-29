"""EdgesDataset — converts ``LabelledGradingSample`` list into numpy arrays.

Edges training data is loaded through the shared
``grading.ml_common.MergedDataLoader`` keyed to the ``'edges'`` sub-grade
(``MergedDataLoader(..., subgrade_key='edges')``).  The parallel
``EdgesMergedDataLoader`` that originally lived here was folded into that single
shared code path by #FU-44 (see Q-017 in open-questions.md).

EdgesDataset
~~~~~~~~~~~~
Converts a ``LabelledGradingSample`` list into numpy ``(X, y)`` arrays.

Each training sample has 1+ image URLs.  The dataset:
1. Loads images via ``ImageLoader`` (mock in CI; live behind env flag).
2. Pads or truncates to exactly ``NUM_STRIPS`` images per sample.
3. Flattens the 4 strip arrays into a single feature vector.

The resulting ``(X, y)`` pair is ready for ``TrainingLoop.run()``.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from grading.edges.types import NUM_STRIPS
from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.types import LabelledGradingSample


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
    Label: ``subgrade_score`` (float in [1.0, 10.0]) — the edges sub-grade
    when the producing loader was keyed to ``'edges'``.

    Args:
        samples: Filtered list — all must have ``subgrade_score`` non-null.
        image_loader: ``ImageLoader`` instance.  Defaults to mock mode.
        patch_size: Side length (pixels) for each strip representation.
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
        self._input_dim = NUM_STRIPS * patch_size * patch_size * 3

    @property
    def input_dim(self) -> int:
        return self._input_dim

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, idx: int) -> tuple[np.ndarray, float]:
        """Return ``(feature_vector, subgrade_score)`` for one sample.

        The feature vector has shape ``(input_dim,)``; it is the concatenation
        of 4 flattened strip arrays.
        """
        sample = self._samples[idx]
        strips = self._load_strips(sample.image_urls)
        feature = strips.flatten().astype(np.float32)
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
