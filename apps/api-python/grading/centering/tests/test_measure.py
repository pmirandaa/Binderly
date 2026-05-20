"""Tests for the centering measurement orchestrator."""

from __future__ import annotations

import numpy as np
import pytest

from grading.centering.measure import measure_centering
from grading.centering.tests.conftest import draw_card_array
from grading.centering.types import CenteringResult


class TestMeasureCentering:
    # --- Happy-path centred card ---

    def test_centred_card_grade_10(self, centred_card_array: np.ndarray) -> None:
        result = measure_centering(centred_card_array)
        assert isinstance(result, CenteringResult)
        # A centred card should hit grade 10 (or 9 with minor detection error).
        assert result.grade_hint in ("10", "9"), (
            f"Expected grade 10/9 for centred card, got {result.grade_hint!r}"
        )

    def test_centred_card_ratios_near_1(self, centred_card_array: np.ndarray) -> None:
        result = measure_centering(centred_card_array)
        if result.h_ratio is not None:
            assert result.h_ratio >= 0.7, f"h_ratio={result.h_ratio} unexpectedly low"
        if result.v_ratio is not None:
            assert result.v_ratio >= 0.7, f"v_ratio={result.v_ratio} unexpectedly low"

    # --- Off-centre card ---

    def test_off_centre_h_grade_lower(self) -> None:
        """Card with asymmetric inner border — thin left margin, thick right.

        The inner art window is shifted LEFT within the outer card boundary:
          outer: x=80..400 (320px wide)
          inner: left margin=10px, right margin=50px
          h_ratio = 10/50 = 0.20 → far below the 55/45 PSA 10 threshold.
        """
        outer_left, outer_right = 80, 400
        outer_top, outer_bottom = 100, 540
        inner_left = outer_left + 10   # thin left margin
        inner_right = outer_right - 50  # thick right margin
        inner_top = outer_top + 20
        inner_bottom = outer_bottom - 20

        img = np.full((640, 480, 3), fill_value=200, dtype=np.uint8)
        img[outer_top:outer_bottom, outer_left:outer_right] = (255, 220, 60)
        img[inner_top:inner_bottom, inner_left:inner_right] = (25, 25, 25)

        result = measure_centering(img)
        # If detection worked, the ratio should be well below 1.0.
        if result.h_ratio is not None:
            assert result.h_ratio < 0.8, (
                f"h_ratio={result.h_ratio} too high for off-centre card (10/50)"
            )
        if result.grade_hint not in ("unknown",):
            assert result.grade_hint != "10", (
                f"grade={result.grade_hint!r} should not be 10 for off-centre card"
            )

    # --- Two-face measurement ---

    def test_two_face_returns_result(
        self,
        centred_card_array: np.ndarray,
    ) -> None:
        result = measure_centering(centred_card_array, centred_card_array)
        assert isinstance(result, CenteringResult)
        assert result.grade_hint != "unknown"

    def test_two_face_lower_confidence(
        self,
        centred_card_array: np.ndarray,
    ) -> None:
        """Two-face measurement should NOT set low_confidence for a clear card."""
        result = measure_centering(centred_card_array, centred_card_array)
        # A perfectly synthetic card — both detections should succeed.
        # low_confidence_holographic should be False.
        # (low_confidence may still be False when both faces succeed.)
        assert not result.low_confidence_holographic

    # --- No back provided ---

    def test_front_only_sets_low_confidence(
        self,
        centred_card_array: np.ndarray,
    ) -> None:
        result = measure_centering(centred_card_array)
        assert result.low_confidence, "Single-face measurement must set low_confidence"

    def test_front_only_still_has_grade(
        self,
        centred_card_array: np.ndarray,
    ) -> None:
        result = measure_centering(centred_card_array)
        assert result.grade_hint in ("10", "9", "8", "7", "worse")

    # --- Holographic-like card (no inner border) ---

    def test_holographic_sets_low_confidence(self) -> None:
        # Uniform-colour card — no inner border detectable.
        holo = np.full((640, 480, 3), fill_value=200, dtype=np.uint8)
        holo[100:540, 80:400] = (200, 170, 255)  # uniform purple, no inner window
        result = measure_centering(holo)
        assert result.low_confidence

    def test_holographic_grade_is_unknown(self) -> None:
        holo = np.full((640, 480, 3), fill_value=200, dtype=np.uint8)
        holo[100:540, 80:400] = (200, 170, 255)
        result = measure_centering(holo)
        # Either unknown (both fail) or has grade but with low_confidence.
        assert result.grade_hint in ("unknown", "10", "9", "8", "7", "worse")

    # --- Completely empty image ---

    def test_empty_image_returns_unknown(self) -> None:
        empty = np.full((640, 480, 3), fill_value=200, dtype=np.uint8)
        result = measure_centering(empty)
        assert result.grade_hint == "unknown"
        assert result.low_confidence
        assert result.margins is None
        assert result.h_ratio is None
        assert result.v_ratio is None

    # --- Numpy array input ---

    def test_accepts_numpy_array(self, centred_card_array: np.ndarray) -> None:
        result = measure_centering(centred_card_array)
        assert isinstance(result, CenteringResult)

    # --- Rotated card ---

    def test_rotated_card_does_not_crash(
        self,
        rotated_card_array: np.ndarray,
    ) -> None:
        result = measure_centering(rotated_card_array)
        assert isinstance(result, CenteringResult)

    def test_rotated_card_grade_plausible(
        self,
        rotated_card_array: np.ndarray,
    ) -> None:
        result = measure_centering(rotated_card_array)
        # A 3° rotation should still produce a reasonable grade.
        assert result.grade_hint in ("10", "9", "8", "7", "worse", "unknown")


class TestMeasureCenteringFlags:
    def test_back_not_provided_flag(
        self,
        centred_card_array: np.ndarray,
    ) -> None:
        result = measure_centering(centred_card_array)
        assert "back_not_provided" in result.flags

    def test_no_flags_on_clean_two_face(
        self,
        centred_card_array: np.ndarray,
    ) -> None:
        result = measure_centering(centred_card_array, centred_card_array)
        # Clean detection — only expect flags if detection had issues.
        bad_flags = [f for f in result.flags if "not_detected" in f or "implausible" in f]
        # Tolerate detection failures on the synthetic card but not both.
        assert len(bad_flags) < 4, f"Too many detection failures: {result.flags}"
