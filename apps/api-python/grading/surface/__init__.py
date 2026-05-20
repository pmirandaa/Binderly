"""Surface sub-grade model — training pipeline + inference contract.

Predicts PSA-style surface quality sub-grade (1.0–10.0) from two full-face
shots of a trading card (frontFull + backFull).

The raking-light shot (a future third input via #FU-31) is optional: when
present, the inference engine switches to the 3-shot path automatically.

Public surface::

    from grading.surface import SurfaceInferenceEngine, SurfacePrediction

    engine = SurfaceInferenceEngine("surface_v0.onnx", cal_mae=0.9)
    result = engine.predict_from_uris(
        front_full_uri="file:///tmp/front.jpg",
        back_full_uri="file:///tmp/back.jpg",
    )
    print(result.aggregate.value, result.aggregate.confidence)
"""

from grading.surface.infer import SurfaceInferenceEngine
from grading.surface.model import SurfaceModel
from grading.surface.types import SurfacePrediction, SurfaceRequest, SurfaceShotPrediction

__all__ = [
    "SurfaceInferenceEngine",
    "SurfaceModel",
    "SurfacePrediction",
    "SurfaceRequest",
    "SurfaceShotPrediction",
]
