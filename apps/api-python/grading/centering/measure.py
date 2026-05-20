"""Centering measurement — orchestrates detection + margin computation.

Measurement strategy (v1):
1. Detect the outer card edge on the front image using ``detect_card_rect``.
2. If a back image is provided, detect its outer edge too.
3. Detect the inner border (coloured art-window frame) inside the outer rect
   on both faces using ``detect_inner_border``.
4. Compute four margins per face:
       top    = inner.y - outer.y
       bottom = outer.y2 - inner.y2
       left   = inner.x - outer.x
       right  = outer.x2 - inner.x2
5. Average the margins across available faces (front + back when both succeed).
6. Compute H and V ratios and map to a grade hint.

When the inner border cannot be detected (holographic / full-art / very low
contrast), set ``low_confidence_holographic = True`` and return ``low_confidence``
with grade_hint = "unknown".
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np

from grading.centering.detector import detect_card_rect, detect_inner_border
from grading.centering.grade import centering_grade_hint, ratio_from_margins
from grading.centering.types import CardRect, CenteringResult, Margins

# Minimum inner-to-outer width ratio for the inner border to be plausible.
# If the detected inner rect is more than 95% the size of the outer rect,
# the detection likely latched onto the card edge itself.
_INNER_MIN_FRACTION = 0.30
_INNER_MAX_FRACTION = 0.95

# Minimum margin in pixels for a margin to be considered valid.
_MIN_MARGIN_PX = 1


def _load_image(source: Union[str, Path, np.ndarray]) -> np.ndarray:
    """Load a BGR image from a file path or return the array as-is."""
    if isinstance(source, np.ndarray):
        return source
    path = Path(source)
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    return img


def _compute_margins(outer: CardRect, inner: CardRect) -> Optional[Margins]:
    """Compute the four pixel margins from outer and inner rects."""
    top = float(inner.y - outer.y)
    bottom = float(outer.y2 - inner.y2)
    left = float(inner.x - outer.x)
    right = float(outer.x2 - inner.x2)

    # Sanity-check: all margins must be positive.
    if any(m < _MIN_MARGIN_PX for m in (top, bottom, left, right)):
        return None
    return Margins(top=top, bottom=bottom, left=left, right=right)


def _is_inner_plausible(outer: CardRect, inner: CardRect) -> bool:
    """Return True if the inner rect is a plausible inner border."""
    if inner.width <= 0 or inner.height <= 0:
        return False
    w_frac = inner.width / outer.width
    h_frac = inner.height / outer.height
    return (
        _INNER_MIN_FRACTION <= w_frac <= _INNER_MAX_FRACTION
        and _INNER_MIN_FRACTION <= h_frac <= _INNER_MAX_FRACTION
    )


def _measure_face(
    image: np.ndarray,
) -> tuple[Optional[Margins], list[str]]:
    """Detect outer + inner rects for one face and return margins + flags."""
    flags: list[str] = []

    outer = detect_card_rect(image)
    if outer is None:
        flags.append("outer_not_detected")
        return None, flags

    inner = detect_inner_border(image, outer)
    if inner is None:
        flags.append("inner_not_detected")
        return None, flags

    if not _is_inner_plausible(outer, inner):
        flags.append("inner_implausible")
        return None, flags

    margins = _compute_margins(outer, inner)
    if margins is None:
        flags.append("margins_negative")
        return None, flags

    return margins, flags


def _average_margins(front: Margins, back: Margins) -> Margins:
    """Average the margins from both faces."""
    return Margins(
        top=(front.top + back.top) / 2,
        bottom=(front.bottom + back.bottom) / 2,
        left=(front.left + back.left) / 2,
        right=(front.right + back.right) / 2,
    )


def measure_centering(
    front_path: Union[str, Path, np.ndarray],
    back_path: Optional[Union[str, Path, np.ndarray]] = None,
) -> CenteringResult:
    """Measure centering from front (and optionally back) card images.

    Args:
        front_path: Path to the front full-portrait image, or a numpy array.
        back_path: Path to the back full-portrait image, or a numpy array.
            Optional — if not provided the measurement uses front only and
            sets ``low_confidence = True`` (single-face measurement is less
            reliable).

    Returns:
        A :class:`CenteringResult`.  ``low_confidence`` is set when only
        one face was measured or when inner-border detection failed on one
        or both faces.
    """
    flags: list[str] = []
    low_confidence = False
    low_confidence_holographic = False

    front_img = _load_image(front_path)
    front_margins, front_flags = _measure_face(front_img)
    flags.extend(front_flags)

    if "inner_not_detected" in front_flags or "inner_implausible" in front_flags:
        low_confidence_holographic = True
        low_confidence = True

    back_margins: Optional[Margins] = None
    if back_path is not None:
        back_img = _load_image(back_path)
        back_margins, back_flags = _measure_face(back_img)
        flags.extend([f"back:{f}" for f in back_flags])
        if "inner_not_detected" in back_flags or "inner_implausible" in back_flags:
            low_confidence_holographic = True
            low_confidence = True
    else:
        flags.append("back_not_provided")
        low_confidence = True

    # Determine the canonical margins to measure against.
    if front_margins is not None and back_margins is not None:
        margins = _average_margins(front_margins, back_margins)
    elif front_margins is not None:
        margins = front_margins
        low_confidence = True
        flags.append("front_only")
    elif back_margins is not None:
        margins = back_margins
        low_confidence = True
        flags.append("back_only")
    else:
        # Total failure.
        return CenteringResult(
            margins=None,
            h_ratio=None,
            v_ratio=None,
            grade_hint="unknown",
            low_confidence=True,
            low_confidence_holographic=low_confidence_holographic,
            flags=flags,
            front_margins=front_margins,
            back_margins=back_margins,
        )

    h_ratio = ratio_from_margins(margins.left, margins.right)
    v_ratio = ratio_from_margins(margins.top, margins.bottom)
    grade_hint = centering_grade_hint(h_ratio, v_ratio)

    return CenteringResult(
        margins=margins,
        h_ratio=h_ratio,
        v_ratio=v_ratio,
        grade_hint=grade_hint,
        low_confidence=low_confidence,
        low_confidence_holographic=low_confidence_holographic,
        flags=flags,
        front_margins=front_margins,
        back_margins=back_margins,
    )
