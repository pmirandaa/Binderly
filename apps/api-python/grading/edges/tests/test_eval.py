"""Tests for edges/eval.py — eval smoke tests."""

from __future__ import annotations

import pytest

from grading.edges.eval import eval_edges_model
from grading.edges.tests.conftest import (
    PATCH_SIZE,
    _make_psa_rows,
    _make_ebay_rows,
    _make_auction_rows,
)


class TestEvalEdgesModel:
    def test_eval_returns_metrics_dict(self, tmp_path, psa_rows, ebay_rows, auction_rows):
        pytest.importorskip("onnx")
        pytest.importorskip("onnxruntime")

        from grading.edges.train import train_edges_model
        from grading.ml_common.types import TrainingConfig

        config = TrainingConfig(num_epochs=1, batch_size=4)
        output = tmp_path / "edges_eval.onnx"
        train_edges_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            output_path=output,
            patch_size=PATCH_SIZE,
        )

        metrics = eval_edges_model(
            model_path=output,
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            patch_size=PATCH_SIZE,
        )
        assert isinstance(metrics, dict)
        assert "mae" in metrics or "n_samples" in metrics

    def test_eval_raises_on_empty_data(self, tmp_path):
        pytest.importorskip("onnx")
        pytest.importorskip("onnxruntime")

        from grading.edges.train import train_edges_model
        from grading.ml_common.types import TrainingConfig

        config = TrainingConfig(num_epochs=1, batch_size=4)
        output = tmp_path / "edges_eval_empty.onnx"
        train_edges_model(
            psa_rows=_make_psa_rows(5),
            ebay_rows=[],
            auction_rows=[],
            config=config,
            output_path=output,
            patch_size=PATCH_SIZE,
        )

        with pytest.raises(ValueError, match="No labelled"):
            eval_edges_model(
                model_path=output,
                psa_rows=[],
                ebay_rows=[],
                auction_rows=[],
                patch_size=PATCH_SIZE,
            )

    def test_eval_n_samples_correct(self, tmp_path, psa_rows, ebay_rows, auction_rows):
        pytest.importorskip("onnx")
        pytest.importorskip("onnxruntime")

        from grading.edges.train import train_edges_model
        from grading.edges.dataset import EdgesMergedDataLoader
        from grading.ml_common.types import TrainingConfig

        config = TrainingConfig(num_epochs=1, batch_size=4)
        output = tmp_path / "edges_eval_n.onnx"
        train_edges_model(
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            config=config,
            output_path=output,
            patch_size=PATCH_SIZE,
        )

        metrics = eval_edges_model(
            model_path=output,
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            patch_size=PATCH_SIZE,
        )
        loader = EdgesMergedDataLoader(psa_rows, ebay_rows, auction_rows)
        expected_n = len(loader.load_labelled())
        assert metrics["n_samples"] == pytest.approx(expected_n)
