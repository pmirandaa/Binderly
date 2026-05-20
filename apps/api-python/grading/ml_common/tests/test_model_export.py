"""Tests for ml_common/model_export.py."""

from __future__ import annotations

import numpy as np
import pytest

from grading.corners.model import CornersModel
from grading.corners.tests.conftest import INPUT_DIM
from grading.ml_common.model_export import export_to_onnx, load_onnx_session, run_onnx_inference


@pytest.fixture
def linear_model():
    return CornersModel(input_dim=INPUT_DIM, random_seed=7)


class TestExportToOnnx:
    def test_creates_file(self, tmp_path, linear_model):
        pytest.importorskip("onnx")
        out = tmp_path / "test.onnx"
        result = export_to_onnx(linear_model, out, input_dim=INPUT_DIM)
        assert result.exists()

    def test_file_is_nonempty(self, tmp_path, linear_model):
        pytest.importorskip("onnx")
        out = tmp_path / "test.onnx"
        export_to_onnx(linear_model, out, input_dim=INPUT_DIM)
        assert out.stat().st_size > 0

    def test_creates_parent_dirs(self, tmp_path, linear_model):
        pytest.importorskip("onnx")
        nested = tmp_path / "a" / "b" / "model.onnx"
        export_to_onnx(linear_model, nested, input_dim=INPUT_DIM)
        assert nested.exists()


class TestLoadOnnxSession:
    def test_loads_valid_model(self, tmp_path, linear_model):
        pytest.importorskip("onnx")
        pytest.importorskip("onnxruntime")
        out = tmp_path / "load_test.onnx"
        export_to_onnx(linear_model, out, input_dim=INPUT_DIM)
        session = load_onnx_session(out)
        assert session is not None

    def test_raises_file_not_found(self):
        pytest.importorskip("onnxruntime")
        with pytest.raises(FileNotFoundError):
            load_onnx_session("/nonexistent/path/model.onnx")


class TestRoundTrip:
    def test_onnx_output_matches_numpy(self, tmp_path, linear_model):
        pytest.importorskip("onnx")
        pytest.importorskip("onnxruntime")
        out = tmp_path / "roundtrip.onnx"
        export_to_onnx(linear_model, out, input_dim=INPUT_DIM)

        rng = np.random.default_rng(0)
        X = rng.random((5, INPUT_DIM), dtype=np.float32)

        direct = linear_model.forward(X)
        session = load_onnx_session(out)
        onnx_out = run_onnx_inference(session, X).flatten()

        np.testing.assert_allclose(direct, onnx_out, atol=1e-4)

    def test_batch_inference_shape(self, tmp_path, linear_model):
        pytest.importorskip("onnx")
        pytest.importorskip("onnxruntime")
        out = tmp_path / "batch.onnx"
        export_to_onnx(linear_model, out, input_dim=INPUT_DIM)
        session = load_onnx_session(out)
        X = np.random.default_rng(1).random((8, INPUT_DIM), dtype=np.float32)
        out_arr = run_onnx_inference(session, X)
        assert out_arr.shape == (8, 1)
