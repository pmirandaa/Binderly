"""Types for the centering measurement module."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class CardRect:
    """Bounding rectangle for a detected card region.

    All coordinates are in **pixel space** relative to the original image.
    ``angle`` is the clockwise rotation in degrees (0 = axis-aligned).
    """

    x: int
    y: int
    width: int
    height: int
    angle: float = 0.0

    @property
    def x2(self) -> int:
        return self.x + self.width

    @property
    def y2(self) -> int:
        return self.y + self.height


@dataclass(frozen=True)
class Margins:
    """Four pixel margins between the outer card edge and the inner border."""

    top: float
    bottom: float
    left: float
    right: float


@dataclass(frozen=True)
class CenteringResult:
    """Output of the centering measurement for one card face.

    ``h_ratio`` and ``v_ratio`` are expressed as the smaller fraction:
    ``min(a, b) / max(a, b)``.  A perfectly-centred card is ``1.0``;
    a ``55/45`` card is ``0.818``.

    ``grade_hint`` is one of ``"10"``, ``"9"``, ``"8"``, ``"7"``, ``"worse"``
    or ``"unknown"`` (when detection failed on one or both faces).

    ``low_confidence`` is ``True`` when the outer-edge or inner-border
    detection is unreliable (e.g. holographic / full-art borders, extreme
    rotation, or very small card region).
    """

    margins: Optional[Margins]
    h_ratio: Optional[float]
    v_ratio: Optional[float]
    grade_hint: str
    low_confidence: bool = False
    low_confidence_holographic: bool = False
    flags: list[str] = field(default_factory=list)

    # Raw measurement from both faces (may be None if a face failed).
    front_margins: Optional[Margins] = None
    back_margins: Optional[Margins] = None
