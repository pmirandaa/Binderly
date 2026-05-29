"""Types for the cross-company grade calibration scaffold (#FU-56)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CompanyCalibration:
    """Placeholder affine calibration for one grading company.

    The normalised (PSA-equivalent) grade is::

        normalized = clamp(slope * raw_grade + intercept, min_grade, max_grade)

    Attributes:
        company: Grade company code (``'PSA'`` / ``'BGS'`` / ``'CGC'`` /
            ``'SGC'`` / ``'OTHER'``).
        slope: Multiplicative term of the affine map.
        intercept: Additive term, in PSA-grade points.
        confidence: 0..1 placeholder trust in this mapping.  PSA (the anchor)
            is 1.0; the rest are deliberately low until #FU-58 learns real
            constants.
        notes: Human-readable rationale for the placeholder constants.
        min_grade: Lower clamp bound for the normalised output.
        max_grade: Upper clamp bound for the normalised output.
    """

    company: str
    slope: float
    intercept: float
    confidence: float
    notes: str
    min_grade: float = 1.0
    max_grade: float = 10.0


@dataclass(frozen=True)
class CalibrationResult:
    """Outcome of calibrating one (company, grade) pair.

    Attributes:
        company: The input grading company code.
        raw_grade: The grade as it appears on the slab.
        normalized_grade: The PSA-equivalent grade on the internal [1, 10] scale.
        confidence: Placeholder confidence carried from the company calibration.
        method: Calibration method tag (``'placeholder-linear'`` for v0).
        version: Calibration table version (see ``CALIBRATION_VERSION``).
    """

    company: str
    raw_grade: float
    normalized_grade: float
    confidence: float
    method: str
    version: str
