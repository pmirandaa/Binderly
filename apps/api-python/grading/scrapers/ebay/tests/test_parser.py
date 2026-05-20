"""Unit tests for ``grading.scrapers.ebay.parser``.

Tests cover:
- PSA 10 detection
- PSA Authentic (non-numeric grade)
- BGS 9.5 detection
- BGS 9.5 with sub-grades in title
- CGC 8 detection
- SGC 9 detection
- OTHER (no grading company keyword)
- Grade-not-adjacent confidence penalty
- Company case-insensitivity
- Title with Beckett (BGS synonym)
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from grading.scrapers.ebay.parser import parse_title
from grading.scrapers.ebay.types import ParsedSlabTitle


class TestParseTitlePSA:
    def test_psa_10(self) -> None:
        result = parse_title("PSA 10 Pokemon Base Set Charizard Holo 4/102 GEM MINT")
        assert result.grading_company == "PSA"
        assert result.overall_grade == Decimal("10")
        assert result.grade_str == "10"
        assert result.sub_grades is None
        assert result.parse_confidence > 0.8

    def test_psa_9(self) -> None:
        result = parse_title("PSA 9 MINT Pokemon Jungle Set Scyther Holo 10/64")
        assert result.grading_company == "PSA"
        assert result.overall_grade == Decimal("9")

    def test_psa_8_5(self) -> None:
        result = parse_title("PSA 8.5 NM-Mint+ Pokemon Base Set Raichu Holo 14/102")
        assert result.grading_company == "PSA"
        assert result.overall_grade == Decimal("8.5")

    def test_psa_authentic(self) -> None:
        result = parse_title("PSA Authentic Pokemon Pikachu Illustrator Card Promo")
        assert result.grading_company == "PSA"
        assert result.overall_grade is None
        assert result.grade_str == "Auth"

    def test_psa_case_insensitive(self) -> None:
        result = parse_title("psa 10 pokemon charizard")
        assert result.grading_company == "PSA"
        assert result.overall_grade == Decimal("10")

    def test_psa_high_confidence_adjacent(self) -> None:
        result = parse_title("PSA 10 Pokemon Charizard")
        assert result.parse_confidence == pytest.approx(1.0)


class TestParseTitleBGS:
    def test_bgs_9_5(self) -> None:
        result = parse_title("BGS 9.5 Gem Mint Pokemon Base Set Venusaur Holo 15/102")
        assert result.grading_company == "BGS"
        assert result.overall_grade == Decimal("9.5")
        assert result.sub_grades is None  # no sub-grades in this title

    def test_bgs_9_5_with_subgrades(self) -> None:
        result = parse_title("BGS 9.5 10/9.5/9.5/9 Pokemon Base Set Venusaur Holo 15/102 Beckett")
        assert result.grading_company == "BGS"
        assert result.overall_grade == Decimal("9.5")
        assert result.sub_grades is not None
        assert result.sub_grades["centering"] == 10.0
        assert result.sub_grades["corners"] == 9.5
        assert result.sub_grades["edges"] == 9.5
        assert result.sub_grades["surface"] == 9.0

    def test_beckett_synonym(self) -> None:
        result = parse_title("Beckett 9 Pokemon Neo Genesis Feraligatr Holo 4/111")
        assert result.grading_company == "BGS"
        assert result.overall_grade == Decimal("9")

    def test_bgs_priority_over_psa(self) -> None:
        # PSA + BGS in same title → PSA wins (priority order)
        result = parse_title("PSA 10 vs BGS 9.5 Pokemon Charizard Comparison")
        assert result.grading_company == "PSA"


class TestParseTitleCGC:
    def test_cgc_8(self) -> None:
        result = parse_title("CGC 8 NM-Mint Pokemon Base Set 1st Edition Blastoise Holo 2/102")
        assert result.grading_company == "CGC"
        assert result.overall_grade == Decimal("8")
        assert result.sub_grades is None

    def test_cgc_10(self) -> None:
        result = parse_title("CGC 10 Pristine Pokemon Evolutions Charizard GX 9/108")
        assert result.grading_company == "CGC"
        assert result.overall_grade == Decimal("10")


class TestParseTitleSGC:
    def test_sgc_9(self) -> None:
        result = parse_title("SGC 9 MINT Pokemon Jungle Set Pikachu 60/64 Yellow Cheeks")
        assert result.grading_company == "SGC"
        assert result.overall_grade == Decimal("9")

    def test_sgc_no_sub_grades(self) -> None:
        result = parse_title("SGC 9 MINT Pokemon Jungle Set Scyther")
        assert result.sub_grades is None


class TestParseTitleOther:
    def test_no_company_returns_other(self) -> None:
        result = parse_title("GRADED 9 Pokemon Neo Genesis Lugia Holo 9/111 Slabbed")
        assert result.grading_company == "OTHER"
        assert result.parse_confidence == pytest.approx(0.5)

    def test_completely_unrelated_title(self) -> None:
        result = parse_title("Pokemon Base Set Charizard Holo 4/102 Near Mint Ungraded")
        assert result.grading_company == "OTHER"
        assert result.parse_confidence == pytest.approx(0.5)

    def test_other_overall_grade_is_none(self) -> None:
        result = parse_title("GRADED 9 Pokemon Lugia")
        assert result.grading_company == "OTHER"
        assert result.overall_grade is None  # not extracted for OTHER


class TestParseTitleConfidencePenalty:
    def test_adjacent_grade_full_confidence(self) -> None:
        # "PSA" at index 0, "10" at index 1 — distance 1 ≤ 3 → no penalty
        result = parse_title("PSA 10 Pokemon Charizard")
        assert result.parse_confidence == pytest.approx(1.0)

    def test_non_adjacent_grade_lower_confidence(self) -> None:
        # "PSA" at index 0, "10" at index 5 — distance 5 > 3 → penalty
        result = parse_title("PSA Graded Fossil Set Mewtwo Holo 10/62 Card Slab")
        assert result.grading_company == "PSA"
        assert result.parse_confidence < 1.0

    def test_returns_parsed_slab_title_type(self) -> None:
        result = parse_title("PSA 10 Charizard")
        assert isinstance(result, ParsedSlabTitle)
