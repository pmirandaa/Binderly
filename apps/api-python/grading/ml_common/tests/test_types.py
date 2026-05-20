"""Tests for ml_common/types.py."""

from __future__ import annotations

import pytest

from grading.ml_common.types import (
    ConfidenceBand,
    DataLoaderProtocol,
    LabelledGradingSample,
    ModelProtocol,
    SubgradePrediction,
    TrainingConfig,
    TrainingResult,
)


class TestLabelledGradingSample:
    def test_basic_construction(self):
        s = LabelledGradingSample(
            source="psa_cert",
            source_id="12345",
            grade_company="PSA",
            overall_grade=9.0,
            corners_score=8.5,
            image_urls=["https://example.com/img.jpg"],
        )
        assert s.source == "psa_cert"
        assert s.corners_score == 8.5
        assert s.is_labelled_for_corners()

    def test_null_corners_not_labelled(self):
        s = LabelledGradingSample(
            source="ebay_sold",
            source_id="abc",
            grade_company="PSA",
            overall_grade=9.0,
            corners_score=None,
        )
        assert not s.is_labelled_for_corners()

    def test_frozen_immutable(self):
        s = LabelledGradingSample(
            source="psa_cert",
            source_id="x",
            grade_company="PSA",
            overall_grade=None,
            corners_score=7.0,
        )
        with pytest.raises(Exception):
            s.source = "other"  # type: ignore[misc]

    def test_default_image_urls(self):
        s = LabelledGradingSample(
            source="psa_cert",
            source_id="1",
            grade_company="PSA",
            overall_grade=None,
            corners_score=None,
        )
        assert s.image_urls == []

    def test_printing_id_defaults_none(self):
        s = LabelledGradingSample(
            source="psa_cert",
            source_id="1",
            grade_company="PSA",
            overall_grade=None,
            corners_score=None,
        )
        assert s.printing_id is None


class TestConfidenceBand:
    def test_valid_construction(self):
        band = ConfidenceBand(value=8.5, confidence=0.72)
        assert band.value == 8.5
        assert band.confidence == 0.72

    def test_boundary_values_valid(self):
        ConfidenceBand(value=1.0, confidence=0.0)
        ConfidenceBand(value=10.0, confidence=1.0)

    def test_value_out_of_range_raises(self):
        with pytest.raises(ValueError, match="value"):
            ConfidenceBand(value=0.5, confidence=0.5)
        with pytest.raises(ValueError, match="value"):
            ConfidenceBand(value=11.0, confidence=0.5)

    def test_confidence_out_of_range_raises(self):
        with pytest.raises(ValueError, match="confidence"):
            ConfidenceBand(value=5.0, confidence=-0.1)
        with pytest.raises(ValueError, match="confidence"):
            ConfidenceBand(value=5.0, confidence=1.1)


class TestSubgradePrediction:
    def test_construction(self):
        band = ConfidenceBand(value=7.0, confidence=0.8)
        pred = SubgradePrediction(subgrade="corners", band=band)
        assert pred.subgrade == "corners"
        assert pred.band.value == 7.0
        assert pred.model_version == "v0-placeholder"


class TestTrainingConfig:
    def test_defaults(self):
        cfg = TrainingConfig()
        assert cfg.subgrade_column == "corners"
        assert cfg.num_epochs == 10
        assert cfg.batch_size == 8
        assert cfg.patch_size == 64
        assert cfg.random_seed == 42

    def test_custom_values(self):
        cfg = TrainingConfig(subgrade_column="edges", num_epochs=5, learning_rate=0.01)
        assert cfg.subgrade_column == "edges"
        assert cfg.num_epochs == 5


class TestTrainingResult:
    def test_construction(self):
        r = TrainingResult(
            final_train_loss=0.5,
            final_val_loss=0.6,
            best_val_mae=0.45,
            num_epochs_run=10,
            model_version="v0-placeholder",
        )
        assert r.final_train_loss == 0.5
        assert r.num_epochs_run == 10
