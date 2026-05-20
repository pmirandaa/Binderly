"""Shared pytest fixtures for the centering module tests.

Synthetic card images are generated on-the-fly using NumPy + OpenCV so
the test suite runs without any pre-committed binary fixtures.

The ``draw_card_array`` factory creates an ``H × W × 3`` uint8 BGR image
with a clearly-bordered card at a known pixel position.  Tests can pass
known outer + inner coordinates and assert that the detector returns the
expected margins.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import pytest


@pytest.fixture(scope="session")
def fixture_dir() -> Path:
    return Path(__file__).resolve().parent / "fixtures"


def draw_card_array(
    *,
    image_w: int = 480,
    image_h: int = 640,
    outer_left: int,
    outer_top: int,
    outer_right: int,
    outer_bottom: int,
    border_thickness: int = 20,
    card_color: tuple[int, int, int] = (255, 220, 60),
    inner_color: tuple[int, int, int] = (25, 25, 25),
    bg_color: tuple[int, int, int] = (200, 200, 200),
    angle_deg: float = 0.0,
    inner_border_thickness: Optional[int] = None,
) -> np.ndarray:
    """Return a synthetic card BGR image.

    Parameters
    ----------
    outer_left, outer_top, outer_right, outer_bottom:
        Pixel coordinates of the outer card edge.
    border_thickness:
        Width of the coloured border between outer edge and inner art window.
    angle_deg:
        Counter-clockwise rotation applied to the whole image.
    inner_border_thickness:
        If given, overrides ``border_thickness`` for the inner window only.
    """
    bt = inner_border_thickness if inner_border_thickness is not None else border_thickness

    img = np.full((image_h, image_w, 3), fill_value=bg_color, dtype=np.uint8)

    # Draw the outer card body.
    img[outer_top:outer_bottom, outer_left:outer_right] = card_color

    # Draw the inner art window.
    inner_y1 = outer_top + bt
    inner_y2 = outer_bottom - bt
    inner_x1 = outer_left + bt
    inner_x2 = outer_right - bt
    if inner_y2 > inner_y1 and inner_x2 > inner_x1:
        img[inner_y1:inner_y2, inner_x1:inner_x2] = inner_color

    if angle_deg != 0.0:
        cx, cy = image_w / 2, image_h / 2
        M = cv2.getRotationMatrix2D((cx, cy), angle_deg, 1.0)
        img = cv2.warpAffine(
            img, M, (image_w, image_h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=bg_color,
        )

    return img


@pytest.fixture(scope="session")
def centred_card_array() -> np.ndarray:
    """480×640 image with a centred card — equal margins all sides (50/50)."""
    return draw_card_array(
        outer_left=80, outer_top=100,
        outer_right=400, outer_bottom=540,
    )


@pytest.fixture(scope="session")
def off_centre_h_array() -> np.ndarray:
    """Card shifted right: left=40px, right=80px → left/right≈0.50 (40/80)."""
    # image 480 wide; card 320px wide; shifted so left=40, right=120.
    return draw_card_array(
        outer_left=40, outer_top=100,
        outer_right=360, outer_bottom=540,
    )


@pytest.fixture(scope="session")
def rotated_card_array() -> np.ndarray:
    """Card centred but rotated 3 degrees."""
    return draw_card_array(
        outer_left=80, outer_top=100,
        outer_right=400, outer_bottom=540,
        angle_deg=3.0,
    )
