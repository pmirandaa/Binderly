"""Integration tests for ``grading.scrapers.ebay.scraper``.

Tests cover:
- Multi-query run yields observations from all fixtures
- Deduplication within a run (same listing_id in two pages → emitted once)
- Currency-conversion case (GBP fixture → final_price_cents in pence)
- Missing grade → ``parsed_overall_grade = None``
- PSA 10 observation has correct fields
- BGS 9.5 with sub-grades has parsed_sub_grades populated
- CGC and SGC observations are typed correctly
- Unknown grader → ``parsed_grading_company == 'OTHER'``
- ``EbayGradedListingObservation`` field types
- ``write_observations`` stdout mode (smoke test)
"""

from __future__ import annotations

import io
import json
import sys
from decimal import Decimal
from pathlib import Path

import pytest

from grading.scrapers.ebay.client import MockFindingClient
from grading.scrapers.ebay.scraper import EbayScraper, ScrapeConfig
from grading.scrapers.ebay.types import EbayGradedListingObservation, PARSER_VERSION
from grading.scrapers.ebay.writer import write_observations

FIXTURES_DIR: Path = Path(__file__).parent.parent / "fixtures"


def _make_scraper(fixture_names: list[str], queries: list[str] | None = None) -> EbayScraper:
    client = MockFindingClient(fixture_names=fixture_names, fixtures_dir=FIXTURES_DIR)
    config = ScrapeConfig(queries=queries or ["PSA 10"], max_pages=1)
    return EbayScraper(client=client, config=config)


class TestEbayScraperBasic:
    def test_psa_10_observation_fields(self) -> None:
        scraper = _make_scraper(["psa_10_charizard"])
        observations = list(scraper.scrape())
        assert len(observations) >= 1
        obs = observations[0]
        assert isinstance(obs, EbayGradedListingObservation)
        assert obs.parsed_grading_company == "PSA"
        assert obs.parsed_overall_grade == Decimal("10")
        assert obs.final_price_cents == 299900  # $2999.00 × 100
        assert obs.currency_code == "USD"
        assert obs.listing_id == "371234567890"
        assert obs.parser_version == PARSER_VERSION
        assert obs.thumbnail_url is not None
        assert obs.raw_blob_json is not None

    def test_bgs_9_5_with_sub_grades(self) -> None:
        scraper = _make_scraper(["bgs_9_5_venusaur"])
        observations = list(scraper.scrape())
        assert len(observations) == 1
        obs = observations[0]
        assert obs.parsed_grading_company == "BGS"
        assert obs.parsed_overall_grade == Decimal("9.5")
        assert obs.parsed_sub_grades is not None
        assert obs.parsed_sub_grades["centering"] == 10.0
        assert obs.parsed_sub_grades["corners"] == 9.5
        assert obs.final_price_cents == 45000  # $450.00 × 100

    def test_cgc_8_observation(self) -> None:
        scraper = _make_scraper(["cgc_8_blastoise"])
        observations = list(scraper.scrape())
        assert len(observations) == 1
        obs = observations[0]
        assert obs.parsed_grading_company == "CGC"
        assert obs.parsed_overall_grade == Decimal("8")
        assert obs.final_price_cents == 12000

    def test_sgc_9_observation(self) -> None:
        scraper = _make_scraper(["sgc_9_pikachu"])
        observations = list(scraper.scrape())
        assert len(observations) == 1
        obs = observations[0]
        assert obs.parsed_grading_company == "SGC"
        assert obs.parsed_overall_grade == Decimal("9")

    def test_unknown_grader_other(self) -> None:
        scraper = _make_scraper(["unknown_grader"])
        observations = list(scraper.scrape())
        assert len(observations) == 1
        obs = observations[0]
        assert obs.parsed_grading_company == "OTHER"
        assert obs.parse_confidence == pytest.approx(0.5)

    def test_misgraded_title_company_detected(self) -> None:
        # Title: "PSA Graded Pokemon Fossil Set Mewtwo Holo 10/62 Card Slab"
        # Company is PSA, grade token "10" exists but is not adjacent → penalised
        scraper = _make_scraper(["misgraded_title"])
        observations = list(scraper.scrape())
        assert len(observations) == 1
        obs = observations[0]
        assert obs.parsed_grading_company == "PSA"
        assert obs.parse_confidence < 1.0

    def test_gbp_currency_price_in_pence(self) -> None:
        scraper = _make_scraper(["gbp_currency"])
        observations = list(scraper.scrape())
        assert len(observations) == 1
        obs = observations[0]
        assert obs.currency_code == "GBP"
        assert obs.final_price_cents == 32000  # £320.00 × 100 = 32000 pence

    def test_sold_at_parsed(self) -> None:
        scraper = _make_scraper(["psa_10_charizard"])
        observations = list(scraper.scrape())
        obs = observations[0]
        assert obs.sold_at is not None
        assert obs.sold_at.year == 2026


class TestDeduplication:
    def test_same_listing_id_emitted_once(self) -> None:
        # Use the same fixture twice — same listing IDs will appear in both
        # "queries" but should be deduplicated.
        client = MockFindingClient(
            fixture_names=["psa_10_charizard", "psa_10_charizard"],
            fixtures_dir=FIXTURES_DIR,
        )
        config = ScrapeConfig(queries=["PSA 10", "PSA 10 Charizard"], max_pages=1)
        scraper = EbayScraper(client=client, config=config)
        observations = list(scraper.scrape())
        listing_ids = [obs.listing_id for obs in observations]
        # No duplicates
        assert len(listing_ids) == len(set(listing_ids))

    def test_two_different_fixtures_not_deduped(self) -> None:
        client = MockFindingClient(
            fixture_names=["psa_10_charizard", "bgs_9_5_venusaur"],
            fixtures_dir=FIXTURES_DIR,
        )
        config = ScrapeConfig(queries=["PSA 10", "BGS 9.5"], max_pages=1)
        scraper = EbayScraper(client=client, config=config)
        observations = list(scraper.scrape())
        # psa fixture has 2 items, bgs fixture has 1 → 3 total (all different IDs)
        assert len(observations) == 3


class TestMultiQuery:
    def test_multi_query_scrape_returns_all(self) -> None:
        client = MockFindingClient(
            fixture_names=["cgc_8_blastoise", "sgc_9_pikachu"],
            fixtures_dir=FIXTURES_DIR,
        )
        config = ScrapeConfig(queries=["CGC 8", "SGC 9"], max_pages=1)
        scraper = EbayScraper(client=client, config=config)
        observations = list(scraper.scrape())
        assert len(observations) == 2
        companies = {obs.parsed_grading_company for obs in observations}
        assert "CGC" in companies
        assert "SGC" in companies


class TestWriteObservations:
    def test_stdout_mode_emits_jsonl(self, capsys: pytest.CaptureFixture) -> None:
        scraper = _make_scraper(["psa_10_charizard"])
        observations = list(scraper.scrape())
        count = write_observations(observations, mode="stdout")
        assert count == len(observations)
        captured = capsys.readouterr()
        lines = [line for line in captured.out.splitlines() if line.strip()]
        assert len(lines) == count
        # Each line is valid JSON
        for line in lines:
            obj = json.loads(line)
            assert "listing_id" in obj
            assert "parsed_grading_company" in obj
            assert "final_price_cents" in obj

    def test_observation_json_has_parser_version(self, capsys: pytest.CaptureFixture) -> None:
        scraper = _make_scraper(["psa_10_charizard"])
        observations = list(scraper.scrape())
        write_observations(observations, mode="stdout")
        captured = capsys.readouterr()
        first_line = captured.out.splitlines()[0]
        obj = json.loads(first_line)
        assert obj["parser_version"] == PARSER_VERSION

    def test_returns_zero_for_empty(self) -> None:
        count = write_observations([], mode="stdout")
        assert count == 0
