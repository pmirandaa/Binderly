"""EdgesInferenceEngine — run edges sub-grade inference from an ONNX model.

Usage::

    from grading.edges.infer import EdgesInferenceEngine

    engine = EdgesInferenceEngine("edges_v0.onnx", cal_mae=0.8)
    result = engine.predict_from_uris(["file:///tmp/top.jpg", ...], session_id="gs-001")
    print(result.aggregate)  # ConfidenceBand(value=8.5, confidence=0.72)
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

from grading.edges.types import (
    STRIP_LABELS,
    NUM_STRIPS,
    EdgesRequest,
    EdgesPrediction,
    EdgesSubgrade,
)
from grading.ml_common.confidence import compute_confidence_band
from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.model_export import load_onnx_session, run_onnx_inference
from grading.ml_common.types import ConfidenceBand


class EdgesInferenceEngine:
    """Wraps an onnxruntime ONNX session for edges inference.

    Args:
        model_path: Path to the ``.onnx`` file.
        cal_mae: Calibration MAE from the validation split — used to
            compute per-prediction confidence bands.
        patch_size: Strip patch side length (must match training config).
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
        self._input_dim = NUM_STRIPS * patch_size * patch_size * 3

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Run raw inference on a pre-built feature matrix.

        Args:
            X: ``(N, input_dim)`` float32 array.

        Returns:
            ``(N,)`` predicted sub-grade scores.
        """
        outputs = run_onnx_inference(self._session, X)
        return outputs.flatten()

    def predict_from_request(self, request: EdgesRequest) -> EdgesPrediction:
        """Run inference from an ``EdgesRequest``.

        Loads strip images, builds feature vector, runs inference, computes
        per-strip and aggregate confidence bands.
        """
        return self._predict_from_uris(request.strip_uris, request.session_id)

    def predict_from_uris(
        self,
        strip_uris: list[str],
        session_id: str = "",
    ) -> EdgesPrediction:
        """Convenience wrapper — build an ``EdgesRequest`` and predict."""
        request = EdgesRequest(session_id=session_id, strip_uris=strip_uris)
        return self.predict_from_request(request)

    def _predict_from_uris(
        self,
        strip_uris: list[str],
        session_id: str,
    ) -> EdgesPrediction:
        strips = np.stack(
            [self._loader.load(url) for url in strip_uris], axis=0
        )
        feature = strips.flatten().astype(np.float32)[np.newaxis, :]
        raw_scores = self.predict(feature)

        per_edge: list[EdgesSubgrade] = []
        for i, label in enumerate(STRIP_LABELS):
            score_i = float(np.clip(raw_scores[0], 1.0, 10.0))
            band = compute_confidence_band(score_i, cal_mae=self._cal_mae)
            per_edge.append(EdgesSubgrade(label=label, band=band))

        weakest_value = min(e.band.value for e in per_edge)
        avg_confidence = float(np.mean([e.band.confidence for e in per_edge]))
        aggregate = ConfidenceBand(
            value=float(np.clip(weakest_value, 1.0, 10.0)),
            confidence=float(np.clip(avg_confidence, 0.0, 1.0)),
        )

        return EdgesPrediction(
            session_id=session_id,
            per_edge=per_edge,
            aggregate=aggregate,
        )
