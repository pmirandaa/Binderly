"""Tests for ``grading.aggregate.types`` — input + output invariants."""

from __future__ import annotations

import pytest

from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregatedGrade,
    AggregateWeights,
    SubGradeInputs,
)


class TestAggregateWeights:
    def test_default_weights_sum_to_one(self):
        w = DEFAULT_WEIGHTS
        total = w.centering + w.corners + w.edges + w.surface
        assert abs(total - 1.0) < 1e-6

    def test_default_priors_match_documented(self):
        w = DEFAULT_WEIGHTS
        assert w.centering == pytest.approx(0.25)
        assert w.corners == pytest.approx(0.35)
        assert w.edges == pytest.approx(0.25)
        assert w.surface == pytest.approx(0.15)

    def test_constructor_configurable(self):
        w = AggregateWeights(
            centering=0.3, corners=0.3, edges=0.2, surface=0.2
        )
        assert w.centering == pytest.approx(0.3)
        assert w.corners == pytest.approx(0.3)

    def test_rejects_negative_weight(self):
        with pytest.raises(ValueError, match="must be in"):
            AggregateWeights(centering=-0.1, corners=0.4, edges=0.4, surface=0.3)

    def test_rejects_weight_above_one(self):
        with pytest.raises(ValueError, match="must be in"):
            AggregateWeights(centering=1.2, corners=0.0, edges=0.0, surface=0.0)

    def test_rejects_weights_not_summing_to_one(self):
        with pytest.raises(ValueError, match="must sum to 1.0"):
            AggregateWeights(
                centering=0.5, corners=0.5, edges=0.5, surface=0.5
            )

    def test_accepts_weights_close_to_one(self):
        # Within 1e-6 tolerance.
        w = AggregateWeights(
            centering=0.25, corners=0.35, edges=0.25, surface=0.15 + 1e-7,
        )
        assert w is not None

    def test_as_dict_returns_all_subgrades(self):
        w = DEFAULT_WEIGHTS
        d = w.as_dict()
        assert set(d.keys()) == set(SUBGRADE_NAMES)

    def test_as_vector_canonical_order(self):
        w = DEFAULT_WEIGHTS
        v = w.as_vector()
        assert v == (0.25, 0.35, 0.25, 0.15)

    def test_subgrade_names_canonical(self):
        assert SUBGRADE_NAMES == ("centering", "corners", "edges", "surface")


class TestSubGradeInputs:
    def test_well_formed_inputs(self):
        inputs = SubGradeInputs(
            scores={name: 9.0 for name in SUBGRADE_NAMES},
            confidences={name: 0.8 for name in SUBGRADE_NAMES},
        )
        assert inputs.scores == {
            "centering": 9.0, "corners": 9.0, "edges": 9.0, "surface": 9.0,
        }

    def test_rejects_missing_score_key(self):
        with pytest.raises(ValueError, match="scores must contain"):
            SubGradeInputs(
                scores={"centering": 9.0, "corners": 9.0, "edges": 9.0},
                confidences={name: 0.8 for name in SUBGRADE_NAMES},
            )

    def test_rejects_missing_confidence_key(self):
        with pytest.raises(ValueError, match="confidences must contain"):
            SubGradeInputs(
                scores={name: 9.0 for name in SUBGRADE_NAMES},
                confidences={"centering": 0.8, "corners": 0.8, "edges": 0.8},
            )

    def test_rejects_extra_score_key(self):
        with pytest.raises(ValueError, match="scores must contain"):
            SubGradeInputs(
                scores={**{name: 9.0 for name in SUBGRADE_NAMES}, "fake": 1.0},
                confidences={name: 0.8 for name in SUBGRADE_NAMES},
            )

    def test_rejects_out_of_range_score_low(self):
        with pytest.raises(ValueError, match="scores"):
            SubGradeInputs(
                scores={**{name: 9.0 for name in SUBGRADE_NAMES}, "centering": 0.5},
                confidences={name: 0.8 for name in SUBGRADE_NAMES},
            )

    def test_rejects_out_of_range_score_high(self):
        with pytest.raises(ValueError, match="scores"):
            SubGradeInputs(
                scores={**{name: 9.0 for name in SUBGRADE_NAMES}, "centering": 10.5},
                confidences={name: 0.8 for name in SUBGRADE_NAMES},
            )

    def test_rejects_out_of_range_confidence(self):
        with pytest.raises(ValueError, match="confidences"):
            SubGradeInputs(
                scores={name: 9.0 for name in SUBGRADE_NAMES},
                confidences={
                    **{name: 0.8 for name in SUBGRADE_NAMES},
                    "centering": 1.5,
                },
            )

    def test_score_vector_canonical_order(self):
        inputs = SubGradeInputs(
            scores={"centering": 1.0, "corners": 2.0, "edges": 3.0, "surface": 4.0},
            confidences={name: 0.5 for name in SUBGRADE_NAMES},
        )
        assert inputs.score_vector() == (1.0, 2.0, 3.0, 4.0)

    def test_spread_zero_when_all_equal(self):
        inputs = SubGradeInputs(
            scores={name: 8.0 for name in SUBGRADE_NAMES},
            confidences={name: 0.5 for name in SUBGRADE_NAMES},
        )
        assert inputs.spread() == pytest.approx(0.0)

    def test_spread_max_minus_min(self):
        inputs = SubGradeInputs(
            scores={"centering": 10.0, "corners": 7.0, "edges": 8.0, "surface": 9.0},
            confidences={name: 0.5 for name in SUBGRADE_NAMES},
        )
        assert inputs.spread() == pytest.approx(3.0)


class TestAggregatedGrade:
    def test_well_formed(self):
        ag = AggregatedGrade(
            overall_grade=8.7,
            psa_grade=8.5,
            confidence_band="medium",
            sub_grades={name: 8.5 for name in SUBGRADE_NAMES},
            calibration_notes="ok",
        )
        assert ag.psa_grade == 8.5

    def test_rejects_overall_below_floor(self):
        with pytest.raises(ValueError, match="overall_grade"):
            AggregatedGrade(
                overall_grade=0.5,
                psa_grade=1.0,
                confidence_band="low",
            )

    def test_rejects_overall_above_cap(self):
        with pytest.raises(ValueError, match="overall_grade"):
            AggregatedGrade(
                overall_grade=10.5,
                psa_grade=10.0,
                confidence_band="high",
            )

    def test_rejects_non_half_tick_psa(self):
        with pytest.raises(ValueError, match="0.5 tick"):
            AggregatedGrade(
                overall_grade=8.7,
                psa_grade=8.7,
                confidence_band="medium",
            )

    def test_rejects_psa_above_cap(self):
        with pytest.raises(ValueError, match="psa_grade"):
            AggregatedGrade(
                overall_grade=10.0,
                psa_grade=10.5,
                confidence_band="high",
            )

    def test_rejects_bad_band_value(self):
        with pytest.raises(ValueError, match="confidence_band"):
            AggregatedGrade(
                overall_grade=8.5,
                psa_grade=8.5,
                confidence_band="great",  # type: ignore[arg-type]
            )

    def test_psa_grade_accepts_all_ticks(self):
        for tick_int in range(2, 21):  # 1.0 .. 10.0 in 0.5 steps
            psa = tick_int / 2.0
            ag = AggregatedGrade(
                overall_grade=psa,
                psa_grade=psa,
                confidence_band="medium",
            )
            assert ag.psa_grade == psa
