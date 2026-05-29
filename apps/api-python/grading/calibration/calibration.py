"""Placeholder cross-company grade calibration (#FU-56 scaffold).

The internal normalised scale is **PSA-equivalent [1.0, 10.0]**: PSA is the
anchor (identity map) and every other company's numeric grade is nudged onto
that scale by a documented affine transform.

⚠️  The constants below are *heuristic placeholders*, derived from rough market
"cross-grade equivalence" lore (e.g. a BGS 9.5 commonly trades like a PSA 10
because BGS is stricter at the top), NOT from a fit over labelled data.  They
exist so that downstream code (flywheel aggregation, pricing comparisons) has a
single scale to work on *today*, with a clearly-marked seam for the learned
version.

Replacement path → #FU-60 (learned calibration):
    Once the flywheel accumulates labelled cross-company pairs — the same
    physical card graded by ≥2 companies, or strong card-identity matches via
    #FU-40's printing match — fit per-company (or per-company-per-grade-tier)
    constants by regressing realised market value / agreed identity, and bump
    ``CALIBRATION_VERSION``.  See Q-023 in open-questions.md.
"""

from __future__ import annotations

import numpy as np

from grading.calibration.types import CalibrationResult, CompanyCalibration

CALIBRATION_VERSION = "v0-placeholder"
CALIBRATION_METHOD = "placeholder-linear"

# PSA-anchored placeholder calibrations.  See module docstring for the heavy
# caveat: these are interim heuristics, not learned constants.
PLACEHOLDER_CALIBRATIONS: dict[str, CompanyCalibration] = {
    "PSA": CompanyCalibration(
        company="PSA",
        slope=1.0,
        intercept=0.0,
        confidence=1.0,
        notes="Anchor scale — PSA grades define the internal scale (identity).",
    ),
    "BGS": CompanyCalibration(
        company="BGS",
        slope=1.0,
        intercept=0.3,
        confidence=0.5,
        notes=(
            "BGS is stricter at the top (BGS 9.5 ~ PSA 10), so a given BGS "
            "numeric grade maps slightly higher on the PSA scale. Placeholder."
        ),
    ),
    "CGC": CompanyCalibration(
        company="CGC",
        slope=1.0,
        intercept=0.1,
        confidence=0.5,
        notes="CGC roughly tracks PSA with a small upward nudge. Placeholder.",
    ),
    "SGC": CompanyCalibration(
        company="SGC",
        slope=1.0,
        intercept=0.2,
        confidence=0.5,
        notes="SGC tends slightly stricter than PSA mid-scale. Placeholder.",
    ),
    "OTHER": CompanyCalibration(
        company="OTHER",
        slope=1.0,
        intercept=0.0,
        confidence=0.2,
        notes="Unknown house — pass through as identity with low confidence.",
    ),
}

SUPPORTED_COMPANIES: tuple[str, ...] = tuple(PLACEHOLDER_CALIBRATIONS)

_FALLBACK_KEY = "OTHER"


def _resolve(company: str) -> CompanyCalibration:
    return PLACEHOLDER_CALIBRATIONS.get(
        (company or "").upper(), PLACEHOLDER_CALIBRATIONS[_FALLBACK_KEY]
    )


def _apply_affine(cal: CompanyCalibration, raw_grade: float) -> float:
    """Apply ``slope * raw + intercept`` via numpy, then clamp to bounds."""
    # Affine transform expressed as a dot product so the learned version can
    # drop in a fitted weight vector without changing call sites.
    weights = np.array([cal.slope, cal.intercept], dtype=np.float64)
    features = np.array([raw_grade, 1.0], dtype=np.float64)
    normalized = float(weights @ features)
    return float(np.clip(normalized, cal.min_grade, cal.max_grade))


class GradeCalibrator:
    """Maps ``(company, grade)`` → PSA-equivalent normalised grade.

    Args:
        calibrations: Per-company calibration table.  Defaults to the documented
            placeholder constants; inject a learned table here under #FU-58.
        version: Version tag stamped onto every result.
    """

    def __init__(
        self,
        calibrations: dict[str, CompanyCalibration] | None = None,
        version: str = CALIBRATION_VERSION,
    ) -> None:
        self._calibrations = calibrations or PLACEHOLDER_CALIBRATIONS
        self._version = version

    def calibration_for(self, company: str) -> CompanyCalibration:
        return self._calibrations.get(
            (company or "").upper(),
            self._calibrations.get(_FALLBACK_KEY, PLACEHOLDER_CALIBRATIONS[_FALLBACK_KEY]),
        )

    def calibrate(self, company: str, grade: float) -> CalibrationResult:
        """Normalise one slab grade onto the internal scale."""
        cal = self.calibration_for(company)
        normalized = _apply_affine(cal, float(grade))
        return CalibrationResult(
            company=(company or "").upper(),
            raw_grade=float(grade),
            normalized_grade=normalized,
            confidence=cal.confidence,
            method=CALIBRATION_METHOD,
            version=self._version,
        )


def normalize_grade(company: str, grade: float) -> float:
    """Convenience: PSA-equivalent normalised grade for ``(company, grade)``.

    Uses the module-level placeholder calibration table.
    """
    return _apply_affine(_resolve(company), float(grade))
