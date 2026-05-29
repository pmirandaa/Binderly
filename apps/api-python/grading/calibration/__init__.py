"""Cross-company grade calibration scaffold (T-GR-GRADE-CALIBRATION / #FU-56).

Different grading companies score on different (and differently-strict) scales:
a "PSA 10" is not the same achievement as a "BGS 10 Black Label" or an
"SGC 10".  When the flywheel mixes graded outcomes from PSA / BGS / CGC / SGC
into one training/pricing corpus, those grades must be expressed on a single
**normalised internal scale** before they can be compared or aggregated.

This module is a *scaffold*, not a trained calibration.  It applies a
documented per-company **placeholder linear map** (numpy affine transform,
consistent with the v0 placeholder-model pattern used across the grading tree)
onto a PSA-equivalent [1, 10] internal scale.  The constants are heuristic and
explicitly interim — see ``calibration.PLACEHOLDER_CALIBRATIONS`` and
``README.md``.

Follow-up: #FU-59 (learned cross-company calibration) replaces the placeholder
constants with a fit over labelled cross-company pairs (the same card graded by
multiple companies) once that data exists in the flywheel — see Q-023.

Public surface::

    from grading.calibration import (
        GradeCalibrator,
        CompanyCalibration,
        CalibrationResult,
        PLACEHOLDER_CALIBRATIONS,
        CALIBRATION_VERSION,
        normalize_grade,
        SUPPORTED_COMPANIES,
    )
"""

from grading.calibration.calibration import (
    CALIBRATION_VERSION,
    PLACEHOLDER_CALIBRATIONS,
    SUPPORTED_COMPANIES,
    GradeCalibrator,
    normalize_grade,
)
from grading.calibration.types import CalibrationResult, CompanyCalibration

__all__ = [
    "GradeCalibrator",
    "CompanyCalibration",
    "CalibrationResult",
    "PLACEHOLDER_CALIBRATIONS",
    "CALIBRATION_VERSION",
    "SUPPORTED_COMPANIES",
    "normalize_grade",
]
