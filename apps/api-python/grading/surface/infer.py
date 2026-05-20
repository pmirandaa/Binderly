"""SurfaceInferenceEngine — run surface sub-grade inference from an ONNX model.

Usage::

    from grading.surface.infer import SurfaceInferenceEngine

    engine = SurfaceInferenceEngine("surface_v0.onnx", cal_mae=0.9)
    result = engine.predict_from_request(
        SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///tmp/front.jpg",
            back_full_uri="file:///tmp/back.jpg",
        )
    )
    print(result.aggregate)  # ConfidenceBand(value=8.5, confidence=0.67)

Raking-light path (post-#FU-31)
---------------------------------
Pass ``raking_light_uri`` in ``SurfaceRequest`` and the engine automatically
switches to the 3-shot path.  The ONNX model artifact must have been exported
with ``input_dim = NUM_SURFACE_SHOTS_WITH_RAKING * patch_size * patch_size * 3``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

from grading.ml_common.confidence import compute_confidence_band
from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.model_export import load_onnx_session, run_onnx_inference
from grading.ml_common.types import ConfidenceBand
from grading.surface.types import (
    NUM_SURFACE_SHOTS_V1,
    SurfacePrediction,
    SurfaceRequest,
    SurfaceShotPrediction,
)


class SurfaceInferenceEngine:
    """Wraps an onnxruntime ONNX session for surface inference.

    Args:
        model_path: Path to the ``.onnx`` file.
        cal_mae: Calibration MAE from the validation split — used to compute
            per-prediction confidence bands.
        patch_size: Image patch side length (must match training config).
        num_shots: Number of input shots the model was trained with (2 = v1).
            Must match the ONNX model's input dimension.
        image_loader: ``ImageLoader`` instance.  Defaults to mock mode.
    """

    def __init__(
        self,
        model_path: str | Path,
        cal_mae: float = 1.0,
        patch_size: int = 8,
        num_shots: int = NUM_SURFACE_SHOTS_V1,
        image_loader: Optional[ImageLoader] = None,
    ) -> None:
        self._session = load_onnx_session(model_path)
        self._cal_mae = cal_mae
        self._patch_size = patch_size
        self._num_shots = num_shots
        self._loader = image_loader or ImageLoader(live=False, size=patch_size)
        self._input_dim = num_shots * patch_size * patch_size * 3

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Run raw inference on a pre-built feature matrix.

        Args:
            X: ``(N, input_dim)`` float32 array.

        Returns:
            ``(N,)`` predicted sub-grade scores.
        """
        outputs = run_onnx_inference(self._session, X)
        return outputs.flatten()

    def predict_from_request(self, request: SurfaceRequest) -> SurfacePrediction:
        """Run inference from a ``SurfaceRequest``.

        Loads images for all active shots, builds feature vector, runs
        inference, computes per-shot and aggregate confidence bands.

        Raking-light path: if ``request.raking_light_uri`` is set, the engine
        uses 3 shots.  The ONNX model must have been exported with matching
        ``input_dim``.  If the loaded model was trained for 2 shots only, this
        call will raise a shape mismatch from onnxruntime.
        """
        return self._predict_from_uris(request.shot_uris, request.shot_labels, request.session_id)

    def predict_from_uris(
        self,
        front_full_uri: str,
        back_full_uri: str,
        raking_light_uri: Optional[str] = None,
        session_id: str = "",
    ) -> SurfacePrediction:
        """Convenience wrapper — build a ``SurfaceRequest`` and predict."""
        request = SurfaceRequest(
            session_id=session_id,
            front_full_uri=front_full_uri,
            back_full_uri=back_full_uri,
            raking_light_uri=raking_light_uri,
        )
        return self.predict_from_request(request)

    def _predict_from_uris(
        self,
        shot_uris: list[str],
        shot_labels: tuple[str, ...],
        session_id: str,
    ) -> SurfacePrediction:
        patches = np.stack(
            [self._loader.load(url) for url in shot_uris], axis=0
        )
        feature = patches.flatten().astype(np.float32)[np.newaxis, :]
        raw_scores = self.predict(feature)

        per_shot: list[SurfaceShotPrediction] = []
        for label in shot_labels:
            score_i = float(np.clip(raw_scores[0], 1.0, 10.0))
            band = compute_confidence_band(score_i, cal_mae=self._cal_mae)
            per_shot.append(SurfaceShotPrediction(label=label, band=band))

        avg_value = float(np.mean([s.band.value for s in per_shot]))
        avg_confidence = float(np.mean([s.band.confidence for s in per_shot]))
        aggregate = ConfidenceBand(
            value=float(np.clip(avg_value, 1.0, 10.0)),
            confidence=float(np.clip(avg_confidence, 0.0, 1.0)),
        )

        return SurfacePrediction(
            session_id=session_id,
            per_shot=per_shot,
            aggregate=aggregate,
        )
