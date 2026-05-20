"""Tests for the PWCC Marketplace archive fetcher."""

from __future__ import annotations

from pathlib import Path

import pytest

from grading.scrapers.auctions._shared.http_client import LiveModeDisabledError
from grading.scrapers.auctions.pwcc.fetcher import PwccFetcher

FIXTURES = Path(__file__).parent.parent / "fixtures"


class TestPwccFetcherMock:
    def setup_method(self):
        self.fetcher = PwccFetcher(fixtures_dir=FIXTURES)
        self.result = self.fetcher.fetch_mock()

    def test_returns_observations(self):
        assert len(self.result.observations) > 0

    def test_skips_raw_card(self):
        # raw_card.html should be skipped
        assert self.result.skipped_raw >= 1

    def test_all_observations_are_graded(self):
        for obs in self.result.observations:
            assert obs.is_graded is True, (
                f"Observation {obs.lot_id} has company={obs.parsed_grading_company}, "
                "expected a graded slab"
            )

    def test_all_observations_have_pwcc_house(self):
        for obs in self.result.observations:
            assert obs.auction_house == "pwcc"

    def test_psa_lot_present(self):
        companies = {obs.parsed_grading_company for obs in self.result.observations}
        assert "PSA" in companies

    def test_bgs_lot_present(self):
        companies = {obs.parsed_grading_company for obs in self.result.observations}
        assert "BGS" in companies

    def test_cgc_lot_present(self):
        companies = {obs.parsed_grading_company for obs in self.result.observations}
        assert "CGC" in companies

    def test_no_errors(self):
        assert self.result.errors == []

    def test_lot_ids_unique(self):
        lot_ids = [obs.lot_id for obs in self.result.observations]
        assert len(lot_ids) == len(set(lot_ids))

    def test_all_observations_have_price(self):
        for obs in self.result.observations:
            assert obs.realised_price_cents is not None
            assert obs.realised_price_cents > 0

    def test_all_observations_have_images(self):
        for obs in self.result.observations:
            assert len(obs.lot_image_urls) >= 1


class TestPwccFetcherLiveGated:
    def test_live_fetch_raises_without_env(self, monkeypatch):
        monkeypatch.delenv("AUCTIONS_LIVE", raising=False)
        fetcher = PwccFetcher()
        with pytest.raises(LiveModeDisabledError):
            fetcher.fetch_auction("test-auction-slug")
