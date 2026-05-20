"""Confidence band computation for sub-grade predictions.

Every sub-grade model returns a ``ConfidenceBand`` with a ``value`` (predicted
PSA score) and a ``confidence`` in [0.0, 1.0].  T-GR-AGGREGATE reads all four
sub-grades in this uniform shape.

v1 method: calibration-residual confidence.  Given a calibration set's mean
absolute residual ``cal_mae``, the confidence for a single prediction is::

    confidence = max(0.0, 1.0 - |residual| / (2 * cal_mae))

where ``residual = prediction - target`` (only known at eval time) or an
empirical estimate derived from the model's training loss at inference time.

In inference (no ground truth), confidence uses a fixed prior derived from the
validation MAE stored alongside the ONNX model artifact.

Production upgrade path: replace with MC-Dropout or Deep Ensemble variance,
which gives per-sample uncertainty without requiring ground-truth targets.
"""

from __future__ import annotations

import numpy as np

from grading.ml_common.types import ConfidenceBand


def compute_confidence_band(
    predicted_value: float,
    cal_mae: float,
    residual: float | None = None,
) -> ConfidenceBand:
    """Compute a ``ConfidenceBand`` for a single prediction.

    Args:
        predicted_value: Model's predicted PSA sub-grade.
        cal_mae: Mean absolute error on the calibration / validation split.
            Used as the baseline uncertainty scale.
        residual: ``prediction - target`` if ground truth is known (eval mode).
            ``None`` in inference mode (confidence derived from ``cal_mae`` alone
            as a prior over the typical error).

    Returns:
        ``ConfidenceBand(value, confidence)`` with value clamped to [1.0, 10.0].
    """
    clamped = float(np.clip(predicted_value, 1.0, 10.0))

    if cal_mae <= 0.0:
        confidence = 1.0
    elif residual is not None:
        abs_residual = abs(residual)
        confidence = max(0.0, 1.0 - abs_residual / (2.0 * cal_mae))
    else:
        confidence = max(0.0, 1.0 - cal_mae / 2.0)

    confidence = float(np.clip(confidence, 0.0, 1.0))
    return ConfidenceBand(value=clamped, confidence=confidence)


def batch_confidence_bands(
    predictions: np.ndarray,
    cal_mae: float,
    targets: np.ndarray | None = None,
) -> list[ConfidenceBand]:
    """Compute confidence bands for a batch of predictions.

    Args:
        predictions: 1-D array of predicted scores.
        cal_mae: Calibration MAE (uncertainty scale).
        targets: Optional ground-truth scores (eval mode).

    Returns:
        List of ``ConfidenceBand`` objects, one per prediction.
    """
    bands: list[ConfidenceBand] = []
    for i, pred in enumerate(predictions):
        residual: float | None = None
        if targets is not None and i < len(targets):
            residual = float(pred) - float(targets[i])
        bands.append(
            compute_confidence_band(
                predicted_value=float(pred),
                cal_mae=cal_mae,
                residual=residual,
            )
        )
    return bands
