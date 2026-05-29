"""Tests for the cross-company grade calibration scaffold (#FU-56)."""

from __future__ import annotations

import pytest

from grading.calibration import (
    CALIBRATION_VERSION,
    PLACEHOLDER_CALIBRATIONS,
    SUPPORTED_COMPANIES,
    CalibrationResult,
    CompanyCalibration,
    GradeCalibrator,
    normalize_grade,
)


class TestPlaceholderTable:
    def test_covers_all_grade_companies(self):
        # Mirrors the DB grade_company CHECK enum (PSA/BGS/CGC/SGC/OTHER).
        for company in ("PSA", "BGS", "CGC", "SGC", "OTHER"):
            assert company in PLACEHOLDER_CALIBRATIONS

    def test_supported_companies_matches_table(self):
        assert set(SUPPORTED_COMPANIES) == set(PLACEHOLDER_CALIBRATIONS)

    def test_psa_is_identity_anchor(self):
        psa = PLACEHOLDER_CALIBRATIONS["PSA"]
        assert psa.slope == 1.0
        assert psa.intercept == 0.0
        assert psa.confidence == 1.0

    def test_non_psa_lower_confidence(self):
        for company in ("BGS", "CGC", "SGC", "OTHER"):
            assert PLACEHOLDER_CALIBRATIONS[company].confidence < 1.0

    def test_entries_are_company_calibration(self):
        for cal in PLACEHOLDER_CALIBRATIONS.values():
            assert isinstance(cal, CompanyCalibration)
            assert cal.notes  # documented rationale present


class TestNormalizeGrade:
    def test_psa_identity(self):
        assert normalize_grade("PSA", 9.0) == pytest.approx(9.0)
        assert normalize_grade("PSA", 10.0) == pytest.approx(10.0)

    def test_bgs_nudged_up(self):
        assert normalize_grade("BGS", 9.0) == pytest.approx(9.3)

    def test_clamps_to_ten(self):
        # BGS 10 + 0.3 intercept would be 10.3 → clamped to 10.0.
        assert normalize_grade("BGS", 10.0) == pytest.approx(10.0)

    def test_clamps_to_floor(self):
        assert normalize_grade("PSA", 0.0) == pytest.approx(1.0)

    def test_case_insensitive_company(self):
        assert normalize_grade("bgs", 9.0) == pytest.approx(9.3)

    def test_unknown_company_falls_back_to_other(self):
        # Unknown house → OTHER identity map.
        assert normalize_grade("KSA", 8.0) == pytest.approx(8.0)


class TestGradeCalibrator:
    def test_calibrate_returns_result(self):
        calibrator = GradeCalibrator()
        result = calibrator.calibrate("BGS", 9.0)
        assert isinstance(result, CalibrationResult)
        assert result.company == "BGS"
        assert result.raw_grade == 9.0
        assert result.normalized_grade == pytest.approx(9.3)
        assert result.method == "placeholder-linear"
        assert result.version == CALIBRATION_VERSION

    def test_confidence_carried_from_table(self):
        calibrator = GradeCalibrator()
        assert calibrator.calibrate("PSA", 10.0).confidence == 1.0
        assert calibrator.calibrate("CGC", 9.0).confidence == 0.5

    def test_calibration_for_unknown_is_other(self):
        calibrator = GradeCalibrator()
        assert calibrator.calibration_for("ZZZ").company == "OTHER"

    def test_injecting_learned_table_overrides_placeholder(self):
        # #FU-58 seam: a fitted table drops in without touching call sites.
        learned = {
            "PSA": CompanyCalibration("PSA", 0.9, 0.5, 0.95, "learned"),
            "OTHER": CompanyCalibration("OTHER", 1.0, 0.0, 0.3, "fallback"),
        }
        calibrator = GradeCalibrator(calibrations=learned, version="v1-learned")
        result = calibrator.calibrate("PSA", 10.0)
        # 0.9 * 10 + 0.5 = 9.5
        assert result.normalized_grade == pytest.approx(9.5)
        assert result.version == "v1-learned"

    def test_monotonic_within_company(self):
        calibrator = GradeCalibrator()
        grades = [calibrator.calibrate("PSA", g).normalized_grade for g in (5, 6, 7, 8, 9)]
        assert grades == sorted(grades)
