"""Tests for the PSA centering grade hint mapping."""

from __future__ import annotations

import pytest

from grading.centering.grade import centering_grade_hint, ratio_from_margins


class TestRatioFromMargins:
    def test_equal_margins_returns_one(self) -> None:
        assert ratio_from_margins(50.0, 50.0) == pytest.approx(1.0)

    def test_asymmetric_returns_min_over_max(self) -> None:
        assert ratio_from_margins(40.0, 60.0) == pytest.approx(40 / 60, rel=1e-5)

    def test_reversed_order_same_result(self) -> None:
        assert ratio_from_margins(60.0, 40.0) == pytest.approx(40 / 60, rel=1e-5)

    def test_zero_max_returns_zero(self) -> None:
        assert ratio_from_margins(0.0, 0.0) == 0.0

    def test_negative_raises(self) -> None:
        with pytest.raises(ValueError):
            ratio_from_margins(-1.0, 10.0)

    def test_returns_float(self) -> None:
        r = ratio_from_margins(30.0, 70.0)
        assert isinstance(r, float)


class TestCenteringGradeHint:
    # --- PSA 10: both axes ≥ 45/55 ≈ 0.818 ---
    def test_perfect_centre_is_grade_10(self) -> None:
        # 50/50 → ratio = 1.0 — best possible.
        assert centering_grade_hint(1.0, 1.0) == "10"

    def test_55_45_is_grade_10(self) -> None:
        ratio = 45 / 55
        assert centering_grade_hint(ratio, ratio) == "10"

    def test_just_below_55_45_is_grade_9(self) -> None:
        ratio = 44 / 56  # barely outside 55/45 tolerance
        assert centering_grade_hint(ratio, ratio) == "9"

    # --- PSA 9: both axes ≥ 40/60 ≈ 0.667 ---
    def test_60_40_is_grade_9(self) -> None:
        ratio = 40 / 60
        assert centering_grade_hint(ratio, ratio) == "9"

    def test_just_below_60_40_is_grade_8(self) -> None:
        ratio = 39 / 61
        assert centering_grade_hint(ratio, ratio) == "8"

    # --- PSA 8: both axes ≥ 35/65 ---
    def test_65_35_is_grade_8(self) -> None:
        ratio = 35 / 65
        assert centering_grade_hint(ratio, ratio) == "8"

    # --- PSA 7: both axes ≥ 30/70 ---
    def test_70_30_is_grade_7(self) -> None:
        ratio = 30 / 70
        assert centering_grade_hint(ratio, ratio) == "7"

    def test_below_70_30_is_worse(self) -> None:
        ratio = 29 / 71
        assert centering_grade_hint(ratio, ratio) == "worse"

    # --- Axis mismatch: worst axis dominates ---
    def test_one_axis_perfect_other_at_60_40_is_9(self) -> None:
        assert centering_grade_hint(1.0, 40 / 60) == "9"

    def test_one_axis_perfect_other_below_30_70_is_worse(self) -> None:
        assert centering_grade_hint(1.0, 25 / 75) == "worse"

    # --- None inputs ---
    def test_both_none_is_unknown(self) -> None:
        assert centering_grade_hint(None, None) == "unknown"

    def test_h_none_uses_v_only(self) -> None:
        # Only v is available; v=0.9 → grade 10.
        assert centering_grade_hint(None, 0.9) == "10"

    def test_v_none_uses_h_only(self) -> None:
        assert centering_grade_hint(40 / 60, None) == "9"
