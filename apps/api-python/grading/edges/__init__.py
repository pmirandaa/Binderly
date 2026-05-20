"""Edges sub-grade model — training pipeline + inference contract.

Predicts PSA-style edge quality sub-grade (1.0–10.0) from four thin
rectangular strips extracted from the perimeter of a trading card image.

Public surface::

    from grading.edges import EdgesInferenceEngine, EdgesPrediction

    engine = EdgesInferenceEngine("edges_v0.onnx", cal_mae=0.8)
    result = engine.predict(strip_patches_numpy)
    print(result.per_edge[0].band.value, result.per_edge[0].band.confidence)
"""

from grading.edges.infer import EdgesInferenceEngine
from grading.edges.model import EdgesModel
from grading.edges.types import EdgesPrediction, EdgesRequest, EdgesSubgrade

__all__ = [
    "EdgesInferenceEngine",
    "EdgesModel",
    "EdgesPrediction",
    "EdgesRequest",
    "EdgesSubgrade",
]
