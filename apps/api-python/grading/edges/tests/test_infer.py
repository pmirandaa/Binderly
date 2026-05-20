"""Tests for edges/infer.py — EdgesInferenceEngine."""

from __future__ import annotations

import numpy as np
import pytest

from grading.edges.export import export_edges_model
from grading.edges.infer import EdgesInferenceEngine
from grading.edges.model import EdgesModel
from grading.edges.tests.conftest import INPUT_DIM, PATCH_SIZE
from grading.edges.types import STRIP_LABELS, NUM_STRIPS, EdgesRequest


@pytest.fixture
def engine(tmp_path):
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    model = EdgesModel(input_dim=INPUT_DIM, random_seed=7)
    onnx_path = tmp_path / "edges_infer.onnx"
    export_edges_model(model, onnx_path)
    return EdgesInferenceEngine(onnx_path, cal_mae=0.8, patch_size=PATCH_SIZE)


DUMMY_URIS = [f"mock://strip_{i}.jpg" for i in range(NUM_STRIPS)]


class TestEdgesInferenceEngine:
    def test_predict_from_request_returns_prediction(self, engine):
        req = EdgesRequest(session_id="gs-test-001", strip_uris=DUMMY_URIS)
        result = engine.predict_from_request(req)
        assert result.session_id == "gs-test-001"

    def test_prediction_has_four_edges(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        assert len(result.per_edge) == NUM_STRIPS

    def test_per_edge_labels_correct(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        labels = [e.label for e in result.per_edge]
        assert labels == list(STRIP_LABELS)

    def test_aggregate_value_in_range(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        assert 1.0 <= result.aggregate.value <= 10.0

    def test_aggregate_confidence_in_range(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        assert 0.0 <= result.aggregate.confidence <= 1.0

    def test_per_edge_values_in_range(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        for subgrade in result.per_edge:
            assert 1.0 <= subgrade.band.value <= 10.0

    def test_predict_raw_shape(self, engine):
        rng = np.random.default_rng(0)
        X = rng.random((3, INPUT_DIM), dtype=np.float32)
        out = engine.predict(X)
        assert out.shape == (3,)

    def test_invalid_uri_count_raises(self, engine):
        with pytest.raises(ValueError, match="exactly 4"):
            engine.predict_from_uris(["mock://only_one.jpg"], session_id="gs-bad")

    def test_session_id_preserved(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="my-session-42")
        assert result.session_id == "my-session-42"

    def test_empty_session_id_accepted(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="")
        assert result.session_id == ""

    def test_aggregate_is_weakest_edge(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="agg-test")
        min_val = min(e.band.value for e in result.per_edge)
        assert result.aggregate.value <= min_val + 1e-5

    def test_per_edge_confidence_in_range(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="conf-test")
        for edge in result.per_edge:
            assert 0.0 <= edge.band.confidence <= 1.0
