"""Aggregate model evaluation entry point.

Computes MAE / RMSE / ±1-grade-accuracy against PSA-graded ground truth.
Reuses ``grading.ml_common.eval_metrics``.

Two modes:

1. **Pure-function** (``eval_aggregator(predictions, targets)``) — drop-in
   for any caller that already has the predicted + actual arrays.
2. **End-to-end** (``eval_aggregator_against_rows(psa_rows, ...)``) — reads
   the merged data loader, takes the labelled rows' PSA sub-grade vector +
   ``overall_grade`` ground truth, and runs the aggregator on each row.

The end-to-end mode skips any row whose sub-grade labels are incomplete
(missing centering / corners / edges / surface).  For v1 we synthesise the
4 sub-grade scores from the row's labelled sub-grade columns; in production
each sub-grade model would emit a prediction and the aggregator would
consume those.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from grading.aggregate.model import LinearWeightedAggregator, round_to_psa_tick
from grading.aggregate.service import aggregate_subgrades
from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregateWeights,
    SubGradeInputs,
)
from grading.ml_common.eval_metrics import summarise_metrics


def eval_aggregator(
    predictions: np.ndarray,
    targets: np.ndarray,
) -> dict[str, float]:
    """Return standard metrics for an aggregator's predictions.

    Args:
        predictions: Predicted PSA grades (after 0.5-tick rounding).
        targets: Ground-truth PSA grades.

    Returns:
        Dict of MAE / RMSE / ±1-grade-accuracy / exact accuracy.
    """
    return summarise_metrics(predictions, targets)


def eval_aggregator_against_rows(
    rows: list[dict[str, Any]],
    weights: AggregateWeights | None = None,
) -> dict[str, float]:
    """End-to-end aggregator eval on a list of PSA training rows.

    Args:
        rows: PSA cert rows with ``subgrades`` JSONB containing all 4
            sub-grade columns (centering / corners / edges / surface) +
            ``grade`` (overall PSA grade) field.  Rows lacking any required
            sub-grade are filtered out.
        weights: Optional weight override; defaults to ``DEFAULT_WEIGHTS``.

    Returns:
        Dict of MAE / RMSE / ±1-grade-accuracy / exact accuracy + an
        ``n_samples`` count.
    """
    predictions: list[float] = []
    targets: list[float] = []
    used_weights = weights if weights is not None else DEFAULT_WEIGHTS

    for row in rows:
        subgrades: dict = row.get("subgrades") or {}
        overall = row.get("grade")
        if overall is None:
            continue
        try:
            target = float(overall)
        except (TypeError, ValueError):
            continue

        scores_dict: dict[str, float] = {}
        skip = False
        for name in SUBGRADE_NAMES:
            value = subgrades.get(name)
            if value is None:
                skip = True
                break
            try:
                scores_dict[name] = float(value)
            except (TypeError, ValueError):
                skip = True
                break
        if skip:
            continue

        inputs = SubGradeInputs(
            scores=scores_dict,
            confidences={name: 1.0 for name in SUBGRADE_NAMES},
        )
        result = aggregate_subgrades(inputs, weights=used_weights)
        predictions.append(result.psa_grade)
        targets.append(round_to_psa_tick(target))

    if not predictions:
        raise ValueError(
            "No labelled aggregate samples found "
            "(rows must include all 4 sub-grades + overall grade)."
        )

    metrics = eval_aggregator(np.asarray(predictions), np.asarray(targets))
    metrics["n_samples"] = float(len(predictions))
    return metrics


def _main() -> None:  # pragma: no cover - CLI smoke entry
    parser = argparse.ArgumentParser(description="Evaluate aggregate model")
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Optional ONNX model path (currently unused — linear "
        "aggregator weights are applied directly).",
    )
    args = parser.parse_args()
    _ = args  # silence the unused-var warning until a real CLI lands

    print(
        "aggregate/eval.py: Synthetic-data smoke (no live DB in v0). "
        "Build a richer row set to evaluate at scale."
    )

    rows = [
        {
            "grade": 9.0,
            "subgrades": {"centering": 9.0, "corners": 9.0, "edges": 9.0, "surface": 9.0},
        },
        {
            "grade": 8.5,
            "subgrades": {"centering": 8.0, "corners": 8.5, "edges": 8.5, "surface": 9.0},
        },
        {
            "grade": 7.0,
            "subgrades": {"centering": 7.0, "corners": 7.0, "edges": 7.0, "surface": 7.5},
        },
    ]
    metrics = eval_aggregator_against_rows(rows)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":  # pragma: no cover
    _main()
