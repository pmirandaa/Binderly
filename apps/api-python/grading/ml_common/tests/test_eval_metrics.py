"""Tests for ml_common/eval_metrics.py."""

from __future__ import annotations

import math

import numpy as np
import pytest

from grading.ml_common.eval_metrics import (
    confusion_matrix_grades,
    diagonal_accuracy,
    grade_accuracy,
    mae,
    rmse,
    summarise_metrics,
)


class TestMAE:
    def test_perfect_predictions(self):
        preds = np.array([5.0, 7.0, 9.0])
        targets = np.array([5.0, 7.0, 9.0])
        assert mae(preds, targets) == pytest.approx(0.0)

    def test_known_error(self):
        preds = np.array([6.0, 8.0])
        targets = np.array([5.0, 9.0])
        assert mae(preds, targets) == pytest.approx(1.0)

    def test_empty_returns_nan(self):
        assert math.isnan(mae(np.array([]), np.array([])))


class TestRMSE:
    def test_perfect_predictions(self):
        preds = np.array([5.0, 7.0])
        assert rmse(preds, preds) == pytest.approx(0.0)

    def test_known_rmse(self):
        preds = np.array([0.0, 2.0])
        targets = np.array([2.0, 0.0])
        assert rmse(preds, targets) == pytest.approx(2.0)

    def test_empty_returns_nan(self):
        assert math.isnan(rmse(np.array([]), np.array([])))


class TestGradeAccuracy:
    def test_all_within_tolerance(self):
        preds = np.array([8.5, 9.0, 7.0])
        targets = np.array([9.0, 9.5, 7.5])
        acc = grade_accuracy(preds, targets, tolerance=1.0)
        assert acc == pytest.approx(1.0)

    def test_none_within_tolerance(self):
        preds = np.array([5.0, 6.0])
        targets = np.array([8.0, 9.0])
        acc = grade_accuracy(preds, targets, tolerance=1.0)
        assert acc == pytest.approx(0.0)

    def test_half_within_tolerance(self):
        preds = np.array([9.0, 5.0])
        targets = np.array([9.5, 9.5])
        acc = grade_accuracy(preds, targets, tolerance=1.0)
        assert acc == pytest.approx(0.5)

    def test_empty_returns_nan(self):
        assert math.isnan(grade_accuracy(np.array([]), np.array([])))


class TestConfusionMatrix:
    def test_perfect_predictions(self):
        preds = np.array([9.0, 8.0, 10.0])
        targets = np.array([9.0, 8.0, 10.0])
        cm = confusion_matrix_grades(preds, targets)
        assert cm[(9, 9)] == 1
        assert cm[(8, 8)] == 1
        assert cm[(10, 10)] == 1

    def test_off_diagonal(self):
        preds = np.array([8.0])
        targets = np.array([9.0])
        cm = confusion_matrix_grades(preds, targets)
        assert cm.get((9, 8), 0) == 1
        assert cm.get((9, 9), 0) == 0

    def test_clipping_to_valid_range(self):
        preds = np.array([11.0, 0.5])
        targets = np.array([10.0, 1.0])
        cm = confusion_matrix_grades(preds, targets)
        assert (10, 10) in cm
        assert (1, 1) in cm


class TestDiagonalAccuracy:
    def test_all_correct(self):
        cm = {(8, 8): 3, (9, 9): 2}
        assert diagonal_accuracy(cm) == pytest.approx(1.0)

    def test_none_correct(self):
        cm = {(8, 9): 2, (9, 8): 1}
        assert diagonal_accuracy(cm) == pytest.approx(0.0)

    def test_empty(self):
        assert math.isnan(diagonal_accuracy({}))


class TestSummariseMetrics:
    def test_returns_all_keys(self):
        preds = np.array([8.0, 9.0, 7.5])
        targets = np.array([8.5, 9.0, 7.0])
        metrics = summarise_metrics(preds, targets)
        assert "mae" in metrics
        assert "rmse" in metrics
        assert "grade_accuracy_pm1" in metrics
        assert "grade_accuracy_pm0_5" in metrics
        assert "exact_grade_accuracy" in metrics
