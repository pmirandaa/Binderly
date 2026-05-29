"""Shared ML infrastructure for grading sub-grade models.

This package is consumed by:
- ``grading/corners/`` (T-GR-CORNERS — this task, pattern-establisher)
- ``grading/edges/``   (T-GR-EDGES — next iteration)
- ``grading/surface/`` (T-GR-SURFACE — next iteration)

Public surface::

    from grading.ml_common import (
        LabelledGradingSample,
        SubgradePrediction,
        ConfidenceBand,
        MergedDataLoader,
        ImageLoader,
        mae, rmse, grade_accuracy,
        compute_confidence_band,
        export_to_onnx,
        load_onnx_session,
    )
"""

from grading.ml_common.confidence import compute_confidence_band
from grading.ml_common.data_loader import (
    AuctionDataLoader,
    EbayDataLoader,
    MergedDataLoader,
    PSADataLoader,
    SubgradeKey,
)
from grading.ml_common.eval_metrics import (
    confusion_matrix_grades,
    grade_accuracy,
    mae,
    rmse,
)
from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.model_export import export_to_onnx, load_onnx_session
from grading.ml_common.types import (
    ConfidenceBand,
    LabelledGradingSample,
    SubgradePrediction,
    TrainingConfig,
    TrainingResult,
)

__all__ = [
    # types
    "ConfidenceBand",
    "LabelledGradingSample",
    "SubgradePrediction",
    "TrainingConfig",
    "TrainingResult",
    # data loaders
    "PSADataLoader",
    "EbayDataLoader",
    "AuctionDataLoader",
    "MergedDataLoader",
    "SubgradeKey",
    # image loader
    "ImageLoader",
    # eval metrics
    "mae",
    "rmse",
    "grade_accuracy",
    "confusion_matrix_grades",
    # model export
    "export_to_onnx",
    "load_onnx_session",
    # confidence
    "compute_confidence_band",
]
