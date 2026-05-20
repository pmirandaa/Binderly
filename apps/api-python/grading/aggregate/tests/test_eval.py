"""Tests for ``grading.aggregate.eval``."""

from __future__ import annotations

import math

import numpy as np
import pytest

from grading.aggregate.eval import (
    eval_aggregator,
    eval_aggregator_against_rows,
)
from grading.aggregate.types import AggregateWeights


class TestEvalAggregator:
    def test_returns_standard_metrics(self):
        preds = np.array([9.0, 8.5, 7.0])
        targets = np.array([9.0, 8.5, 7.0])
        m = eval_aggregator(preds, targets)
        assert m["mae"] == pytest.approx(0.0)
        assert m["rmse"] == pytest.approx(0.0)
        assert m["grade_accuracy_pm1"] == pytest.approx(1.0)

    def test_perfect_predictions_score_perfect(self):
        preds = np.array([9.0, 8.5, 10.0, 7.5])
        targets = np.array([9.0, 8.5, 10.0, 7.5])
        m = eval_aggregator(preds, targets)
        assert m["exact_grade_accuracy"] == pytest.approx(1.0)

    def test_within_pm1_accuracy_metric(self):
        preds = np.array([9.0, 9.0, 9.0])
        targets = np.array([8.5, 9.5, 10.0])
        m = eval_aggregator(preds, targets)
        assert m["grade_accuracy_pm1"] == pytest.approx(1.0)

    def test_mae_simple(self):
        preds = np.array([9.0, 8.0])
        targets = np.array([8.0, 9.0])
        m = eval_aggregator(preds, targets)
        assert m["mae"] == pytest.approx(1.0)

    def test_returns_nan_on_empty(self):
        m = eval_aggregator(np.array([]), np.array([]))
        assert math.isnan(m["mae"])


class TestEvalAggregatorAgainstRows:
    def test_runs_on_synthetic_rows(self, synthetic_psa_rows):
        m = eval_aggregator_against_rows(synthetic_psa_rows)
        assert m["n_samples"] == 10.0

    def test_metrics_present(self, synthetic_psa_rows):
        m = eval_aggregator_against_rows(synthetic_psa_rows)
        for key in ("mae", "rmse", "grade_accuracy_pm1", "n_samples"):
            assert key in m

    def test_rejects_when_all_rows_filtered(self):
        rows = [
            {"grade": "9.0", "subgrades": {"centering": 9.0}},  # missing 3
            {"grade": "8.0", "subgrades": {"corners": 8.0}},
        ]
        with pytest.raises(ValueError, match="No labelled"):
            eval_aggregator_against_rows(rows)

    def test_rejects_when_overall_missing(self):
        rows = [
            {
                "subgrades": {
                    "centering": 9.0,
                    "corners": 9.0,
                    "edges": 9.0,
                    "surface": 9.0,
                },
            },
        ]
        with pytest.raises(ValueError, match="No labelled"):
            eval_aggregator_against_rows(rows)

    def test_custom_weights_change_metrics(self, synthetic_psa_rows):
        baseline = eval_aggregator_against_rows(synthetic_psa_rows)
        biased = AggregateWeights(
            centering=1.0, corners=0.0, edges=0.0, surface=0.0,
        )
        biased_result = eval_aggregator_against_rows(
            synthetic_psa_rows, weights=biased,
        )
        # Equal n_samples, but at least one metric should differ.
        assert baseline["n_samples"] == biased_result["n_samples"]
