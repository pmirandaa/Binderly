"""Map centering ratios to a PSA grade hint.

PSA centering tolerance table (community-documented consensus;
see T-GR-CENTERING.md § PSA centering tolerance table):

| Grade hint | H tolerance | V tolerance |
|:----------:|:-----------:|:-----------:|
|     10     |   55/45     |   55/45     |
|      9     |   60/40     |   60/40     |
|      8     |   65/35     |   65/35     |
|      7     |   70/30     |   70/30     |
|   worse    |  < 70/30   |     —       |

Ratios are expressed as ``min(a, b) / max(a, b)``.  A perfectly centred
card is 1.0; 55/45 ≈ 0.818; 60/40 = 0.667; 65/35 ≈ 0.538; 70/30 ≈ 0.429.
Both axes must satisfy the tolerance for the grade to apply.
"""

from __future__ import annotations

from typing import Optional

# Ratio thresholds — ``min / max`` per axis.
# Sorted from strictest (grade 10) to most lenient (grade 7).
_GRADE_TABLE: list[tuple[str, float]] = [
    ("10", 55 / 45),  # ≈ 0.8182
    ("9", 60 / 40),   # = 0.6667   (actually 40/60 = 0.6667)
    ("8", 65 / 35),   # ≈ 0.5385
    ("7", 70 / 30),   # ≈ 0.4286
]

# Precompute the actual min/max fractions (always ≤ 1.0).
_THRESHOLDS: list[tuple[str, float]] = [
    (grade, min(a, b) / max(a, b))
    for grade, ratio in _GRADE_TABLE
    for a, b in [(ratio, 1.0)]  # ratio is already expressed as larger/smaller
]

# Re-build correctly: the tolerance "55/45" means the smaller margin is at least
# 45% of the larger margin.  So threshold = 45/55 ≈ 0.818.
_THRESHOLDS = [
    ("10", 45 / 55),  # ≈ 0.818
    ("9", 40 / 60),   # ≈ 0.667
    ("8", 35 / 65),   # ≈ 0.538
    ("7", 30 / 70),   # ≈ 0.429
]


def centering_grade_hint(
    h_ratio: Optional[float],
    v_ratio: Optional[float],
) -> str:
    """Return the PSA grade hint for the given centering ratios.

    Args:
        h_ratio: ``min(left, right) / max(left, right)`` — horizontal axis.
            ``None`` if the measurement was not available.
        v_ratio: ``min(top, bottom) / max(top, bottom)`` — vertical axis.
            ``None`` if the measurement was not available.

    Returns:
        One of ``"10"``, ``"9"``, ``"8"``, ``"7"``, ``"worse"``, or
        ``"unknown"`` when both inputs are ``None``.
    """
    if h_ratio is None and v_ratio is None:
        return "unknown"

    for grade, threshold in _THRESHOLDS:
        h_ok = h_ratio is None or h_ratio >= threshold
        v_ok = v_ratio is None or v_ratio >= threshold
        if h_ok and v_ok:
            return grade

    return "worse"


def ratio_from_margins(a: float, b: float) -> float:
    """Return ``min(a, b) / max(a, b)`` clamped to ``[0.0, 1.0]``.

    Both ``a`` and ``b`` must be non-negative.  A zero ``max`` (empty card)
    returns 0.0 to signal a degenerate measurement rather than raising.
    """
    if a < 0 or b < 0:
        raise ValueError(f"margins must be non-negative, got a={a}, b={b}")
    top = max(a, b)
    if top == 0.0:
        return 0.0
    return min(a, b) / top
