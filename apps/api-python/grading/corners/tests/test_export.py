"""Tests for corners/export.py — ONNX export + round-trip inference."""

from __future__ import annotations

import numpy as np
import pytest

from grading.corners.export import export_corners_model
from grading.corners.model import CornersModel
from grading.corners.tests.conftest import INPUT_DIM, PATCH_SIZE


@pytest.mark.parametrize("input_dim", [INPUT_DIM, 48])
def test_export_creates_onnx_file(tmp_path, input_dim):
    pytest.importorskip("onnx")
    model = CornersModel(input_dim=input_dim)
    output = tmp_path / "corners.onnx"
    result = export_corners_model(model, output, input_dim=input_dim)
    assert result.exists()
    assert result.suffix == ".onnx"


def test_export_round_trip_output_matches(tmp_path):
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")

    from grading.ml_common.model_export import load_onnx_session, run_onnx_inference

    model = CornersModel(input_dim=INPUT_DIM, random_seed=99)
    output = tmp_path / "corners_rt.onnx"
    export_corners_model(model, output)

    rng = np.random.default_rng(42)
    X = rng.random((4, INPUT_DIM), dtype=np.float32)

    direct = model.forward(X)
    session = load_onnx_session(output)
    onnx_out = run_onnx_inference(session, X).flatten()

    np.testing.assert_allclose(direct, onnx_out, atol=1e-4)


def test_export_onnx_is_valid_model(tmp_path):
    pytest.importorskip("onnx")
    import onnx

    model = CornersModel(input_dim=INPUT_DIM)
    output = tmp_path / "corners_valid.onnx"
    export_corners_model(model, output)

    loaded = onnx.load(str(output))
    onnx.checker.check_model(loaded)


def test_export_missing_parent_dir_created(tmp_path):
    pytest.importorskip("onnx")
    model = CornersModel(input_dim=INPUT_DIM)
    nested = tmp_path / "nested" / "dir" / "corners.onnx"
    export_corners_model(model, nested)
    assert nested.exists()
