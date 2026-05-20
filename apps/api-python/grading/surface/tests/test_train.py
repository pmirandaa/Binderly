"""Tests for surface/train.py — training smoke tests."""

from __future__ import annotations

import math

import pytest

from grading.surface.tests.conftest import (
    PATCH_SIZE,
    _make_auction_rows,
    _make_ebay_rows,
    _make_psa_rows,
)
from grading.surface.train import train_surface_model
from grading.surface.types import NUM_SURFACE_SHOTS_V1, NUM_SURFACE_SHOTS_WITH_RAKING
from grading.ml_common.types import TrainingConfig, TrainingResult


class TestTrainSurfaceModel:
    def test_one_epoch_smoke(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=1, batch_size=4, random_seed=0)
        result = train_surface_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert isinstance(result, TrainingResult)
        assert result.num_epochs_run == 1

    def test_result_has_finite_loss(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=1, batch_size=4, random_seed=1)
        result = train_surface_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert not math.isnan(result.final_train_loss)
        assert not math.isinf(result.final_train_loss)

    def test_raises_on_empty_data(self):
        config = TrainingConfig(num_epochs=1)
        with pytest.raises(ValueError, match="No labelled"):
            train_surface_model(
                psa_rows=[],
                ebay_rows=[],
                auction_rows=[],
                config=config,
                patch_size=PATCH_SIZE,
            )

    def test_exports_onnx_when_output_path_given(
        self, psa_rows, ebay_rows, auction_rows, tmp_path
    ):
        pytest.importorskip("onnx")
        config = TrainingConfig(num_epochs=1, batch_size=4)
        output = tmp_path / "surface_smoke.onnx"
        train_surface_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            output_path=output,
            patch_size=PATCH_SIZE,
        )
        assert output.exists()
        assert output.stat().st_size > 0

    def test_psa_only_data_works(self):
        config = TrainingConfig(num_epochs=1, batch_size=4)
        result = train_surface_model(
            psa_rows=_make_psa_rows(5),
            ebay_rows=[],
            auction_rows=[],
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert isinstance(result, TrainingResult)

    def test_returns_training_result_type(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=2, batch_size=4)
        result = train_surface_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert hasattr(result, "final_train_loss")
        assert hasattr(result, "final_val_loss")
        assert hasattr(result, "best_val_mae")
        assert hasattr(result, "num_epochs_run")

    def test_val_loss_is_finite(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=1, batch_size=4)
        result = train_surface_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert not math.isnan(result.final_val_loss)
        assert not math.isinf(result.final_val_loss)

    def test_multiple_epochs_runs_all(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=5, batch_size=4)
        result = train_surface_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert result.num_epochs_run == 5
