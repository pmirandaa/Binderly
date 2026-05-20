"""Tests for ml_common/confidence.py."""

from __future__ import annotations

import numpy as np
import pytest

from grading.ml_common.confidence import batch_confidence_bands, compute_confidence_band
from grading.ml_common.types import ConfidenceBand


class TestComputeConfidenceBand:
    def test_returns_confidence_band(self):
        band = compute_confidence_band(8.5, cal_mae=0.5)
        assert isinstance(band, ConfidenceBand)

    def test_value_clamped_to_range(self):
        band = compute_confidence_band(11.0, cal_mae=0.5)
        assert band.value == pytest.approx(10.0)
        band_low = compute_confidence_band(0.5, cal_mae=0.5)
        assert band_low.value == pytest.approx(1.0)

    def test_zero_residual_max_confidence(self):
        band = compute_confidence_band(8.0, cal_mae=0.5, residual=0.0)
        assert band.confidence == pytest.approx(1.0)

    def test_large_residual_low_confidence(self):
        band = compute_confidence_band(8.0, cal_mae=0.5, residual=2.0)
        assert band.confidence == pytest.approx(0.0)

    def test_inference_mode_uses_cal_mae_prior(self):
        band = compute_confidence_band(8.0, cal_mae=0.5, residual=None)
        assert 0.0 <= band.confidence <= 1.0

    def test_zero_cal_mae_perfect_confidence(self):
        band = compute_confidence_band(8.0, cal_mae=0.0)
        assert band.confidence == pytest.approx(1.0)


class TestBatchConfidenceBands:
    def test_returns_list_of_correct_length(self):
        preds = np.array([8.0, 9.0, 7.0])
        bands = batch_confidence_bands(preds, cal_mae=0.5)
        assert len(bands) == 3

    def test_with_targets_uses_residuals(self):
        preds = np.array([9.0])
        targets = np.array([9.0])
        bands = batch_confidence_bands(preds, cal_mae=0.5, targets=targets)
        assert bands[0].confidence == pytest.approx(1.0)

    def test_empty_input(self):
        bands = batch_confidence_bands(np.array([]), cal_mae=0.5)
        assert bands == []
