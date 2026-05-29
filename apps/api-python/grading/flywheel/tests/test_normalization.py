"""Normalisation tests — cert canonicalisation + conservative grade mapping."""

from __future__ import annotations

import pytest

from grading.flywheel.normalization import (
    CANONICAL_GRADE_STEP,
    normalize_cert_number,
    normalize_grade,
    normalize_subgrades,
    source_tag,
    to_source_id,
)


class TestCertNormalization:
    def test_strips_whitespace(self):
        assert normalize_cert_number("PSA", "  12345678  ") == "12345678"

    def test_strips_company_prefix(self):
        assert normalize_cert_number("PSA", "PSA 12345678") == "12345678"

    def test_strips_company_prefix_no_space(self):
        assert normalize_cert_number("CGC", "CGC4380266001") == "4380266001"

    def test_removes_internal_hyphens(self):
        assert normalize_cert_number("CGC", "4380266-001") == "4380266001"

    def test_removes_hash(self):
        assert normalize_cert_number("BGS", "#0015384312") == "0015384312"

    def test_uppercases(self):
        # Letters are uppercased (validation rejects non-digits separately).
        assert normalize_cert_number("SGC", "ac12345") == "AC12345"

    def test_strips_beckett_token(self):
        assert normalize_cert_number("BGS", "BECKETT 0015384312") == "0015384312"

    def test_empty_stays_empty(self):
        assert normalize_cert_number("PSA", "") == ""
        assert normalize_cert_number("PSA", "   ") == ""

    def test_idempotent(self):
        once = normalize_cert_number("PSA", "PSA 1234-5678")
        twice = normalize_cert_number("PSA", once)
        assert once == twice == "12345678"


class TestSourceId:
    def test_format_is_company_colon_cert(self):
        assert to_source_id("PSA", "12345678") == "PSA:12345678"

    def test_company_uppercased(self):
        assert to_source_id("psa", "12345678") == "PSA:12345678"

    def test_same_cert_different_company_distinct(self):
        assert to_source_id("PSA", "12345678") != to_source_id("CGC", "12345678")

    def test_dedup_stable_across_formatting(self):
        a = to_source_id("PSA", "PSA 1234-5678")
        b = to_source_id("PSA", "12345678")
        assert a == b


class TestGradeNormalization:
    def test_none_passes_through(self):
        assert normalize_grade(None) is None

    @pytest.mark.parametrize("grade", [1.0, 5.5, 9.0, 10.0])
    def test_on_grid_unchanged(self, grade):
        assert normalize_grade(grade) == grade

    def test_clamps_high(self):
        assert normalize_grade(12.0) == 10.0

    def test_clamps_low(self):
        assert normalize_grade(0.0) == 1.0

    def test_snaps_to_half_step(self):
        assert normalize_grade(8.3) == 8.5
        assert normalize_grade(8.7) == 8.5
        assert normalize_grade(8.74) == 8.5
        assert normalize_grade(8.76) == 9.0

    def test_black_label_forces_ten(self):
        assert normalize_grade(9.0, black_label=True) == 10.0
        assert normalize_grade(None, black_label=True) == 10.0

    def test_canonical_step_constant(self):
        assert CANONICAL_GRADE_STEP == 0.5


class TestSubgradeNormalization:
    def test_none_returns_none(self):
        assert normalize_subgrades(None) is None

    def test_empty_returns_none(self):
        assert normalize_subgrades({}) is None

    def test_each_subgrade_snapped(self):
        out = normalize_subgrades({"centering": 8.3, "corners": 9.0})
        assert out == {"centering": 8.5, "corners": 9.0}

    def test_black_label_expands_to_perfect_set(self):
        out = normalize_subgrades(None, black_label=True)
        assert out == {"centering": 10.0, "corners": 10.0, "edges": 10.0, "surface": 10.0}

    def test_black_label_overrides_supplied(self):
        out = normalize_subgrades({"corners": 9.0}, black_label=True)
        assert out["corners"] == 10.0


def test_source_tag():
    assert source_tag() == "community_flywheel"
