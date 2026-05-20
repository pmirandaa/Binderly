"""Evaluation metrics for grading sub-grade regression models.

All functions operate on raw numpy arrays of float predictions and targets
(PSA-scale 1.0–10.0).

Shared by T-GR-CORNERS, T-GR-EDGES, T-GR-SURFACE, and T-GR-AGGREGATE.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np


def mae(predictions: np.ndarray, targets: np.ndarray) -> float:
    """Mean absolute error.

    Primary eval metric — more interpretable than RMSE for PSA graders.
    A model with MAE ≤ 0.5 meets the ±1 calibration target.
    """
    if len(predictions) == 0:
        return math.nan
    return float(np.mean(np.abs(predictions - targets)))


def rmse(predictions: np.ndarray, targets: np.ndarray) -> float:
    """Root mean squared error.  Penalises large errors more than MAE."""
    if len(predictions) == 0:
        return math.nan
    return float(np.sqrt(np.mean((predictions - targets) ** 2)))


def grade_accuracy(
    predictions: np.ndarray,
    targets: np.ndarray,
    tolerance: float = 1.0,
) -> float:
    """Fraction of predictions within ±``tolerance`` of the actual grade.

    PSA calibration target: ≥80% within ±1 grade.

    Args:
        predictions: Predicted sub-grades.
        targets: Actual sub-grades.
        tolerance: Maximum absolute error to count as "correct".
            Default 1.0 matches the PSA calibration target.

    Returns:
        Float in [0.0, 1.0]; ``nan`` for empty input.
    """
    if len(predictions) == 0:
        return math.nan
    within = np.abs(predictions - targets) <= tolerance
    return float(np.mean(within))


def confusion_matrix_grades(
    predictions: np.ndarray,
    targets: np.ndarray,
) -> dict[tuple[int, int], int]:
    """Confusion matrix bucketed at integer grade levels.

    Predictions and targets are rounded to the nearest integer (1–10).

    Returns:
        Dict ``{(actual_bucket, predicted_bucket): count}``.  Only
        cells with count > 0 are present.
    """
    result: dict[tuple[int, int], int] = defaultdict(int)
    for pred, actual in zip(predictions, targets):
        pred_bucket = int(round(float(np.clip(pred, 1, 10))))
        actual_bucket = int(round(float(np.clip(actual, 1, 10))))
        result[(actual_bucket, pred_bucket)] += 1
    return dict(result)


def diagonal_accuracy(confusion: dict[tuple[int, int], int]) -> float:
    """Exact-grade accuracy from a confusion matrix dict.

    Returns:
        Fraction of samples where predicted bucket == actual bucket.
    """
    total = sum(confusion.values())
    if total == 0:
        return math.nan
    correct = sum(v for (a, p), v in confusion.items() if a == p)
    return correct / total


def summarise_metrics(
    predictions: np.ndarray,
    targets: np.ndarray,
) -> dict[str, float]:
    """Return all standard metrics in a single dict.

    Convenience wrapper for logging + the eval CLI.
    """
    confusion = confusion_matrix_grades(predictions, targets)
    return {
        "mae": mae(predictions, targets),
        "rmse": rmse(predictions, targets),
        "grade_accuracy_pm1": grade_accuracy(predictions, targets, tolerance=1.0),
        "grade_accuracy_pm0_5": grade_accuracy(predictions, targets, tolerance=0.5),
        "exact_grade_accuracy": diagonal_accuracy(confusion),
    }
