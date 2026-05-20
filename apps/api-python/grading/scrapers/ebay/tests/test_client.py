"""Tests for ``grading.scrapers.ebay.client``.

Tests cover:
- ``MockFindingClient`` round-trip (fixture loading)
- ``MockFindingClient`` call-count tracking
- ``MockFindingClient`` round-robin pagination
- ``build_client`` returns mock when ``EBAY_GRADING_LIVE`` is unset
- ``extract_items`` returns list from fixture response
- ``extract_pagination`` returns correct totals
- ``extract_item_fields`` flattens item correctly
- ``EBAY_GRADING_LIVE`` guard — no real HTTP call in CI
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from grading.scrapers.ebay.client import (
    MockFindingClient,
    build_client,
    extract_item_fields,
    extract_items,
    extract_pagination,
)

# ---------------------------------------------------------------------------
# Fixture directory
# ---------------------------------------------------------------------------

FIXTURES_DIR: Path = Path(__file__).parent.parent / "fixtures"


class TestMockFindingClient:
    def test_loads_all_fixtures(self) -> None:
        client = MockFindingClient(fixtures_dir=FIXTURES_DIR)
        # Should have loaded all .json files without error
        response = client.find_completed_items(keywords="PSA 10")
        assert isinstance(response, dict)
        assert "findCompletedItemsResponse" in response

    def test_call_count_increments(self) -> None:
        client = MockFindingClient(fixtures_dir=FIXTURES_DIR)
        assert client.call_count == 0
        client.find_completed_items(keywords="PSA 10")
        assert client.call_count == 1
        client.find_completed_items(keywords="BGS 9.5")
        assert client.call_count == 2

    def test_round_robin_pagination(self) -> None:
        client = MockFindingClient(
            fixture_names=["psa_10_charizard", "bgs_9_5_venusaur"],
            fixtures_dir=FIXTURES_DIR,
        )
        r1 = client.find_completed_items(keywords="PSA 10", page_number=1)
        r2 = client.find_completed_items(keywords="BGS 9.5", page_number=2)
        r3 = client.find_completed_items(keywords="PSA 10", page_number=3)
        # Third call wraps around to first fixture
        assert r1 == r3
        assert r1 != r2

    def test_specific_fixture_names(self) -> None:
        client = MockFindingClient(
            fixture_names=["psa_10_charizard"],
            fixtures_dir=FIXTURES_DIR,
        )
        response = client.find_completed_items(keywords="PSA 10")
        items = extract_items(response)
        assert len(items) == 2  # psa_10_charizard has 2 items

    def test_missing_fixture_raises(self) -> None:
        with pytest.raises(FileNotFoundError):
            MockFindingClient(
                fixture_names=["nonexistent_fixture"],
                fixtures_dir=FIXTURES_DIR,
            )

    def test_empty_fixtures_dir_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            MockFindingClient(fixtures_dir=tmp_path)


class TestBuildClient:
    def test_returns_mock_when_not_live(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("EBAY_GRADING_LIVE", raising=False)
        client = build_client(fixtures_dir=FIXTURES_DIR)
        assert isinstance(client, MockFindingClient)

    def test_no_real_http_call_in_mock_mode(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("EBAY_GRADING_LIVE", raising=False)
        client = build_client(fixtures_dir=FIXTURES_DIR)
        # Calling find_completed_items must not raise (no network needed)
        response = client.find_completed_items(keywords="PSA 10")
        assert "findCompletedItemsResponse" in response


class TestExtractItems:
    def test_extracts_items_from_psa_fixture(self) -> None:
        fixture_path = FIXTURES_DIR / "psa_10_charizard.json"
        with open(fixture_path) as fh:
            response = json.load(fh)
        items = extract_items(response)
        assert len(items) == 2
        assert items[0]["itemId"][0] == "371234567890"

    def test_empty_result_returns_empty_list(self) -> None:
        empty_response = {
            "findCompletedItemsResponse": [
                {
                    "ack": ["Success"],
                    "searchResult": [{"@count": "0"}],
                }
            ]
        }
        assert extract_items(empty_response) == []

    def test_malformed_response_returns_empty_list(self) -> None:
        assert extract_items({}) == []
        assert extract_items({"bad": "structure"}) == []


class TestExtractPagination:
    def test_extracts_pagination_from_fixture(self) -> None:
        fixture_path = FIXTURES_DIR / "psa_10_charizard.json"
        with open(fixture_path) as fh:
            response = json.load(fh)
        pag = extract_pagination(response)
        assert pag["total_entries"] == 2
        assert pag["total_pages"] == 1
        assert pag["page_number"] == 1

    def test_defaults_on_malformed(self) -> None:
        pag = extract_pagination({})
        assert pag["total_pages"] == 1
        assert pag["total_entries"] == 0


class TestExtractItemFields:
    def test_extracts_psa_item_fields(self) -> None:
        fixture_path = FIXTURES_DIR / "psa_10_charizard.json"
        with open(fixture_path) as fh:
            response = json.load(fh)
        item = extract_items(response)[0]
        fields = extract_item_fields(item)
        assert fields["item_id"] == "371234567890"
        assert "PSA 10" in fields["title"]
        assert fields["price_value"] == "2999.00"
        assert fields["price_currency"] == "USD"
        assert fields["end_time"] == "2026-05-20T10:00:00.000Z"
        assert fields["gallery_url"] is not None

    def test_extracts_gbp_item_fields(self) -> None:
        fixture_path = FIXTURES_DIR / "gbp_currency.json"
        with open(fixture_path) as fh:
            response = json.load(fh)
        item = extract_items(response)[0]
        fields = extract_item_fields(item)
        assert fields["price_currency"] == "GBP"
        assert fields["price_value"] == "320.00"
