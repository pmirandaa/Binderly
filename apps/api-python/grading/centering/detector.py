"""Card-edge detection via OpenCV contour analysis.

Outer card edge algorithm:
  1. Convert to greyscale.
  2. Gaussian blur to suppress sensor noise.
  3. Otsu's threshold (adaptive: finds the optimal cut between card and
     background automatically; works even when the card is slightly
     darker or lighter than the background).
  4. Morphological closing to fill gaps in the card body mask.
  5. ``cv2.findContours`` on the binary mask — find the largest filled
     region that has a plausible card aspect ratio.
  6. Return its axis-aligned bounding rect as a ``CardRect``.

Inner border algorithm:
  1. Crop to the detected outer card rect.
  2. Run Canny edge detection on the crop — the border-to-art-window
     transition creates very strong edges (≥ 100 greyscale levels on
     standard cards) even when the outer card edge is weaker.
  3. ``cv2.HoughLinesP`` filtered to lines parallel to the card axes
     (within ±15°).
  4. Collapse the detected line endpoints into a tight inner rect via
     percentile filtering.

For holographic / full-art cards with low border contrast the inner
detector returns ``None`` — callers should set ``low_confidence_holographic``.
"""

from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from grading.centering.types import CardRect

# --- Outer card detection tunables -------------------------------------

# Fraction of image area the detected card bounding rect must cover.
_MIN_AREA_FRACTION = 0.05

# Maximum fraction — cards filling more than this are likely the whole
# background (uniform image, or background = card body colour).
_MAX_AREA_FRACTION = 0.95

# Card aspect ratio range.  Standard Pokémon card is 6.3 cm × 8.8 cm ≈ 0.716.
# Allow a generous range to handle landscape orientation + non-Pokémon cards.
_ASPECT_MIN = 0.3
_ASPECT_MAX = 2.5

# Morphological closing kernel size (fills narrow gaps inside the card mask).
_CLOSE_KSIZE = 9

# Minimum pixel margin the card must have from each image edge (as a fraction).
# Rejects rects that fill the entire image (likely the background blob).
_MIN_MARGIN_FRACTION = 0.01

# --- Inner border detection tunables -----------------------------------

_CANNY_LO = 40
_CANNY_HI = 140


def _to_gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if image.ndim == 2:
        return image
    raise ValueError(f"Expected 2-D or 3-D array, got shape {image.shape}")


def detect_card_rect(image: np.ndarray) -> Optional[CardRect]:
    """Detect the outer card edge and return its bounding rectangle.

    Strategy: use a two-pass Canny (wide range of thresholds from very
    sensitive to selective) combined with contour selection that picks the
    outermost near-rectangular contour.  This is robust against both weak
    background→card edges (step as small as 15 grey levels) and strong
    internal feature edges.

    Args:
        image: An ``H × W × C`` ``uint8`` array in BGR or RGB, or greyscale.

    Returns:
        A :class:`CardRect` in pixel coordinates, or ``None`` if no
        plausible card edge was found.
    """
    gray = _to_gray(image)
    h, w = gray.shape
    image_area = float(h * w)

    # Reject uniform images immediately.
    if float(np.std(gray)) < 3.0:
        return None

    blurred = cv2.GaussianBlur(gray, (5, 5), sigmaX=1.0)

    best_rect: Optional[CardRect] = None
    best_area = 0.0

    min_margin_x = int(w * _MIN_MARGIN_FRACTION)
    min_margin_y = int(h * _MIN_MARGIN_FRACTION)

    # Try multiple Canny threshold pairs from sensitive to selective.
    # Sensitive thresholds catch weak outer edges; selective thresholds
    # reduce noise on real photos.  We take the LARGEST qualifying rect
    # across all passes (the outer card edge is the largest rectangular shape).
    canny_pairs = [
        (5, 20),    # very sensitive — catches even 15-level grey step
        (15, 50),   # moderate
        (30, 100),  # selective — good for high-contrast real photos
    ]

    for lo, hi in canny_pairs:
        edges = cv2.Canny(blurred, lo, hi)

        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (_CLOSE_KSIZE, _CLOSE_KSIZE)
        )
        dilated = cv2.dilate(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(
            dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if not contours:
            continue

        def _bbox_area(c: np.ndarray) -> float:
            _, _, cw, ch = cv2.boundingRect(c)
            return float(cw * ch)

        for contour in sorted(contours, key=_bbox_area, reverse=True):
            bx, by, bw, bh = cv2.boundingRect(contour)
            bbox_area = float(bw * bh)

            frac = bbox_area / image_area
            if frac < _MIN_AREA_FRACTION:
                break

            if frac > _MAX_AREA_FRACTION:
                continue

            # The bounding rect of a dilated-edge contour is slightly OUTSIDE
            # the actual card boundary (the dilation expands outward).  For
            # practical purposes this is close enough for margin computation.
            # The card must have some margin on all four sides.
            if (bx < min_margin_x or by < min_margin_y
                    or (bx + bw) > (w - min_margin_x)
                    or (by + bh) > (h - min_margin_y)):
                # Allow 2-side margin at minimum (card partially near the frame).
                margin_sides = sum([
                    bx >= min_margin_x,
                    by >= min_margin_y,
                    (bx + bw) <= (w - min_margin_x),
                    (by + bh) <= (h - min_margin_y),
                ])
                if margin_sides < 2:
                    continue

            if bw == 0 or bh == 0:
                continue

            aspect = bw / bh
            if not (_ASPECT_MIN <= aspect <= _ASPECT_MAX):
                continue

            # Rotated rect for angle estimation only.
            rot_rect = cv2.minAreaRect(contour)
            _, (rw, rh), angle = rot_rect
            if rw < rh:
                angle = angle + 90.0

            if bbox_area > best_area:
                best_area = bbox_area
                best_rect = CardRect(
                    x=bx, y=by, width=bw, height=bh, angle=float(angle)
                )
            break  # largest qualifying contour per Canny pass

    return best_rect


def detect_inner_border(
    image: np.ndarray,
    outer: CardRect,
) -> Optional[CardRect]:
    """Detect the inner coloured border (art-window frame) inside ``outer``.

    Uses Canny edge detection inside the cropped outer region, then
    ``cv2.HoughLinesP`` filtered to lines parallel to the card axes.
    Returns the tightest axis-aligned rectangle that fits the detected
    frame lines.

    For holographic / full-art cards where line detection is unreliable,
    returns ``None``.
    """
    # Crop to the outer card rect with a small inset to avoid the outer edge.
    inset = 6
    x1 = max(outer.x + inset, 0)
    y1 = max(outer.y + inset, 0)
    x2 = min(outer.x2 - inset, image.shape[1])
    y2 = min(outer.y2 - inset, image.shape[0])

    if x2 <= x1 or y2 <= y1:
        return None

    crop = image[y1:y2, x1:x2]
    gray_crop = _to_gray(crop)

    ch, cw = gray_crop.shape
    if ch < 20 or cw < 20:
        return None

    blurred = cv2.GaussianBlur(gray_crop, (3, 3), sigmaX=1.0)
    edges = cv2.Canny(blurred, _CANNY_LO, _CANNY_HI)

    # Also try finding the inner border via thresholding (dark art window).
    inner_from_thresh = _detect_inner_by_threshold(gray_crop, x1, y1)
    if inner_from_thresh is not None:
        return inner_from_thresh

    # Fallback: Hough lines.
    min_len = int(min(ch, cw) * 0.15)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=30,
        minLineLength=max(min_len, 8),
        maxLineGap=15,
    )

    if lines is None or len(lines) == 0:
        return None

    h_ys: list[int] = []
    v_xs: list[int] = []

    for line in lines:
        x_a, y_a, x_b, y_b = line[0]
        dx = abs(x_b - x_a)
        dy = abs(y_b - y_a)
        if dx == 0 and dy == 0:
            continue
        angle_deg = float(np.degrees(np.arctan2(dy, dx)))

        if angle_deg <= 15:
            h_ys.extend([y_a, y_b])
        elif angle_deg >= 75:
            v_xs.extend([x_a, x_b])

    if len(h_ys) < 2 or len(v_xs) < 2:
        return None

    top_local = int(np.percentile(h_ys, 10))
    bottom_local = int(np.percentile(h_ys, 90))
    left_local = int(np.percentile(v_xs, 10))
    right_local = int(np.percentile(v_xs, 90))

    if bottom_local <= top_local or right_local <= left_local:
        return None

    return CardRect(
        x=x1 + left_local,
        y=y1 + top_local,
        width=right_local - left_local,
        height=bottom_local - top_local,
    )


def _detect_inner_by_threshold(
    gray_crop: np.ndarray,
    crop_x: int,
    crop_y: int,
) -> Optional[CardRect]:
    """Try to find the inner border by looking for a large dark region.

    Many standard-bordered Pokémon cards have a dark art window surrounded
    by a brighter coloured border.  This function:
    1. Thresholds the crop to isolate the darkest region.
    2. Finds its bounding rect.

    Returns ``None`` if no plausible dark region is found.
    """
    ch, cw = gray_crop.shape
    card_area = float(ch * cw)

    # Find the darker half of the crop using Otsu.
    _, thresh = cv2.threshold(
        gray_crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )

    contours, _ = cv2.findContours(
        thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None

    def _area(c: np.ndarray) -> float:
        _, _, w, h = cv2.boundingRect(c)
        return float(w * h)

    for contour in sorted(contours, key=_area, reverse=True):
        bx, by, bw, bh = cv2.boundingRect(contour)
        region_area = float(bw * bh)

        # The inner art window should be between 10% and 80% of the crop area.
        frac = region_area / card_area
        if not (0.10 <= frac <= 0.80):
            continue

        # The inner window must be inset from all four sides.
        if bx <= 1 or by <= 1 or bx + bw >= cw - 1 or by + bh >= ch - 1:
            continue

        return CardRect(
            x=crop_x + bx,
            y=crop_y + by,
            width=bw,
            height=bh,
        )

    return None
