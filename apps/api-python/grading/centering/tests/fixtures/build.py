"""Generate synthetic card fixture images for the centering tests.

Run after installing the dev extras::

    pip install -e '.[dev]'
    python -m grading.centering.tests.fixtures.build

Each fixture encodes the expected margins in its filename so tests can
assert the detected ratio against the known ground truth.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FIXTURE_DIR = Path(__file__).resolve().parent


def draw_card(
    *,
    image_w: int = 480,
    image_h: int = 640,
    outer_left: int,
    outer_top: int,
    outer_right: int,
    outer_bottom: int,
    border_thickness: int = 18,
    card_color: tuple[int, int, int] = (255, 220, 60),   # yellow Pokémon border
    inner_color: tuple[int, int, int] = (30, 30, 30),    # dark art window
    bg_color: tuple[int, int, int] = (200, 200, 200),    # light grey background
    angle_deg: float = 0.0,
) -> np.ndarray:
    """Draw a synthetic card image.

    The card occupies ``[outer_left, outer_top, outer_right, outer_bottom]``
    in the image.  The inner art window is inset by ``border_thickness`` on
    all four sides.  An optional rotation (in degrees) rotates the entire
    card around its centre.

    Returns an ``H × W × 3`` uint8 BGR array suitable for OpenCV.
    """
    img = Image.new("RGB", (image_w, image_h), bg_color)
    draw = ImageDraw.Draw(img)

    # Outer card body (filled with card_color).
    draw.rectangle(
        [outer_left, outer_top, outer_right, outer_bottom],
        fill=card_color,
    )
    # Inner art window (filled with inner_color).
    draw.rectangle(
        [
            outer_left + border_thickness,
            outer_top + border_thickness,
            outer_right - border_thickness,
            outer_bottom - border_thickness,
        ],
        fill=inner_color,
    )

    if angle_deg != 0.0:
        img = img.rotate(angle_deg, expand=False, fillcolor=bg_color)

    # Convert PIL RGB → numpy BGR (OpenCV convention).
    arr = np.array(img)
    return arr[:, :, ::-1].copy()


def save_fixture(
    name: str,
    array: np.ndarray,
) -> Path:
    """Save a BGR numpy array as a PNG fixture."""
    import cv2

    out = FIXTURE_DIR / name
    cv2.imwrite(str(out), array)
    return out


def build_all() -> None:
    """Generate all fixture images."""
    # --- centred card (50/50) ---
    centred = draw_card(
        image_w=480, image_h=640,
        outer_left=80, outer_top=100,
        outer_right=400, outer_bottom=540,
    )
    save_fixture("centred_50_50.png", centred)

    # --- off-centre H: 40px left, 60px right (40/60 → ≈0.667) ---
    off_h = draw_card(
        image_w=480, image_h=640,
        outer_left=60, outer_top=100,
        outer_right=380, outer_bottom=540,
    )
    save_fixture("off_h_40_60.png", off_h)

    # --- off-centre V: 80px top, 40px bottom (40/80 → 0.50) ---
    off_v = draw_card(
        image_w=480, image_h=640,
        outer_left=80, outer_top=120,
        outer_right=400, outer_bottom=520,
    )
    save_fixture("off_v_80_40.png", off_v)

    # --- rotated 3 degrees ---
    rotated = draw_card(
        image_w=480, image_h=640,
        outer_left=80, outer_top=100,
        outer_right=400, outer_bottom=540,
        angle_deg=3.0,
    )
    save_fixture("rotated_3deg.png", rotated)

    # --- very off-centre H: 30/70 (grade 7 boundary) ---
    off_h_30_70 = draw_card(
        image_w=480, image_h=640,
        outer_left=40, outer_top=100,
        outer_right=340, outer_bottom=540,
    )
    save_fixture("off_h_30_70.png", off_h_30_70)

    # --- tiny card (15% of frame area) ---
    tiny = draw_card(
        image_w=480, image_h=640,
        outer_left=180, outer_top=220,
        outer_right=300, outer_bottom=420,
        border_thickness=10,
    )
    save_fixture("tiny_card.png", tiny)

    # --- large card (nearly full frame) ---
    large = draw_card(
        image_w=480, image_h=640,
        outer_left=10, outer_top=10,
        outer_right=470, outer_bottom=630,
    )
    save_fixture("large_card.png", large)

    # --- holographic-like: no clear inner border (uniform fill) ---
    import cv2  # noqa: PLC0415

    holo = np.ones((640, 480, 3), dtype=np.uint8) * 180
    # Card outline but NO distinct inner border — same colour throughout.
    holo[100:540, 80:400] = np.array([200, 180, 255], dtype=np.uint8)
    save_fixture("holographic_no_inner.png", holo)

    print(f"Fixtures written to {FIXTURE_DIR}")


if __name__ == "__main__":
    build_all()
    sys.exit(0)
