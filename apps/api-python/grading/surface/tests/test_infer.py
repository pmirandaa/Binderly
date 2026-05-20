"""Tests for surface/infer.py — SurfaceInferenceEngine."""

from __future__ import annotations

import numpy as np
import pytest

from grading.surface.export import export_surface_model
from grading.surface.infer import SurfaceInferenceEngine
from grading.surface.model import SurfaceModel
from grading.surface.tests.conftest import INPUT_DIM, PATCH_SIZE
from grading.surface.types import (
    NUM_SURFACE_SHOTS_V1,
    NUM_SURFACE_SHOTS_WITH_RAKING,
    SurfaceRequest,
)


@pytest.fixture
def engine(tmp_path):
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    model = SurfaceModel(input_dim=INPUT_DIM, random_seed=7)
    onnx_path = tmp_path / "surface_infer.onnx"
    export_surface_model(model, onnx_path)
    return SurfaceInferenceEngine(onnx_path, cal_mae=0.9, patch_size=PATCH_SIZE)


DUMMY_FRONT_URI = "mock://surface_front.jpg"
DUMMY_BACK_URI = "mock://surface_back.jpg"
DUMMY_RAKING_URI = "mock://surface_raking.jpg"


class TestSurfaceInferenceEngine:
    def test_predict_from_request_returns_prediction(self, engine):
        req = SurfaceRequest(
            session_id="gs-surf-001",
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
        )
        result = engine.predict_from_request(req)
        assert result.session_id == "gs-surf-001"

    def test_v1_prediction_has_two_shots(self, engine):
        req = SurfaceRequest(
            session_id="gs-surf-001",
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
        )
        result = engine.predict_from_request(req)
        assert len(result.per_shot) == NUM_SURFACE_SHOTS_V1

    def test_per_shot_labels_v1(self, engine):
        req = SurfaceRequest(
            session_id="gs-surf-001",
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
        )
        result = engine.predict_from_request(req)
        labels = [s.label for s in result.per_shot]
        assert labels == ["front_full", "back_full"]

    def test_aggregate_value_in_range(self, engine):
        req = SurfaceRequest(
            session_id="gs-surf-001",
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
        )
        result = engine.predict_from_request(req)
        assert 1.0 <= result.aggregate.value <= 10.0

    def test_aggregate_confidence_in_range(self, engine):
        req = SurfaceRequest(
            session_id="gs-surf-001",
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
        )
        result = engine.predict_from_request(req)
        assert 0.0 <= result.aggregate.confidence <= 1.0

    def test_per_shot_values_in_range(self, engine):
        req = SurfaceRequest(
            session_id="gs-surf-001",
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
        )
        result = engine.predict_from_request(req)
        for shot in result.per_shot:
            assert 1.0 <= shot.band.value <= 10.0

    def test_predict_raw_shape(self, engine):
        rng = np.random.default_rng(0)
        X = rng.random((3, INPUT_DIM)).astype(np.float32)
        out = engine.predict(X)
        assert out.shape == (3,)

    def test_predict_from_uris_convenience_wrapper(self, engine):
        result = engine.predict_from_uris(
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
            session_id="gs-conv-001",
        )
        assert result.session_id == "gs-conv-001"
        assert len(result.per_shot) == NUM_SURFACE_SHOTS_V1

    def test_raking_light_optional_produces_two_shots_without_it(self, engine):
        result = engine.predict_from_uris(
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
            raking_light_uri=None,
            session_id="gs-nrl-001",
        )
        assert len(result.per_shot) == NUM_SURFACE_SHOTS_V1

    def test_session_id_preserved_in_result(self, engine):
        req = SurfaceRequest(
            session_id="my-session-xyz",
            front_full_uri=DUMMY_FRONT_URI,
            back_full_uri=DUMMY_BACK_URI,
        )
        result = engine.predict_from_request(req)
        assert result.session_id == "my-session-xyz"
