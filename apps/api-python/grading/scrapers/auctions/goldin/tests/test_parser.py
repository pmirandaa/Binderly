"""Tests for the Goldin Auctions lot-page HTML parser."""

from __future__ import annotations

from pathlib import Path

import pytest

from grading.scrapers.auctions.goldin.parser import parse_lot_file, parse_lot_html

FIXTURES = Path(__file__).parent.parent / "fixtures"


class TestGoldinParserPsaLot:
    def setup_method(self):
        self.obs = parse_lot_file(FIXTURES / "psa_lot.html")

    def test_returns_observation(self):
        assert self.obs is not None

    def test_lot_id(self):
        assert self.obs.lot_id == "goldin-8001234"

    def test_auction_house(self):
        assert self.obs.auction_house == "goldin"

    def test_lot_title_contains_psa(self):
        assert "PSA 10" in self.obs.lot_title

    def test_grading_company(self):
        assert self.obs.parsed_grading_company == "PSA"

    def test_overall_grade(self):
        assert self.obs.parsed_overall_grade == 10.0

    def test_realised_price_cents(self):
        assert self.obs.realised_price_cents == 25000000

    def test_currency_code(self):
        assert self.obs.currency_code == "USD"

    def test_premium_cents(self):
        assert self.obs.realised_premium_cents == 5000000

    def test_closed_at_not_none(self):
        assert self.obs.closed_at is not None

    def test_closed_at_year(self):
        assert self.obs.closed_at.year == 2024

    def test_images_extracted(self):
        assert len(self.obs.lot_image_urls) == 3
        assert all("goldin-8001234" in url for url in self.obs.lot_image_urls)

    def test_raw_html_sha256_is_hex(self):
        assert self.obs.raw_html_sha256 is not None
        assert len(self.obs.raw_html_sha256) == 64
        int(self.obs.raw_html_sha256, 16)  # must be valid hex

    def test_auction_id(self):
        assert self.obs.auction_id == "spring-2024"

    def test_auction_name(self):
        assert "Goldin" in self.obs.auction_name

    def test_is_graded(self):
        assert self.obs.is_graded is True


class TestGoldinParserBgsLot:
    def setup_method(self):
        self.obs = parse_lot_file(FIXTURES / "bgs_lot.html")

    def test_returns_observation(self):
        assert self.obs is not None

    def test_grading_company(self):
        assert self.obs.parsed_grading_company == "BGS"

    def test_overall_grade(self):
        assert self.obs.parsed_overall_grade == 10.0

    def test_sub_grades_extracted(self):
        assert self.obs.parsed_sub_grades is not None
        assert self.obs.parsed_sub_grades["centering"] == 10.0
        assert self.obs.parsed_sub_grades["corners"] == 10.0
        assert self.obs.parsed_sub_grades["edges"] == 10.0
        assert self.obs.parsed_sub_grades["surface"] == 10.0


class TestGoldinParserCgcLot:
    def setup_method(self):
        self.obs = parse_lot_file(FIXTURES / "cgc_lot.html")

    def test_returns_observation(self):
        assert self.obs is not None

    def test_grading_company(self):
        assert self.obs.parsed_grading_company == "CGC"

    def test_overall_grade(self):
        assert self.obs.parsed_overall_grade == 10.0


class TestGoldinParserRawCard:
    def test_returns_none_for_raw_card(self):
        obs = parse_lot_file(FIXTURES / "raw_card.html")
        assert obs is None, "Raw (ungraded) lots must be excluded (returns None)"


class TestGoldinParserMultiLot:
    def setup_method(self):
        self.obs = parse_lot_file(FIXTURES / "multi_lot.html")

    def test_returns_observation(self):
        assert self.obs is not None

    def test_grading_company(self):
        assert self.obs.parsed_grading_company == "SGC"

    def test_overall_grade(self):
        assert self.obs.parsed_overall_grade == 8.0

    def test_multiple_images(self):
        assert len(self.obs.lot_image_urls) == 3


class TestGoldinParserEdgeCases:
    def test_empty_html_returns_none(self):
        obs = parse_lot_html(b"")
        assert obs is None

    def test_missing_lot_id_returns_none(self):
        html = b"<html><body><div class='lot-detail'><h1 class='lot-title'>PSA 10 Charizard</h1></div></body></html>"
        obs = parse_lot_html(html)
        assert obs is None
