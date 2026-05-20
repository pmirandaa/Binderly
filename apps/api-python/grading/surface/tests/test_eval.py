"""Tests for surface/eval.py — eval_surface_model."""

from __future__ import annotations

import pytest

from grading.surface.eval import eval_surface_model
from grading.surface.export import export_surface_model
from grading.surface.model import SurfaceModel
from grading.surface.tests.conftest import (
    PATCH_SIZE,
    _make_auction_rows,
    _make_ebay_rows,
    _make_psa_rows,
)


@pytest.fixture
def onnx_model_path(tmp_path):
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    from grading.surface.tests.conftest import INPUT_DIM
    model = SurfaceModel(input_dim=INPUT_DIM, random_seed=7)
    path = tmp_path / "surface_eval.onnx"
    export_surface_model(model, path)
    return path


class TestEvalSurfaceModel:
    def test_eval_returns_dict(self, onnx_model_path, psa_rows, ebay_rows, auction_rows):
        metrics = eval_surface_model(
            onnx_model_path,
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            patch_size=PATCH_SIZE,
        )
        assert isinstance(metrics, dict)

    def test_eval_has_mae_key(self, onnx_model_path, psa_rows, ebay_rows, auction_rows):
        metrics = eval_surface_model(
            onnx_model_path,
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            patch_size=PATCH_SIZE,
        )
        assert "mae" in metrics

    def test_eval_has_n_samples_key(self, onnx_model_path, psa_rows, ebay_rows, auction_rows):
        metrics = eval_surface_model(
            onnx_model_path,
            psa_rows=psa_rows,
            ebay_rows=ebay_rows,
            auction_rows=auction_rows,
            patch_size=PATCH_SIZE,
        )
        assert "n_samples" in metrics

    def test_eval_n_samples_correct(self, onnx_model_path):
        psa = _make_psa_rows(4)
        ebay = _make_ebay_rows(3)
        metrics = eval_surface_model(
            onnx_model_path,
            psa_rows=psa,
            ebay_rows=ebay,
            auction_rows=[],
            patch_size=PATCH_SIZE,
        )
        assert metrics["n_samples"] == pytest.approx(7)

    def test_eval_raises_on_empty_data(self, onnx_model_path):
        with pytest.raises(ValueError, match="No labelled"):
            eval_surface_model(
                onnx_model_path,
                psa_rows=[],
                ebay_rows=[],
                auction_rows=[],
                patch_size=PATCH_SIZE,
            )

    def test_eval_mae_is_finite(self, onnx_model_path, psa_rows):
        import math
        metrics = eval_surface_model(
            onnx_model_path,
            psa_rows=psa_rows,
            ebay_rows=[],
            auction_rows=[],
            patch_size=PATCH_SIZE,
        )
        assert not math.isnan(metrics["mae"])
        assert not math.isinf(metrics["mae"])

    def test_eval_psa_only_works(self, onnx_model_path):
        psa = _make_psa_rows(6)
        metrics = eval_surface_model(
            onnx_model_path,
            psa_rows=psa,
            ebay_rows=[],
            auction_rows=[],
            patch_size=PATCH_SIZE,
        )
        assert metrics["n_samples"] == pytest.approx(6)
