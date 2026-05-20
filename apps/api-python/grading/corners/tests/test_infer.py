"""Tests for corners/infer.py — CornersInferenceEngine."""

from __future__ import annotations

import numpy as np
import pytest

from grading.corners.export import export_corners_model
from grading.corners.infer import CornersInferenceEngine
from grading.corners.model import CornersModel
from grading.corners.tests.conftest import INPUT_DIM, PATCH_SIZE
from grading.corners.types import CORNER_LABELS, NUM_CORNERS, CornersRequest


@pytest.fixture
def engine(tmp_path):
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    model = CornersModel(input_dim=INPUT_DIM, random_seed=7)
    onnx_path = tmp_path / "corners_infer.onnx"
    export_corners_model(model, onnx_path)
    return CornersInferenceEngine(onnx_path, cal_mae=0.8, patch_size=PATCH_SIZE)


DUMMY_URIS = [f"mock://corner_{i}.jpg" for i in range(NUM_CORNERS)]


class TestCornersInferenceEngine:
    def test_predict_from_request_returns_prediction(self, engine):
        req = CornersRequest(session_id="gs-test-001", corner_uris=DUMMY_URIS)
        result = engine.predict_from_request(req)
        assert result.session_id == "gs-test-001"

    def test_prediction_has_four_corners(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        assert len(result.per_corner) == NUM_CORNERS

    def test_per_corner_labels_correct(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        labels = [c.label for c in result.per_corner]
        assert labels == list(CORNER_LABELS)

    def test_aggregate_value_in_range(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        assert 1.0 <= result.aggregate.value <= 10.0

    def test_aggregate_confidence_in_range(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        assert 0.0 <= result.aggregate.confidence <= 1.0

    def test_per_corner_values_in_range(self, engine):
        result = engine.predict_from_uris(DUMMY_URIS, session_id="gs-001")
        for subgrade in result.per_corner:
            assert 1.0 <= subgrade.band.value <= 10.0

    def test_predict_raw_shape(self, engine):
        rng = np.random.default_rng(0)
        X = rng.random((3, INPUT_DIM), dtype=np.float32)
        out = engine.predict(X)
        assert out.shape == (3,)

    def test_invalid_uri_count_raises(self, engine):
        with pytest.raises(ValueError, match="exactly 4"):
            engine.predict_from_uris(["mock://only_one.jpg"], session_id="gs-bad")
