"""Tests for edges/train.py — training smoke tests."""

from __future__ import annotations

import pytest

from grading.edges.train import train_edges_model
from grading.edges.tests.conftest import (
    PATCH_SIZE,
    _make_auction_rows,
    _make_ebay_rows,
    _make_psa_rows,
)
from grading.ml_common.types import TrainingConfig, TrainingResult


class TestTrainEdgesModel:
    def test_one_epoch_smoke(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=1, batch_size=4, random_seed=0)
        result = train_edges_model(
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
        result = train_edges_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        import math
        assert not math.isnan(result.final_train_loss)
        assert not math.isinf(result.final_train_loss)

    def test_raises_on_empty_data(self):
        config = TrainingConfig(num_epochs=1)
        with pytest.raises(ValueError, match="No labelled"):
            train_edges_model(
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
        output = tmp_path / "edges_smoke.onnx"
        train_edges_model(
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
        result = train_edges_model(
            psa_rows=_make_psa_rows(5),
            ebay_rows=[],
            auction_rows=[],
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert isinstance(result, TrainingResult)

    def test_multi_epoch_run(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=3, batch_size=4, random_seed=7)
        result = train_edges_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert result.num_epochs_run == 3

    def test_best_val_mae_is_nonnegative(self, psa_rows, ebay_rows, auction_rows):
        config = TrainingConfig(num_epochs=1, batch_size=4)
        result = train_edges_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert result.best_val_mae >= 0.0

    def test_ebay_only_data_works(self):
        config = TrainingConfig(num_epochs=1, batch_size=4)
        result = train_edges_model(
            psa_rows=[],
            ebay_rows=_make_ebay_rows(6),
            auction_rows=[],
            config=config,
            patch_size=PATCH_SIZE,
        )
        assert isinstance(result, TrainingResult)
