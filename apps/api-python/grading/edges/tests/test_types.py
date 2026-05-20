"""Tests for edges/types.py — type contracts and validation."""

from __future__ import annotations

import pytest

from grading.edges.types import (
    NUM_STRIPS,
    STRIP_LABELS,
    STRIP_THICKNESS_PX,
    EdgesLabelledSample,
    EdgesRequest,
    EdgesPrediction,
    EdgesSubgrade,
)
from grading.ml_common.types import ConfidenceBand


VALID_BAND = ConfidenceBand(value=8.5, confidence=0.72)
VALID_STRIP_URIS = [f"file:///tmp/strip_{i}.jpg" for i in range(NUM_STRIPS)]


class TestConstants:
    def test_num_strips_is_four(self):
        assert NUM_STRIPS == 4

    def test_strip_labels_length(self):
        assert len(STRIP_LABELS) == NUM_STRIPS

    def test_strip_labels_canonical_order(self):
        assert STRIP_LABELS == ("top", "bottom", "left", "right")

    def test_strip_thickness_positive(self):
        assert STRIP_THICKNESS_PX > 0

    def test_strip_thickness_value(self):
        assert STRIP_THICKNESS_PX == 32


class TestEdgesLabelledSample:
    def test_is_labelled_for_edges_true(self):
        sample = EdgesLabelledSample(
            source="psa_cert",
            source_id="1",
            grade_company="PSA",
            overall_grade=9.0,
            edges_score=8.5,
        )
        assert sample.is_labelled_for_edges() is True

    def test_is_labelled_for_edges_false_when_none(self):
        sample = EdgesLabelledSample(
            source="psa_cert",
            source_id="2",
            grade_company="PSA",
            overall_grade=9.0,
            edges_score=None,
        )
        assert sample.is_labelled_for_edges() is False

    def test_default_image_urls_empty(self):
        sample = EdgesLabelledSample(
            source="psa_cert",
            source_id="3",
            grade_company="PSA",
            overall_grade=9.0,
            edges_score=8.0,
        )
        assert sample.image_urls == []

    def test_frozen_immutable(self):
        sample = EdgesLabelledSample(
            source="psa_cert",
            source_id="4",
            grade_company="PSA",
            overall_grade=9.0,
            edges_score=8.0,
        )
        with pytest.raises((AttributeError, TypeError)):
            sample.edges_score = 7.0  # type: ignore[misc]


class TestEdgesRequest:
    def test_valid_request_creates_ok(self):
        req = EdgesRequest(session_id="test-001", strip_uris=VALID_STRIP_URIS)
        assert req.session_id == "test-001"
        assert len(req.strip_uris) == NUM_STRIPS

    def test_wrong_uri_count_raises(self):
        with pytest.raises(ValueError, match="exactly 4"):
            EdgesRequest(session_id="bad", strip_uris=["only_one.jpg"])

    def test_empty_uris_raises(self):
        with pytest.raises(ValueError, match="exactly 4"):
            EdgesRequest(session_id="empty", strip_uris=[])

    def test_five_uris_raises(self):
        with pytest.raises(ValueError, match="exactly 4"):
            EdgesRequest(session_id="five", strip_uris=[f"mock://{i}.jpg" for i in range(5)])


class TestEdgesPrediction:
    def _make_prediction(self, session_id: str = "test") -> EdgesPrediction:
        per_edge = [
            EdgesSubgrade(label=label, band=VALID_BAND)
            for label in STRIP_LABELS
        ]
        return EdgesPrediction(
            session_id=session_id,
            per_edge=per_edge,
            aggregate=VALID_BAND,
        )

    def test_valid_prediction_creates_ok(self):
        pred = self._make_prediction()
        assert len(pred.per_edge) == NUM_STRIPS

    def test_wrong_per_edge_count_raises(self):
        with pytest.raises(ValueError, match="exactly 4"):
            EdgesPrediction(
                session_id="bad",
                per_edge=[EdgesSubgrade(label="top", band=VALID_BAND)],
                aggregate=VALID_BAND,
            )

    def test_default_model_version(self):
        pred = self._make_prediction()
        assert pred.model_version == "v0-placeholder"

    def test_custom_model_version(self):
        per_edge = [EdgesSubgrade(label=l, band=VALID_BAND) for l in STRIP_LABELS]
        pred = EdgesPrediction(
            session_id="test",
            per_edge=per_edge,
            aggregate=VALID_BAND,
            model_version="v1-prod",
        )
        assert pred.model_version == "v1-prod"

    def test_session_id_stored(self):
        pred = self._make_prediction("session-xyz")
        assert pred.session_id == "session-xyz"
