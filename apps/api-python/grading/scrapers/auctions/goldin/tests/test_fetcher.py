"""Tests for the Goldin Auctions archive fetcher."""

from __future__ import annotations

from pathlib import Path

import pytest

from grading.scrapers.auctions._shared.http_client import LiveModeDisabledError
from grading.scrapers.auctions.goldin.fetcher import GoldinFetcher

FIXTURES = Path(__file__).parent.parent / "fixtures"


class TestGoldinFetcherMock:
    def setup_method(self):
        self.fetcher = GoldinFetcher(fixtures_dir=FIXTURES)
        self.result = self.fetcher.fetch_mock()

    def test_returns_observations(self):
        assert len(self.result.observations) > 0

    def test_skips_raw_card(self):
        assert self.result.skipped_raw >= 1

    def test_all_observations_are_graded(self):
        for obs in self.result.observations:
            assert obs.is_graded is True

    def test_all_observations_have_goldin_house(self):
        for obs in self.result.observations:
            assert obs.auction_house == "goldin"

    def test_psa_lot_present(self):
        companies = {obs.parsed_grading_company for obs in self.result.observations}
        assert "PSA" in companies

    def test_bgs_lot_present(self):
        companies = {obs.parsed_grading_company for obs in self.result.observations}
        assert "BGS" in companies

    def test_cgc_lot_present(self):
        companies = {obs.parsed_grading_company for obs in self.result.observations}
        assert "CGC" in companies

    def test_sgc_lot_present(self):
        companies = {obs.parsed_grading_company for obs in self.result.observations}
        assert "SGC" in companies

    def test_no_errors(self):
        assert self.result.errors == []

    def test_lot_ids_unique(self):
        lot_ids = [obs.lot_id for obs in self.result.observations]
        assert len(lot_ids) == len(set(lot_ids))

    def test_all_observations_have_price(self):
        for obs in self.result.observations:
            assert obs.realised_price_cents is not None
            assert obs.realised_price_cents > 0


class TestGoldinFetcherLiveGated:
    def test_live_fetch_raises_without_env(self, monkeypatch):
        monkeypatch.delenv("AUCTIONS_LIVE", raising=False)
        fetcher = GoldinFetcher()
        with pytest.raises(LiveModeDisabledError):
            fetcher.fetch_auction(
                auction_id="1234",
                year="2024",
                auction_slug="spring-2024",
            )
