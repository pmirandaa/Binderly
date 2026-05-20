"""Tests for ``grading.aggregate.service``."""

from __future__ import annotations

import pytest

from grading.aggregate.service import (
    HIGH_CONFIDENCE_THRESHOLD,
    HIGH_SPREAD_LIMIT,
    LOW_CONFIDENCE_THRESHOLD,
    LOW_SPREAD_TRIGGER,
    aggregate_subgrades,
    compute_aggregate_confidence_band,
    compute_confidence_band_label,
    infer,
)
from grading.aggregate.types import (
    SUBGRADE_NAMES,
    AggregateWeights,
    SubGradeInputs,
)


# ---------------------------------------------------------------------------
# Float → categorical
# ---------------------------------------------------------------------------


class TestComputeConfidenceBandLabel:
    def test_high_confidence(self):
        assert compute_confidence_band_label(0.9) == "high"

    def test_medium_confidence(self):
        assert compute_confidence_band_label(0.5) == "medium"

    def test_low_confidence(self):
        assert compute_confidence_band_label(0.1) == "low"

    def test_boundary_at_high_threshold(self):
        assert compute_confidence_band_label(HIGH_CONFIDENCE_THRESHOLD) == "high"

    def test_just_below_high_threshold_is_medium(self):
        assert (
            compute_confidence_band_label(HIGH_CONFIDENCE_THRESHOLD - 0.01)
            == "medium"
        )

    def test_boundary_at_low_threshold(self):
        assert (
            compute_confidence_band_label(LOW_CONFIDENCE_THRESHOLD) == "medium"
        )

    def test_just_below_low_threshold_is_low(self):
        assert (
            compute_confidence_band_label(LOW_CONFIDENCE_THRESHOLD - 0.01) == "low"
        )

    def test_clamps_negative_input(self):
        assert compute_confidence_band_label(-0.5) == "low"

    def test_clamps_above_one_input(self):
        assert compute_confidence_band_label(1.5) == "high"

    def test_custom_thresholds(self):
        # Force everything > 0.9 to be 'high'; < 0.1 to be 'low'.
        assert (
            compute_confidence_band_label(0.85, high_threshold=0.9, low_threshold=0.1)
            == "medium"
        )
        assert (
            compute_confidence_band_label(0.95, high_threshold=0.9, low_threshold=0.1)
            == "high"
        )


# ---------------------------------------------------------------------------
# Aggregate-band classifier
# ---------------------------------------------------------------------------


class TestComputeAggregateConfidenceBand:
    def test_all_high_low_spread_returns_high(self):
        band = compute_aggregate_confidence_band(
            {name: "high" for name in SUBGRADE_NAMES}, spread=0.5,
        )
        assert band == "high"

    def test_all_high_at_spread_threshold_is_not_high(self):
        # spread == HIGH_SPREAD_LIMIT (1.0) is NOT < limit → demoted to medium.
        band = compute_aggregate_confidence_band(
            {name: "high" for name in SUBGRADE_NAMES}, spread=HIGH_SPREAD_LIMIT,
        )
        assert band == "medium"

    def test_all_high_at_low_spread_trigger_returns_low(self):
        band = compute_aggregate_confidence_band(
            {name: "high" for name in SUBGRADE_NAMES}, spread=LOW_SPREAD_TRIGGER,
        )
        assert band == "low"

    def test_any_low_forces_low(self):
        labels = {name: "high" for name in SUBGRADE_NAMES}
        labels["surface"] = "low"
        band = compute_aggregate_confidence_band(labels, spread=0.1)
        assert band == "low"

    def test_all_medium_low_spread_returns_medium(self):
        band = compute_aggregate_confidence_band(
            {name: "medium" for name in SUBGRADE_NAMES}, spread=0.5,
        )
        assert band == "medium"

    def test_mixed_high_medium_returns_medium(self):
        labels = {name: "high" for name in SUBGRADE_NAMES}
        labels["edges"] = "medium"
        band = compute_aggregate_confidence_band(labels, spread=0.5)
        assert band == "medium"

    def test_low_spread_trigger_overrides_all_high(self):
        # Even if every per-sub-grade label says 'high', a >=2.0 spread forces 'low'.
        band = compute_aggregate_confidence_band(
            {name: "high" for name in SUBGRADE_NAMES}, spread=2.5,
        )
        assert band == "low"


# ---------------------------------------------------------------------------
# aggregate_subgrades workhorse
# ---------------------------------------------------------------------------


class TestAggregateSubgrades:
    def test_returns_aggregated_grade(self, all_high_inputs):
        result = aggregate_subgrades(all_high_inputs)
        assert result.overall_grade == pytest.approx(9.0)
        assert result.psa_grade == pytest.approx(9.0)
        assert result.confidence_band == "high"

    def test_psa_grade_rounded_to_half_tick(self):
        inputs = SubGradeInputs(
            scores={"centering": 9.0, "corners": 8.0, "edges": 7.0, "surface": 6.0},
            confidences={name: 0.8 for name in SUBGRADE_NAMES},
        )
        result = aggregate_subgrades(inputs)
        # Raw = 7.7; closest 0.5 tick = 7.5
        assert result.psa_grade == pytest.approx(7.5)

    def test_calibration_notes_present(self, all_high_inputs):
        result = aggregate_subgrades(all_high_inputs)
        assert "raw=" in result.calibration_notes
        assert "psa=" in result.calibration_notes
        assert "spread=" in result.calibration_notes

    def test_calibration_notes_lists_all_subgrades(self, all_high_inputs):
        result = aggregate_subgrades(all_high_inputs)
        for name in SUBGRADE_NAMES:
            assert name in result.calibration_notes

    def test_sub_grades_mirror_input(self, all_high_inputs):
        result = aggregate_subgrades(all_high_inputs)
        assert result.sub_grades == all_high_inputs.scores

    def test_medium_inputs_aggregate_medium(self, medium_inputs):
        result = aggregate_subgrades(medium_inputs)
        assert result.confidence_band == "medium"

    def test_low_inputs_by_confidence_aggregate_low(self, low_inputs_by_confidence):
        result = aggregate_subgrades(low_inputs_by_confidence)
        assert result.confidence_band == "low"

    def test_low_inputs_by_spread_aggregate_low(self, low_inputs_by_spread):
        result = aggregate_subgrades(low_inputs_by_spread)
        assert result.confidence_band == "low"
        # spread = 10 - 7.5 = 2.5 ≥ 2.0 → low
        assert "spread=2.50" in result.calibration_notes

    def test_perfect_input_caps_at_10(self):
        inputs = SubGradeInputs(
            scores={name: 10.0 for name in SUBGRADE_NAMES},
            confidences={name: 1.0 for name in SUBGRADE_NAMES},
        )
        result = aggregate_subgrades(inputs)
        assert result.psa_grade == pytest.approx(10.0)
        assert result.overall_grade == pytest.approx(10.0)

    def test_floor_input_floors_at_1(self):
        inputs = SubGradeInputs(
            scores={name: 1.0 for name in SUBGRADE_NAMES},
            confidences={name: 1.0 for name in SUBGRADE_NAMES},
        )
        result = aggregate_subgrades(inputs)
        assert result.psa_grade == pytest.approx(1.0)

    def test_custom_weights_change_output(self, all_high_inputs):
        baseline = aggregate_subgrades(all_high_inputs)
        # Heavy centering weight, but all scores equal — output unchanged.
        biased = AggregateWeights(
            centering=1.0, corners=0.0, edges=0.0, surface=0.0,
        )
        biased_result = aggregate_subgrades(all_high_inputs, weights=biased)
        assert baseline.overall_grade == pytest.approx(biased_result.overall_grade)

    def test_custom_weights_with_skewed_input(self):
        inputs = SubGradeInputs(
            scores={"centering": 10.0, "corners": 5.0, "edges": 5.0, "surface": 5.0},
            confidences={name: 0.9 for name in SUBGRADE_NAMES},
        )
        # Heavy centering weight → output close to 10.
        biased = AggregateWeights(
            centering=1.0, corners=0.0, edges=0.0, surface=0.0,
        )
        result = aggregate_subgrades(inputs, weights=biased)
        assert result.overall_grade == pytest.approx(10.0)

    def test_pure_function_same_inputs_same_output(self, medium_inputs):
        r1 = aggregate_subgrades(medium_inputs)
        r2 = aggregate_subgrades(medium_inputs)
        assert r1.overall_grade == r2.overall_grade
        assert r1.psa_grade == r2.psa_grade
        assert r1.confidence_band == r2.confidence_band

    def test_boundary_just_below_cap(self):
        inputs = SubGradeInputs(
            scores={"centering": 10.0, "corners": 9.5, "edges": 9.5, "surface": 9.5},
            confidences={name: 0.9 for name in SUBGRADE_NAMES},
        )
        result = aggregate_subgrades(inputs)
        assert result.psa_grade <= 10.0

    def test_boundary_at_55(self):
        inputs = SubGradeInputs(
            scores={name: 5.5 for name in SUBGRADE_NAMES},
            confidences={name: 0.9 for name in SUBGRADE_NAMES},
        )
        result = aggregate_subgrades(inputs)
        assert result.psa_grade == pytest.approx(5.5)


# ---------------------------------------------------------------------------
# infer() adapter (consumes upstream prediction dataclasses)
# ---------------------------------------------------------------------------


class TestInferAdapter:
    def test_adapter_returns_aggregated_grade(
        self,
        centering_result_factory,
        corners_prediction_factory,
        edges_prediction_factory,
        surface_prediction_factory,
    ):
        result = infer(
            centering=centering_result_factory("9", low_confidence=False),
            corners=corners_prediction_factory(value=9.0, confidence=0.85),
            edges=edges_prediction_factory(value=9.0, confidence=0.85),
            surface=surface_prediction_factory(value=9.0, confidence=0.85),
        )
        assert result.psa_grade == pytest.approx(9.0)
        assert result.confidence_band == "high"

    def test_adapter_handles_low_confidence_centering(
        self,
        centering_result_factory,
        corners_prediction_factory,
        edges_prediction_factory,
        surface_prediction_factory,
    ):
        result = infer(
            centering=centering_result_factory("9", low_confidence=True),
            corners=corners_prediction_factory(value=9.0, confidence=0.85),
            edges=edges_prediction_factory(value=9.0, confidence=0.85),
            surface=surface_prediction_factory(value=9.0, confidence=0.85),
        )
        assert result.confidence_band == "low"

    def test_adapter_maps_unknown_centering_to_low(
        self,
        centering_result_factory,
        corners_prediction_factory,
        edges_prediction_factory,
        surface_prediction_factory,
    ):
        result = infer(
            centering=centering_result_factory("unknown"),
            corners=corners_prediction_factory(value=9.0, confidence=0.85),
            edges=edges_prediction_factory(value=9.0, confidence=0.85),
            surface=surface_prediction_factory(value=9.0, confidence=0.85),
        )
        assert result.confidence_band == "low"

    def test_adapter_maps_grade_hint_to_score(
        self,
        centering_result_factory,
        corners_prediction_factory,
        edges_prediction_factory,
        surface_prediction_factory,
    ):
        result = infer(
            centering=centering_result_factory("10"),
            corners=corners_prediction_factory(value=10.0, confidence=0.9),
            edges=edges_prediction_factory(value=10.0, confidence=0.9),
            surface=surface_prediction_factory(value=10.0, confidence=0.9),
        )
        assert result.sub_grades["centering"] == pytest.approx(10.0)

    def test_adapter_maps_worse_grade_hint(
        self,
        centering_result_factory,
        corners_prediction_factory,
        edges_prediction_factory,
        surface_prediction_factory,
    ):
        result = infer(
            centering=centering_result_factory("worse"),
            corners=corners_prediction_factory(value=4.0, confidence=0.9),
            edges=edges_prediction_factory(value=4.0, confidence=0.9),
            surface=surface_prediction_factory(value=4.0, confidence=0.9),
        )
        assert result.sub_grades["centering"] == pytest.approx(4.0)

    def test_adapter_reads_corner_aggregate_value(
        self,
        centering_result_factory,
        corners_prediction_factory,
        edges_prediction_factory,
        surface_prediction_factory,
    ):
        result = infer(
            centering=centering_result_factory("9"),
            corners=corners_prediction_factory(value=7.5, confidence=0.8),
            edges=edges_prediction_factory(value=9.0, confidence=0.8),
            surface=surface_prediction_factory(value=9.0, confidence=0.8),
        )
        assert result.sub_grades["corners"] == pytest.approx(7.5)

    def test_adapter_with_custom_weights(
        self,
        centering_result_factory,
        corners_prediction_factory,
        edges_prediction_factory,
        surface_prediction_factory,
    ):
        biased = AggregateWeights(
            centering=0.0, corners=1.0, edges=0.0, surface=0.0,
        )
        result = infer(
            centering=centering_result_factory("9"),
            corners=corners_prediction_factory(value=7.0, confidence=0.85),
            edges=edges_prediction_factory(value=9.0, confidence=0.85),
            surface=surface_prediction_factory(value=9.0, confidence=0.85),
            weights=biased,
        )
        # All weight on corners → psa rounds to 7.0
        assert result.psa_grade == pytest.approx(7.0)
