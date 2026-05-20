"""Tests for ``PsaParser``.

Every test asserts against a pre-loaded HTML fixture from ``tests/fixtures/``.
No network calls are made.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal

import pytest

from grading.scrapers.psa.parser import PsaParser


@pytest.fixture(scope="module")
def parser() -> PsaParser:
    return PsaParser()


class TestPsa10WithSubgrades:
    def test_cert_number(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.cert_number == "44001234"

    def test_card_name(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.card_name == "Charizard"

    def test_set_name(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.set_name == "Base Set"

    def test_year(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.year == "1999"

    def test_card_number(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.card_number == "4/102"

    def test_overall_grade_is_10(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.grade == Decimal("10")

    def test_grade_label(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.grade_label == "PSA 10"

    def test_subgrades_present(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.has_subgrades()

    def test_centering_subgrade(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.centering_subgrade == Decimal("9.5")

    def test_corners_subgrade(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.corners_subgrade == Decimal("10")

    def test_edges_subgrade(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.edges_subgrade == Decimal("10")

    def test_surface_subgrade(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.surface_subgrade == Decimal("10")

    def test_no_qualifiers(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.qualifiers == []

    def test_image_url_present(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.image_url is not None
        assert "44001234" in r.image_url

    def test_raw_html_sha256_is_hex(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        expected = hashlib.sha256(html_psa10).hexdigest()
        assert r.raw_html_sha256 == expected

    def test_fetched_at_set(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        assert r.fetched_at is not None


class TestPsa9WithSubgrades:
    def test_grade(self, parser, html_psa9):
        r = parser.parse(html_psa9, cert_number="22009876")
        assert r.grade == Decimal("9")

    def test_half_grade_surface(self, parser, html_psa9):
        r = parser.parse(html_psa9, cert_number="22009876")
        assert r.surface_subgrade == Decimal("8.5")

    def test_half_grade_edges(self, parser, html_psa9):
        r = parser.parse(html_psa9, cert_number="22009876")
        assert r.edges_subgrade == Decimal("9.5")


class TestPsa8NoSubgrades:
    def test_grade(self, parser, html_psa8_no_subgrades):
        r = parser.parse(html_psa8_no_subgrades, cert_number="00387654")
        assert r.grade == Decimal("8")

    def test_no_subgrades(self, parser, html_psa8_no_subgrades):
        r = parser.parse(html_psa8_no_subgrades, cert_number="00387654")
        assert not r.has_subgrades()
        assert r.centering_subgrade is None
        assert r.corners_subgrade is None
        assert r.edges_subgrade is None
        assert r.surface_subgrade is None

    def test_no_image(self, parser, html_psa8_no_subgrades):
        r = parser.parse(html_psa8_no_subgrades, cert_number="00387654")
        assert r.image_url is None


class TestPsa1LowGrade:
    def test_grade(self, parser, html_psa1):
        r = parser.parse(html_psa1, cert_number="01100099")
        assert r.grade == Decimal("1")

    def test_card_name(self, parser, html_psa1):
        r = parser.parse(html_psa1, cert_number="01100099")
        assert r.card_name == "Pikachu"

    def test_no_subgrades(self, parser, html_psa1):
        r = parser.parse(html_psa1, cert_number="01100099")
        assert not r.has_subgrades()


class TestAuthenticGrade:
    def test_grade_is_none(self, parser, html_authentic):
        r = parser.parse(html_authentic, cert_number="33012345")
        assert r.grade is None

    def test_grade_label(self, parser, html_authentic):
        r = parser.parse(html_authentic, cert_number="33012345")
        assert r.grade_label == "Authentic"

    def test_row_grade_is_none(self, parser, html_authentic):
        r = parser.parse(html_authentic, cert_number="33012345")
        row = r.to_training_sample_row()
        assert row["grade"] is None

    def test_raw_metadata_preserves_label(self, parser, html_authentic):
        r = parser.parse(html_authentic, cert_number="33012345")
        row = r.to_training_sample_row()
        assert row["raw_metadata"]["grade_label"] == "Authentic"


class TestAuthenticAlteredGrade:
    def test_grade_is_none(self, parser, html_authentic_altered):
        r = parser.parse(html_authentic_altered, cert_number="77045678")
        assert r.grade is None

    def test_grade_label(self, parser, html_authentic_altered):
        r = parser.parse(html_authentic_altered, cert_number="77045678")
        assert r.grade_label == "Authentic Altered"


class TestQualifierOC:
    def test_grade(self, parser, html_qualifier_oc):
        r = parser.parse(html_qualifier_oc, cert_number="55078901")
        assert r.grade == Decimal("9")

    def test_qualifiers(self, parser, html_qualifier_oc):
        r = parser.parse(html_qualifier_oc, cert_number="55078901")
        assert r.qualifiers == ["OC"]

    def test_subgrades_present(self, parser, html_qualifier_oc):
        r = parser.parse(html_qualifier_oc, cert_number="55078901")
        assert r.has_subgrades()

    def test_centering_reflects_oc(self, parser, html_qualifier_oc):
        r = parser.parse(html_qualifier_oc, cert_number="55078901")
        assert r.centering_subgrade == Decimal("7")


class TestTosBlockDetection:
    def test_cloudflare_block_detected(self, html_cloudflare_block):
        assert PsaParser.is_blocked(html_cloudflare_block) is True

    def test_normal_cert_not_blocked(self, html_psa10):
        assert PsaParser.is_blocked(html_psa10) is False

    def test_block_detection_on_str(self, html_cloudflare_block):
        html_str = html_cloudflare_block.decode("utf-8")
        assert PsaParser.is_blocked(html_str) is True


class TestTrainingSampleRow:
    def test_source_is_psa_cert(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert row["source"] == "psa_cert"

    def test_source_id_is_cert_number(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert row["source_id"] == "44001234"

    def test_grade_company_is_psa(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert row["grade_company"] == "PSA"

    def test_parse_confidence_is_1(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert row["parse_confidence"] == 1.0

    def test_printing_id_is_none(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert row["printing_id"] is None

    def test_subgrades_in_row(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert row["subgrades"] is not None
        assert row["subgrades"]["centering"] == pytest.approx(9.5)
        assert row["subgrades"]["corners"] == pytest.approx(10.0)

    def test_no_subgrades_row_is_none(self, parser, html_psa8_no_subgrades):
        r = parser.parse(html_psa8_no_subgrades, cert_number="00387654")
        row = r.to_training_sample_row()
        assert row["subgrades"] is None

    def test_raw_metadata_contains_qualifiers(self, parser, html_qualifier_oc):
        r = parser.parse(html_qualifier_oc, cert_number="55078901")
        row = r.to_training_sample_row()
        assert row["raw_metadata"]["qualifiers"] == ["OC"]

    def test_raw_metadata_sha256_present(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert len(row["raw_metadata"]["raw_html_sha256"]) == 64

    def test_images_front_present_when_image_url(self, parser, html_psa10):
        r = parser.parse(html_psa10, cert_number="44001234")
        row = r.to_training_sample_row()
        assert "front" in row["images"]

    def test_images_empty_when_no_image(self, parser, html_psa8_no_subgrades):
        r = parser.parse(html_psa8_no_subgrades, cert_number="00387654")
        row = r.to_training_sample_row()
        assert row["images"] == {}
