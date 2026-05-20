"""Shared fixtures for aggregate tests."""

from __future__ import annotations

from typing import Any

import pytest

from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregateWeights,
    SubGradeInputs,
)


# ---------------------------------------------------------------------------
# Synthetic upstream-prediction builders
# ---------------------------------------------------------------------------


def _make_corners_prediction(value: float, confidence: float):
    """Build a minimal CornersPrediction-like object for the adapter tests."""
    from grading.corners.types import (
        CORNER_LABELS,
        CornersPrediction,
        CornersSubgrade,
    )
    from grading.ml_common.types import ConfidenceBand

    band = ConfidenceBand(value=value, confidence=confidence)
    per_corner = [CornersSubgrade(label=label, band=band) for label in CORNER_LABELS]
    return CornersPrediction(
        session_id="agg-test",
        per_corner=per_corner,
        aggregate=band,
    )


def _make_edges_prediction(value: float, confidence: float):
    from grading.edges.types import EdgesPrediction, EdgesSubgrade, STRIP_LABELS
    from grading.ml_common.types import ConfidenceBand

    band = ConfidenceBand(value=value, confidence=confidence)
    per_edge = [EdgesSubgrade(label=label, band=band) for label in STRIP_LABELS]
    return EdgesPrediction(
        session_id="agg-test",
        per_edge=per_edge,
        aggregate=band,
    )


def _make_surface_prediction(value: float, confidence: float):
    from grading.ml_common.types import ConfidenceBand
    from grading.surface.types import (
        SURFACE_SHOT_LABELS_V1,
        SurfacePrediction,
        SurfaceShotPrediction,
    )

    band = ConfidenceBand(value=value, confidence=confidence)
    per_shot = [
        SurfaceShotPrediction(label=label, band=band)
        for label in SURFACE_SHOT_LABELS_V1
    ]
    return SurfacePrediction(
        session_id="agg-test",
        per_shot=per_shot,
        aggregate=band,
    )


def _make_centering_result(
    grade_hint: str = "9",
    low_confidence: bool = False,
):
    from grading.centering.types import CenteringResult

    return CenteringResult(
        margins=None,
        h_ratio=0.65,
        v_ratio=0.65,
        grade_hint=grade_hint,
        low_confidence=low_confidence,
    )


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def default_weights() -> AggregateWeights:
    return DEFAULT_WEIGHTS


@pytest.fixture
def all_high_inputs() -> SubGradeInputs:
    """4 sub-grades scoring 9.0 with high confidence — should aggregate to 'high'."""
    return SubGradeInputs(
        scores={name: 9.0 for name in SUBGRADE_NAMES},
        confidences={name: 0.85 for name in SUBGRADE_NAMES},
    )


@pytest.fixture
def medium_inputs() -> SubGradeInputs:
    """Mixed confidence — should aggregate to 'medium'."""
    return SubGradeInputs(
        scores={"centering": 9.0, "corners": 8.5, "edges": 9.0, "surface": 8.0},
        confidences={"centering": 0.85, "corners": 0.5, "edges": 0.55, "surface": 0.5},
    )


@pytest.fixture
def low_inputs_by_confidence() -> SubGradeInputs:
    """One sub-grade with very low confidence — forces aggregate to 'low'."""
    return SubGradeInputs(
        scores={"centering": 9.0, "corners": 9.0, "edges": 9.0, "surface": 9.0},
        confidences={"centering": 0.85, "corners": 0.85, "edges": 0.85, "surface": 0.1},
    )


@pytest.fixture
def low_inputs_by_spread() -> SubGradeInputs:
    """High per-sub-grade confidence but large score spread — forces 'low'."""
    return SubGradeInputs(
        scores={"centering": 10.0, "corners": 7.5, "edges": 9.0, "surface": 8.0},
        confidences={"centering": 0.9, "corners": 0.9, "edges": 0.9, "surface": 0.9},
    )


@pytest.fixture
def synthetic_psa_rows() -> list[dict[str, Any]]:
    """10 synthetic PSA cert rows with all 4 sub-grades + overall grade."""
    rows: list[dict[str, Any]] = []
    for i in range(10):
        grade = 5.0 + (i % 6)  # 5, 6, 7, 8, 9, 10, 5, 6, 7, 8
        rows.append(
            {
                "source_id": f"PSA-AGG-{i:04d}",
                "grade_company": "PSA",
                "grade": str(grade),
                "subgrades": {
                    "centering": grade,
                    "corners": max(1.0, grade - 0.5),
                    "edges": grade,
                    "surface": max(1.0, grade - 1.0),
                },
                "images": {},
                "printing_id": None,
                "raw_metadata": {},
            }
        )
    return rows


@pytest.fixture
def corners_prediction_factory():
    return _make_corners_prediction


@pytest.fixture
def edges_prediction_factory():
    return _make_edges_prediction


@pytest.fixture
def surface_prediction_factory():
    return _make_surface_prediction


@pytest.fixture
def centering_result_factory():
    return _make_centering_result


@pytest.fixture
def tmp_onnx_path(tmp_path):
    return tmp_path / "aggregate_test.onnx"
