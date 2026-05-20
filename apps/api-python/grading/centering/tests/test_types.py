"""Tests for the centering result types."""

from __future__ import annotations

from grading.centering.types import CardRect, CenteringResult, Margins


class TestCardRect:
    def test_x2_y2_properties(self) -> None:
        rect = CardRect(x=10, y=20, width=100, height=200)
        assert rect.x2 == 110
        assert rect.y2 == 220

    def test_frozen(self) -> None:
        import pytest

        rect = CardRect(x=0, y=0, width=50, height=80)
        with pytest.raises((AttributeError, TypeError)):
            rect.x = 99  # type: ignore[misc]

    def test_default_angle_zero(self) -> None:
        rect = CardRect(x=0, y=0, width=100, height=100)
        assert rect.angle == 0.0


class TestCenteringResult:
    def test_grade_hint_propagated(self) -> None:
        result = CenteringResult(
            margins=Margins(top=50, bottom=50, left=50, right=50),
            h_ratio=1.0,
            v_ratio=1.0,
            grade_hint="10",
        )
        assert result.grade_hint == "10"

    def test_unknown_grade_with_no_margins(self) -> None:
        result = CenteringResult(
            margins=None,
            h_ratio=None,
            v_ratio=None,
            grade_hint="unknown",
            low_confidence=True,
        )
        assert result.grade_hint == "unknown"
        assert result.low_confidence
        assert result.margins is None

    def test_flags_default_empty(self) -> None:
        result = CenteringResult(
            margins=None,
            h_ratio=None,
            v_ratio=None,
            grade_hint="unknown",
        )
        assert result.flags == []

    def test_low_confidence_holographic_default_false(self) -> None:
        result = CenteringResult(
            margins=None,
            h_ratio=None,
            v_ratio=None,
            grade_hint="unknown",
        )
        assert not result.low_confidence_holographic
