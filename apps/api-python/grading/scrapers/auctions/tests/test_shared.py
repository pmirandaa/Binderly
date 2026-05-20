"""Tests for the _shared utilities: grade_parser, currency, types."""

from __future__ import annotations

import pytest

from grading.scrapers.auctions._shared.currency import parse_price
from grading.scrapers.auctions._shared.grade_parser import parse_lot_title
from grading.scrapers.auctions._shared.types import AuctionLotObservation


# ---------------------------------------------------------------------------
# grade_parser tests
# ---------------------------------------------------------------------------


class TestParseLotTitle:
    def test_psa_10(self):
        company, grade, sub = parse_lot_title(
            "PSA 10 GEM MT 1999 Pokemon Base Set Shadowless Charizard Holo #4"
        )
        assert company == "PSA"
        assert grade == 10.0
        assert sub is None

    def test_psa_9(self):
        company, grade, _ = parse_lot_title(
            "PSA 9 MINT 2000 Pokemon Base Set Blastoise Holo #2"
        )
        assert company == "PSA"
        assert grade == 9.0

    def test_psa_authentic(self):
        company, grade, _ = parse_lot_title(
            "PSA AUTHENTIC 1999 Pokemon Base Set Pikachu #58 Thick Stamp Error"
        )
        assert company == "PSA"
        assert grade is None  # text grade, no numeric

    def test_bgs_9_5(self):
        company, grade, sub = parse_lot_title(
            "BGS 9.5 GEM MINT 2003 Pokemon EX Dragon Rayquaza Holo #97"
        )
        assert company == "BGS"
        assert grade == 9.5
        assert sub is None

    def test_bgs_9_5_with_subgrades(self):
        company, grade, sub = parse_lot_title(
            "BGS 9.5 GEM MINT 2003 Pokemon EX Dragon Rayquaza Holo #97 [9.5 9 9.5 9]"
        )
        assert company == "BGS"
        assert grade == 9.5
        assert sub is not None
        assert sub["centering"] == 9.5
        assert sub["corners"] == 9.0
        assert sub["edges"] == 9.5
        assert sub["surface"] == 9.0

    def test_bgs_10_black_label(self):
        company, grade, sub = parse_lot_title(
            "BGS 10 BLACK LABEL 2002 Pokemon Legendary Collection Charizard [10 10 10 10]"
        )
        assert company == "BGS"
        assert grade == 10.0
        assert sub is not None
        assert sub["centering"] == 10.0
        assert sub["corners"] == 10.0
        assert sub["edges"] == 10.0
        assert sub["surface"] == 10.0

    def test_cgc_9(self):
        company, grade, _ = parse_lot_title(
            "CGC 9 MINT 2000 Pokemon Neo Genesis Lugia Holo #9"
        )
        assert company == "CGC"
        assert grade == 9.0

    def test_cgc_10(self):
        company, grade, _ = parse_lot_title(
            "CGC 10 PRISTINE 2000 Pokemon Neo Genesis Lugia Holo #9"
        )
        assert company == "CGC"
        assert grade == 10.0

    def test_sgc_8(self):
        company, grade, _ = parse_lot_title(
            "SGC 8 NM/M 1999 Pokemon Base Set Charizard Shadowless Holo #4"
        )
        assert company == "SGC"
        assert grade == 8.0

    def test_sgc_pristine_10(self):
        company, grade, _ = parse_lot_title(
            "SGC PRISTINE 10 Pokemon 1999 Base Set Pikachu Illustrator"
        )
        assert company == "SGC"
        assert grade == 10.0

    def test_raw_card_excluded(self):
        company, grade, sub = parse_lot_title(
            "1999 Pokemon Base Set Shadowless Blastoise Holo #2 RAW Ungraded"
        )
        assert company == "unknown"
        assert grade is None
        assert sub is None

    def test_raw_nm_excluded(self):
        company, grade, _ = parse_lot_title(
            "1998 Pokemon Japanese Base Set Charizard Holo Ungraded Raw NM"
        )
        assert company == "unknown"
        assert grade is None

    def test_empty_title_excluded(self):
        company, grade, _ = parse_lot_title("")
        assert company == "unknown"

    def test_case_insensitive_psa(self):
        company, grade, _ = parse_lot_title("psa 10 charizard base set")
        assert company == "PSA"
        assert grade == 10.0


# ---------------------------------------------------------------------------
# currency tests
# ---------------------------------------------------------------------------


class TestParsePrice:
    def test_usd_with_cents(self):
        cents, currency = parse_price("$1,234.56")
        assert cents == 123456
        assert currency == "USD"

    def test_usd_round(self):
        cents, currency = parse_price("$12,500")
        assert cents == 1250000
        assert currency == "USD"

    def test_usd_two_decimal(self):
        cents, currency = parse_price("$2,500.00")
        assert cents == 250000
        assert currency == "USD"

    def test_gbp(self):
        cents, currency = parse_price("£500.00")
        assert cents == 50000
        assert currency == "GBP"

    def test_gbp_no_decimal(self):
        cents, currency = parse_price("£500")
        assert cents == 50000
        assert currency == "GBP"

    def test_large_usd(self):
        cents, currency = parse_price("$250,000.00")
        assert cents == 25000000
        assert currency == "USD"

    def test_empty_returns_none(self):
        cents, currency = parse_price("")
        assert cents is None
        assert currency is None

    def test_non_price_returns_none(self):
        cents, currency = parse_price("N/A")
        assert cents is None

    def test_usd_explicit_suffix(self):
        cents, currency = parse_price("1,234.56 USD")
        assert cents == 123456
        assert currency == "USD"


# ---------------------------------------------------------------------------
# AuctionLotObservation type tests
# ---------------------------------------------------------------------------


class TestAuctionLotObservation:
    def test_valid_pwcc(self):
        obs = AuctionLotObservation(
            lot_id="pwcc-12345",
            auction_house="pwcc",
            lot_title="PSA 10 Charizard",
            parsed_grading_company="PSA",
            parsed_overall_grade=10.0,
            realised_price_cents=8400000,
            currency_code="USD",
        )
        assert obs.is_graded is True
        assert obs.lot_id == "pwcc-12345"

    def test_valid_goldin(self):
        obs = AuctionLotObservation(
            lot_id="goldin-8001",
            auction_house="goldin",
            lot_title="BGS 9.5 Rayquaza",
            parsed_grading_company="BGS",
            parsed_overall_grade=9.5,
            realised_price_cents=420000,
            currency_code="USD",
        )
        assert obs.is_graded is True

    def test_invalid_auction_house_raises(self):
        with pytest.raises(ValueError, match="auction_house"):
            AuctionLotObservation(
                lot_id="abc-123",
                auction_house="heritage",  # not a valid house
                lot_title="PSA 10 Charizard",
            )

    def test_empty_lot_id_raises(self):
        with pytest.raises(ValueError, match="lot_id"):
            AuctionLotObservation(
                lot_id="",
                auction_house="pwcc",
                lot_title="PSA 10 Charizard",
            )

    def test_unknown_company_is_not_graded(self):
        obs = AuctionLotObservation(
            lot_id="pwcc-raw-1",
            auction_house="pwcc",
            lot_title="Raw Charizard Base Set",
            parsed_grading_company="unknown",
        )
        assert obs.is_graded is False

    def test_invalid_grading_company_raises(self):
        with pytest.raises(ValueError, match="parsed_grading_company"):
            AuctionLotObservation(
                lot_id="pwcc-1",
                auction_house="pwcc",
                lot_title="HGA 10 Charizard",
                parsed_grading_company="HGA",  # not in valid set
            )
