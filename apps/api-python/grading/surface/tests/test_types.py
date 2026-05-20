"""Tests for surface/types.py — SurfaceRequest, SurfacePrediction, etc."""

from __future__ import annotations

import pytest

from grading.ml_common.types import ConfidenceBand
from grading.surface.types import (
    NUM_SURFACE_SHOTS_V1,
    NUM_SURFACE_SHOTS_WITH_RAKING,
    SURFACE_SHOT_LABELS_V1,
    SURFACE_SHOT_LABELS_WITH_RAKING,
    SurfacePrediction,
    SurfaceRequest,
    SurfaceShotPrediction,
)


# ---------------------------------------------------------------------------
# SurfaceRequest
# ---------------------------------------------------------------------------


class TestSurfaceRequest:
    def test_basic_v1_request(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
        )
        assert req.session_id == "gs-001"
        assert req.raking_light_uri is None

    def test_shot_uris_v1_has_two(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
        )
        assert req.shot_uris == ["file:///front.jpg", "file:///back.jpg"]

    def test_shot_uris_with_raking_has_three(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
            raking_light_uri="file:///raking.jpg",
        )
        assert len(req.shot_uris) == 3
        assert req.shot_uris[2] == "file:///raking.jpg"

    def test_num_shots_v1(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
        )
        assert req.num_shots == NUM_SURFACE_SHOTS_V1

    def test_num_shots_with_raking(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
            raking_light_uri="file:///raking.jpg",
        )
        assert req.num_shots == NUM_SURFACE_SHOTS_WITH_RAKING

    def test_shot_labels_v1(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
        )
        assert req.shot_labels == SURFACE_SHOT_LABELS_V1

    def test_shot_labels_with_raking(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
            raking_light_uri="file:///raking.jpg",
        )
        assert req.shot_labels == SURFACE_SHOT_LABELS_WITH_RAKING

    def test_is_frozen(self):
        req = SurfaceRequest(
            session_id="gs-001",
            front_full_uri="file:///front.jpg",
            back_full_uri="file:///back.jpg",
        )
        with pytest.raises((AttributeError, TypeError)):
            req.session_id = "changed"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# SurfacePrediction
# ---------------------------------------------------------------------------


class TestSurfacePrediction:
    def _make_shot(self, label: str, value: float = 8.5) -> SurfaceShotPrediction:
        return SurfaceShotPrediction(
            label=label,
            band=ConfidenceBand(value=value, confidence=0.7),
        )

    def test_v1_prediction_valid(self):
        pred = SurfacePrediction(
            session_id="gs-001",
            per_shot=[
                self._make_shot("front_full"),
                self._make_shot("back_full"),
            ],
            aggregate=ConfidenceBand(value=8.5, confidence=0.7),
        )
        assert pred.session_id == "gs-001"
        assert len(pred.per_shot) == 2

    def test_with_raking_prediction_valid(self):
        pred = SurfacePrediction(
            session_id="gs-001",
            per_shot=[
                self._make_shot("front_full"),
                self._make_shot("back_full"),
                self._make_shot("raking_light"),
            ],
            aggregate=ConfidenceBand(value=8.5, confidence=0.7),
        )
        assert len(pred.per_shot) == 3

    def test_wrong_shot_count_raises(self):
        with pytest.raises(ValueError, match="per-shot entries"):
            SurfacePrediction(
                session_id="gs-001",
                per_shot=[self._make_shot("front_full")],
                aggregate=ConfidenceBand(value=8.5, confidence=0.7),
            )

    def test_default_model_version(self):
        pred = SurfacePrediction(
            session_id="gs-001",
            per_shot=[self._make_shot("front_full"), self._make_shot("back_full")],
            aggregate=ConfidenceBand(value=8.5, confidence=0.7),
        )
        assert pred.model_version == "v0-placeholder"

    def test_constants_values(self):
        assert NUM_SURFACE_SHOTS_V1 == 2
        assert NUM_SURFACE_SHOTS_WITH_RAKING == 3
        assert len(SURFACE_SHOT_LABELS_V1) == 2
        assert len(SURFACE_SHOT_LABELS_WITH_RAKING) == 3
        assert "raking_light" in SURFACE_SHOT_LABELS_WITH_RAKING
