"""Binderly card centering measurement.

Geometric, deterministic centering measurement for standard-bordered
Pokémon (and similar TCG) cards.  Uses OpenCV for card-edge detection and
Hough-line inner-border detection; maps margin ratios to PSA centering grade
hints.

Public surface::

    from grading.centering import measure_centering, CenteringResult
    result = measure_centering("front.jpg", "back.jpg")
    print(result.grade_hint)  # "10", "9", "8", "7", "worse", or "unknown"
"""

from grading.centering.grade import centering_grade_hint, ratio_from_margins
from grading.centering.measure import measure_centering
from grading.centering.types import CardRect, CenteringResult, Margins

__all__ = [
    "CardRect",
    "CenteringResult",
    "Margins",
    "centering_grade_hint",
    "measure_centering",
    "ratio_from_margins",
]
