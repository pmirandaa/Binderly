"""Tests for ``grading.aggregate.export`` — ONNX round-trip."""

from __future__ import annotations

import numpy as np
import pytest

from grading.aggregate.export import export_aggregate_model
from grading.aggregate.model import LinearWeightedAggregator
from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregateWeights,
)


class TestExportAggregateModel:
    def test_export_writes_file(self, tmp_onnx_path):
        pytest.importorskip("onnx")
        agg = LinearWeightedAggregator()
        out = export_aggregate_model(agg, tmp_onnx_path)
        assert out.exists()

    def test_export_passes_onnx_checker(self, tmp_onnx_path):
        onnx = pytest.importorskip("onnx")
        agg = LinearWeightedAggregator()
        out = export_aggregate_model(agg, tmp_onnx_path)
        model_proto = onnx.load(str(out))
        onnx.checker.check_model(model_proto)

    def test_export_with_custom_weights(self, tmp_onnx_path):
        pytest.importorskip("onnx")
        w = AggregateWeights(centering=0.4, corners=0.3, edges=0.2, surface=0.1)
        agg = LinearWeightedAggregator(weights=w)
        out = export_aggregate_model(agg, tmp_onnx_path)
        assert out.exists()

    def test_onnx_runtime_inference_matches_numpy_forward(self, tmp_onnx_path):
        pytest.importorskip("onnx")
        ort = pytest.importorskip("onnxruntime")
        agg = LinearWeightedAggregator()
        out = export_aggregate_model(agg, tmp_onnx_path)

        session = ort.InferenceSession(
            str(out), providers=["CPUExecutionProvider"],
        )
        X = np.array(
            [[9.0, 8.0, 7.0, 6.0], [10.0, 10.0, 10.0, 10.0]],
            dtype=np.float32,
        )
        outputs = session.run(None, {"input": X})[0].flatten()
        expected = agg.forward(X)
        for got, want in zip(outputs, expected):
            assert got == pytest.approx(float(want), abs=1e-4)

    def test_onnx_runtime_output_clamps_to_range(self, tmp_onnx_path):
        pytest.importorskip("onnx")
        ort = pytest.importorskip("onnxruntime")
        agg = LinearWeightedAggregator()
        out = export_aggregate_model(agg, tmp_onnx_path)
        session = ort.InferenceSession(
            str(out), providers=["CPUExecutionProvider"],
        )
        # Inputs at the floor and at the cap.
        X = np.array(
            [[1.0, 1.0, 1.0, 1.0], [10.0, 10.0, 10.0, 10.0]],
            dtype=np.float32,
        )
        outputs = session.run(None, {"input": X})[0].flatten()
        assert outputs[0] == pytest.approx(1.0, abs=1e-4)
        assert outputs[1] == pytest.approx(10.0, abs=1e-4)

    def test_input_dim_in_export_matches_subgrade_count(self, tmp_onnx_path):
        onnx = pytest.importorskip("onnx")
        agg = LinearWeightedAggregator()
        out = export_aggregate_model(agg, tmp_onnx_path)
        model_proto = onnx.load(str(out))
        input_shape = model_proto.graph.input[0].type.tensor_type.shape.dim
        # [batch, 4]
        assert len(input_shape) == 2
        assert input_shape[1].dim_value == len(SUBGRADE_NAMES)

    def test_default_priors_persisted_in_exported_model(self, tmp_onnx_path):
        pytest.importorskip("onnx")
        ort = pytest.importorskip("onnxruntime")
        agg = LinearWeightedAggregator(weights=DEFAULT_WEIGHTS)
        out = export_aggregate_model(agg, tmp_onnx_path)
        session = ort.InferenceSession(
            str(out), providers=["CPUExecutionProvider"],
        )
        # X = [9, 8, 7, 6] → weighted sum with defaults = 7.7 (see test_model).
        X = np.array([[9.0, 8.0, 7.0, 6.0]], dtype=np.float32)
        outputs = session.run(None, {"input": X})[0].flatten()
        assert outputs[0] == pytest.approx(7.7, abs=1e-4)
