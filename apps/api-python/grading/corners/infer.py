"""CornersInferenceEngine — run corners sub-grade inference from an ONNX model.

Usage::

    from grading.corners.infer import CornersInferenceEngine

    engine = CornersInferenceEngine("corners_v0.onnx", cal_mae=0.8)
    result = engine.predict_from_uris(["file:///tmp/tl.jpg", ...], session_id="gs-001")
    print(result.aggregate)  # ConfidenceBand(value=8.5, confidence=0.72)
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

from grading.corners.types import (
    CORNER_LABELS,
    NUM_CORNERS,
    CornersPrediction,
    CornersRequest,
    CornersSubgrade,
)
from grading.ml_common.confidence import compute_confidence_band
from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.model_export import load_onnx_session, run_onnx_inference
from grading.ml_common.types import ConfidenceBand


class CornersInferenceEngine:
    """Wraps an onnxruntime ONNX session for corners inference.

    Args:
        model_path: Path to the ``.onnx`` file.
        cal_mae: Calibration MAE from the validation split — used to
            compute per-prediction confidence bands.
        patch_size: Corner-patch side length (must match training config).
        image_loader: ``ImageLoader`` instance.  Defaults to mock mode.
    """

    def __init__(
        self,
        model_path: str | Path,
        cal_mae: float = 1.0,
        patch_size: int = 8,
        image_loader: Optional[ImageLoader] = None,
    ) -> None:
        self._session = load_onnx_session(model_path)
        self._cal_mae = cal_mae
        self._patch_size = patch_size
        self._loader = image_loader or ImageLoader(live=False, size=patch_size)
        self._input_dim = NUM_CORNERS * patch_size * patch_size * 3

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Run raw inference on a pre-built feature matrix.

        Args:
            X: ``(N, input_dim)`` float32 array.

        Returns:
            ``(N,)`` predicted sub-grade scores.
        """
        outputs = run_onnx_inference(self._session, X)
        return outputs.flatten()

    def predict_from_request(self, request: CornersRequest) -> CornersPrediction:
        """Run inference from a ``CornersRequest``.

        Loads images, builds feature vector, runs inference, computes
        per-corner and aggregate confidence bands.
        """
        return self._predict_from_uris(request.corner_uris, request.session_id)

    def predict_from_uris(
        self,
        corner_uris: list[str],
        session_id: str = "",
    ) -> CornersPrediction:
        """Convenience wrapper — build a ``CornersRequest`` and predict."""
        request = CornersRequest(session_id=session_id, corner_uris=corner_uris)
        return self.predict_from_request(request)

    def _predict_from_uris(
        self,
        corner_uris: list[str],
        session_id: str,
    ) -> CornersPrediction:
        patches = np.stack(
            [self._loader.load(url) for url in corner_uris], axis=0
        )
        feature = patches.flatten().astype(np.float32)[np.newaxis, :]
        raw_scores = self.predict(feature)

        per_corner: list[CornersSubgrade] = []
        for i, label in enumerate(CORNER_LABELS):
            score_i = float(np.clip(raw_scores[0], 1.0, 10.0))
            band = compute_confidence_band(score_i, cal_mae=self._cal_mae)
            per_corner.append(CornersSubgrade(label=label, band=band))

        weakest_value = min(c.band.value for c in per_corner)
        avg_confidence = float(np.mean([c.band.confidence for c in per_corner]))
        aggregate = ConfidenceBand(
            value=float(np.clip(weakest_value, 1.0, 10.0)),
            confidence=float(np.clip(avg_confidence, 0.0, 1.0)),
        )

        return CornersPrediction(
            session_id=session_id,
            per_corner=per_corner,
            aggregate=aggregate,
        )
