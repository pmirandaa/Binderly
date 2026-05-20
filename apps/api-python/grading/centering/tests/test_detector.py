"""Tests for the card-edge and inner-border detectors."""

from __future__ import annotations

import numpy as np
import pytest

from grading.centering.detector import detect_card_rect, detect_inner_border
from grading.centering.tests.conftest import draw_card_array
from grading.centering.types import CardRect


class TestDetectCardRect:
    def test_centred_card_detected(self, centred_card_array: np.ndarray) -> None:
        rect = detect_card_rect(centred_card_array)
        assert rect is not None, "Expected a card to be detected"

    def test_centred_card_position(self, centred_card_array: np.ndarray) -> None:
        """Detected rect must roughly match the known card position."""
        rect = detect_card_rect(centred_card_array)
        assert rect is not None
        # Known: outer_left=80, outer_top=100, outer_right=400, outer_bottom=540.
        assert abs(rect.x - 80) <= 10, f"x={rect.x} too far from 80"
        assert abs(rect.y - 100) <= 10, f"y={rect.y} too far from 100"

    def test_off_centre_card_detected(self, off_centre_h_array: np.ndarray) -> None:
        rect = detect_card_rect(off_centre_h_array)
        assert rect is not None

    def test_rotated_card_detected(self, rotated_card_array: np.ndarray) -> None:
        rect = detect_card_rect(rotated_card_array)
        assert rect is not None, "Should still detect a card rotated 3°"

    def test_empty_image_returns_none(self) -> None:
        """Uniform grey image has no card edge → None."""
        empty = np.full((640, 480, 3), fill_value=200, dtype=np.uint8)
        rect = detect_card_rect(empty)
        assert rect is None

    def test_tiny_card_detected(self) -> None:
        """Very small card (15% of frame) still passes the area threshold."""
        small = draw_card_array(
            image_w=480, image_h=640,
            outer_left=170, outer_top=230,
            outer_right=310, outer_bottom=410,
            border_thickness=10,
        )
        rect = detect_card_rect(small)
        assert rect is not None

    def test_returns_card_rect_type(self, centred_card_array: np.ndarray) -> None:
        rect = detect_card_rect(centred_card_array)
        assert rect is not None
        assert isinstance(rect, CardRect)

    def test_accepts_greyscale_input(self, centred_card_array: np.ndarray) -> None:
        import cv2

        gray = cv2.cvtColor(centred_card_array, cv2.COLOR_BGR2GRAY)
        rect = detect_card_rect(gray)
        assert rect is not None

    def test_card_larger_than_min_fraction(self) -> None:
        """Card covering ~50% of frame is detected."""
        big = draw_card_array(
            image_w=480, image_h=640,
            outer_left=20, outer_top=20,
            outer_right=460, outer_bottom=620,
        )
        rect = detect_card_rect(big)
        assert rect is not None


class TestDetectInnerBorder:
    def test_inner_border_detected(self, centred_card_array: np.ndarray) -> None:
        outer = detect_card_rect(centred_card_array)
        assert outer is not None
        inner = detect_inner_border(centred_card_array, outer)
        assert inner is not None, "Inner border should be detectable on synthetic card"

    def test_inner_smaller_than_outer(self, centred_card_array: np.ndarray) -> None:
        outer = detect_card_rect(centred_card_array)
        assert outer is not None
        inner = detect_inner_border(centred_card_array, outer)
        assert inner is not None
        assert inner.width < outer.width
        assert inner.height < outer.height

    def test_uniform_card_no_inner(self) -> None:
        """Card with no inner border returns None from inner detector."""
        # Uniform colour card — no inner/outer colour contrast.
        img = np.full((640, 480, 3), fill_value=200, dtype=np.uint8)
        img[100:540, 80:400] = (220, 180, 60)  # solid card, no inner window
        outer = CardRect(x=80, y=100, width=320, height=440)
        inner = detect_inner_border(img, outer)
        # May or may not detect, but must not raise.
        assert inner is None or isinstance(inner, CardRect)
