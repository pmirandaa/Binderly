"""Tests for surface/export.py — ONNX export + round-trip inference."""

from __future__ import annotations

import numpy as np
import pytest

from grading.surface.export import export_surface_model
from grading.surface.model import SurfaceModel
from grading.surface.tests.conftest import INPUT_DIM, PATCH_SIZE


@pytest.mark.parametrize("input_dim", [INPUT_DIM, 96])
def test_export_creates_onnx_file(tmp_path, input_dim):
    pytest.importorskip("onnx")
    model = SurfaceModel(input_dim=input_dim)
    output = tmp_path / "surface.onnx"
    result = export_surface_model(model, output, input_dim=input_dim)
    assert result.exists()
    assert result.suffix == ".onnx"


def test_export_round_trip_output_matches(tmp_path):
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")

    from grading.ml_common.model_export import load_onnx_session, run_onnx_inference

    model = SurfaceModel(input_dim=INPUT_DIM, random_seed=99)
    output = tmp_path / "surface_rt.onnx"
    export_surface_model(model, output)

    rng = np.random.default_rng(42)
    X = rng.random((4, INPUT_DIM)).astype(np.float32)

    direct = model.forward(X)
    session = load_onnx_session(output)
    onnx_out = run_onnx_inference(session, X).flatten()

    np.testing.assert_allclose(direct, onnx_out, atol=1e-4)


def test_export_onnx_is_valid_model(tmp_path):
    pytest.importorskip("onnx")
    import onnx

    model = SurfaceModel(input_dim=INPUT_DIM)
    output = tmp_path / "surface_valid.onnx"
    export_surface_model(model, output)

    loaded = onnx.load(str(output))
    onnx.checker.check_model(loaded)


def test_export_missing_parent_dir_created(tmp_path):
    pytest.importorskip("onnx")
    model = SurfaceModel(input_dim=INPUT_DIM)
    nested = tmp_path / "nested" / "dir" / "surface.onnx"
    export_surface_model(model, nested)
    assert nested.exists()


def test_export_uses_model_input_dim_by_default(tmp_path):
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    from grading.ml_common.model_export import load_onnx_session, run_onnx_inference

    model = SurfaceModel(input_dim=INPUT_DIM)
    output = tmp_path / "surface_default.onnx"
    export_surface_model(model, output)

    rng = np.random.default_rng(0)
    X = rng.random((2, INPUT_DIM)).astype(np.float32)
    session = load_onnx_session(output)
    out = run_onnx_inference(session, X)
    assert out.shape[0] == 2


def test_export_output_file_has_content(tmp_path):
    pytest.importorskip("onnx")
    model = SurfaceModel(input_dim=INPUT_DIM)
    output = tmp_path / "surface_content.onnx"
    export_surface_model(model, output)
    assert output.stat().st_size > 0


def test_export_returns_path_object(tmp_path):
    pytest.importorskip("onnx")
    from pathlib import Path

    model = SurfaceModel(input_dim=INPUT_DIM)
    output = tmp_path / "surface_path.onnx"
    result = export_surface_model(model, output)
    assert isinstance(result, Path)
