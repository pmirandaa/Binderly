"""Corners sub-grade model — training pipeline + inference contract.

Predicts PSA-style corner quality sub-grade (1.0–10.0) from four corner-crop
patches of a trading card.

Public surface::

    from grading.corners import CornersInferenceEngine, CornersPrediction

    engine = CornersInferenceEngine("corners_v0.onnx", cal_mae=0.8)
    result = engine.predict(corner_patches_numpy)
    print(result.bands[0].value, result.bands[0].confidence)
"""

from grading.corners.infer import CornersInferenceEngine
from grading.corners.model import CornersModel
from grading.corners.types import CornersPrediction, CornersRequest, CornersSubgrade

__all__ = [
    "CornersInferenceEngine",
    "CornersModel",
    "CornersPrediction",
    "CornersRequest",
    "CornersSubgrade",
]
