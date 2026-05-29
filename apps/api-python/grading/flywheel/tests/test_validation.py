"""Validation tests — per-company cert formats, grade ranges, photos, consent."""

from __future__ import annotations

import pytest

from grading.flywheel.validation import (
    SUPPORTED_COMPANIES,
    validate_cert_number,
    validate_company,
    validate_submission,
)


class TestCompany:
    @pytest.mark.parametrize("company", ["PSA", "BGS", "CGC", "SGC"])
    def test_supported_companies_pass(self, company):
        assert validate_company(company) is None

    @pytest.mark.parametrize("company", ["psa", "Bgs", "cgc"])
    def test_company_is_case_insensitive(self, company):
        assert validate_company(company) is None

    @pytest.mark.parametrize("company", ["", "ABC", "PCG", "BECKETT", "TAG"])
    def test_unsupported_companies_fail(self, company):
        err = validate_company(company)
        assert err is not None
        assert err.startswith("grade_company:")

    def test_supported_companies_constant(self):
        assert SUPPORTED_COMPANIES == ("PSA", "BGS", "CGC", "SGC")


class TestCertNumberFormat:
    @pytest.mark.parametrize(
        "company,cert",
        [
            ("PSA", "12345678"),
            ("PSA", "1234567"),
            ("BGS", "0015384312"),
            ("CGC", "4380266001"),
            ("SGC", "123456"),
        ],
    )
    def test_valid_certs_pass(self, company, cert):
        assert validate_cert_number(company, cert) is None

    @pytest.mark.parametrize(
        "company,cert",
        [
            ("PSA", "PSA 12345678"),
            ("PSA", "  12345678 "),
            ("CGC", "4380266-001"),
            ("BGS", "#0015384312"),
        ],
    )
    def test_certs_normalised_before_format_check(self, company, cert):
        # Prefixes / separators are stripped, so these all pass.
        assert validate_cert_number(company, cert) is None

    @pytest.mark.parametrize(
        "company,cert",
        [
            ("PSA", ""),
            ("PSA", "   "),
            ("PSA", "ABCDEFGH"),
            ("PSA", "123"),  # too short
            ("PSA", "1234567890123"),  # too long
            ("BGS", "12"),
            ("SGC", "12X45"),
        ],
    )
    def test_invalid_certs_fail(self, company, cert):
        err = validate_cert_number(company, cert)
        assert err is not None
        assert err.startswith("cert_number:")

    def test_empty_cert_message(self):
        err = validate_cert_number("PSA", "")
        assert err == "cert_number: empty after normalisation"


class TestGradeRanges:
    @pytest.mark.parametrize("grade", [1.0, 5.5, 8.5, 9.0, 10.0])
    def test_valid_overall_grades(self, make_submission, grade):
        result = validate_submission(make_submission(overall_grade=grade))
        assert result.ok, result.errors

    @pytest.mark.parametrize("grade", [0.5, 0.0, 10.5, 11.0, -1.0])
    def test_out_of_range_overall_grades_fail(self, make_submission, grade):
        result = validate_submission(make_submission(overall_grade=grade))
        assert not result.ok
        assert "overall_grade" in result.error_fields

    @pytest.mark.parametrize("grade", [8.3, 8.7, 9.25])
    def test_off_grid_overall_grades_fail(self, make_submission, grade):
        result = validate_submission(make_submission(overall_grade=grade))
        assert not result.ok
        assert "overall_grade" in result.error_fields

    def test_none_overall_with_subgrades_ok(self, make_submission):
        sub = {"centering": 9.5, "corners": 9.0, "edges": 9.5, "surface": 9.0}
        result = validate_submission(
            make_submission(overall_grade=None, subgrades=sub, grade_company="BGS", cert_number="0015384312")
        )
        assert result.ok, result.errors

    def test_no_grade_signal_fails(self, make_submission):
        result = validate_submission(make_submission(overall_grade=None, subgrades=None))
        assert not result.ok
        assert "overall_grade" in result.error_fields

    def test_black_label_needs_no_numeric_grade(self, make_submission):
        result = validate_submission(
            make_submission(
                overall_grade=None,
                subgrades=None,
                black_label=True,
                grade_company="BGS",
                cert_number="0015384312",
            )
        )
        assert result.ok, result.errors

    def test_subgrade_out_of_range_fails(self, make_submission):
        sub = {"corners": 11.0}
        result = validate_submission(make_submission(subgrades=sub))
        assert not result.ok
        assert "subgrades" in result.error_fields

    def test_unknown_subgrade_key_fails(self, make_submission):
        sub = {"gloss": 9.0}
        result = validate_submission(make_submission(subgrades=sub))
        assert not result.ok
        assert "subgrades" in result.error_fields


class TestPhotos:
    def test_missing_front_fails(self, make_submission):
        result = validate_submission(make_submission(image_urls={"back": "https://x/b.jpg"}))
        assert not result.ok
        assert "image_urls" in result.error_fields

    def test_missing_back_fails(self, make_submission):
        result = validate_submission(make_submission(image_urls={"front": "https://x/f.jpg"}))
        assert not result.ok
        assert "image_urls" in result.error_fields

    def test_front_and_back_sufficient(self, make_submission):
        result = validate_submission(
            make_submission(image_urls={"front": "https://x/f.jpg", "back": "https://x/b.jpg"})
        )
        assert result.ok, result.errors

    def test_corners_must_be_list(self, make_submission):
        result = validate_submission(
            make_submission(
                image_urls={"front": "https://x/f.jpg", "back": "https://x/b.jpg", "corners": "nope"}
            )
        )
        assert not result.ok
        assert "image_urls" in result.error_fields

    def test_empty_images_fails(self, make_submission):
        result = validate_submission(make_submission(image_urls={}))
        assert not result.ok


class TestConsent:
    def test_consent_false_fails(self, make_submission):
        result = validate_submission(make_submission(consent=False))
        assert not result.ok
        assert "consent" in result.error_fields

    def test_consent_true_ok(self, valid_submission):
        result = validate_submission(valid_submission)
        assert result.ok, result.errors


class TestAggregate:
    def test_valid_submission_has_no_errors(self, valid_submission):
        result = validate_submission(valid_submission)
        assert result.ok
        assert result.errors == []

    def test_multiple_errors_aggregated(self, make_submission):
        bad = make_submission(
            grade_company="TAG",
            consent=False,
            image_urls={},
            overall_grade=None,
            subgrades=None,
        )
        result = validate_submission(bad)
        assert not result.ok
        # company + photos (front, back) + grade + consent
        assert len(result.errors) >= 4

    def test_unknown_company_skips_cert_format_noise(self, make_submission):
        result = validate_submission(make_submission(grade_company="TAG"))
        assert "cert_number" not in result.error_fields
        assert "grade_company" in result.error_fields
