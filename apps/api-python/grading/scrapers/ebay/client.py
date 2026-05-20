"""eBay Finding API client — ``findCompletedItems``.

Wraps ``httpx.AsyncClient`` (or synchronous fallback for simple callers) to
call the eBay Legacy Finding Service and return the parsed JSON payload.

Mock-by-default: when ``EBAY_GRADING_LIVE`` is unset the ``MockFindingClient``
is used, which returns pre-loaded fixture JSON files in round-robin order so
multi-page pagination can be exercised without any network traffic.

References
----------
* Finding API docs: https://developer.ebay.com/api-docs/find/overview.html
* ``findCompletedItems``:
  https://developer.ebay.com/DevZone/finding/CallRef/findCompletedItems.html
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx

from .oauth import get_app_id, is_live_mode

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FINDING_API_ENDPOINT = "https://svcs.ebay.com/services/search/FindingService/v1"

FINDING_API_SERVICE_VERSION = "1.13.0"

#: Category ID for Pokémon Individual Cards in eBay's taxonomy.
EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID = "183454"

#: Maximum per-page results the Finding API accepts.
FINDING_API_MAX_ENTRIES_PER_PAGE = 100

#: Directory that holds fixture JSON files (relative to this file).
FIXTURES_DIR: Path = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Synchronous live client
# ---------------------------------------------------------------------------


class FindingClient:
    """Thin httpx wrapper for ``findCompletedItems``.

    Only instantiated when ``EBAY_GRADING_LIVE=1``; normal CI/test paths use
    :class:`MockFindingClient`.
    """

    def __init__(
        self,
        app_id: str | None = None,
        endpoint: str = FINDING_API_ENDPOINT,
        timeout: float = 30.0,
    ) -> None:
        self._app_id = app_id or get_app_id()
        self._endpoint = endpoint
        self._timeout = timeout

    def find_completed_items(
        self,
        keywords: str,
        category_id: str = EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID,
        page_number: int = 1,
        entries_per_page: int = FINDING_API_MAX_ENTRIES_PER_PAGE,
    ) -> dict[str, Any]:
        """Call ``findCompletedItems`` and return the raw JSON dict.

        Parameters
        ----------
        keywords:
            Free-text search query, e.g. ``"PSA 10"``.
        category_id:
            eBay category ID to scope results.
        page_number:
            1-indexed page number.
        entries_per_page:
            Number of results per page (max 100).

        Returns
        -------
        dict
            Raw JSON response from the Finding API.

        Raises
        ------
        httpx.HTTPStatusError
            On 4xx/5xx responses.
        ValueError
            When the response body is not valid JSON.
        """
        params = _build_params(
            app_id=self._app_id,
            keywords=keywords,
            category_id=category_id,
            page_number=page_number,
            entries_per_page=entries_per_page,
        )
        with httpx.Client(timeout=self._timeout) as http:
            response = http.get(self._endpoint, params=params)
            response.raise_for_status()
            try:
                return response.json()
            except Exception as exc:
                raise ValueError(
                    f"FindingClient: response is not valid JSON: {exc}"
                ) from exc


# ---------------------------------------------------------------------------
# Mock client — fixture-backed, no network
# ---------------------------------------------------------------------------


class MockFindingClient:
    """Returns pre-loaded fixture JSON files in round-robin order.

    Designed for CI and unit tests.  When ``page_number > len(fixtures)``,
    it wraps around so pagination loops can be tested without extra fixtures.

    Parameters
    ----------
    fixture_names:
        List of fixture file stems (without ``.json``) to load.  Defaults to
        all ``.json`` files in the ``fixtures/`` directory, sorted alphabetically.
    fixtures_dir:
        Override the directory containing fixture files.  Defaults to the
        package-level ``fixtures/`` directory.
    """

    def __init__(
        self,
        fixture_names: list[str] | None = None,
        fixtures_dir: Path | None = None,
    ) -> None:
        fixtures_dir = fixtures_dir or FIXTURES_DIR
        if fixture_names is None:
            paths = sorted(fixtures_dir.glob("*.json"))
        else:
            paths = [fixtures_dir / f"{name}.json" for name in fixture_names]
        if not paths:
            raise FileNotFoundError(
                f"MockFindingClient: no fixture JSON files found in {fixtures_dir}"
            )
        self._fixtures: list[dict[str, Any]] = []
        for p in paths:
            with open(p) as fh:
                self._fixtures.append(json.load(fh))
        self._call_count = 0

    def find_completed_items(
        self,
        keywords: str,  # noqa: ARG002 — unused in mock, present to match interface
        category_id: str = EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID,  # noqa: ARG002
        page_number: int = 1,
        entries_per_page: int = FINDING_API_MAX_ENTRIES_PER_PAGE,  # noqa: ARG002
    ) -> dict[str, Any]:
        """Return the next fixture in round-robin order."""
        idx = self._call_count % len(self._fixtures)
        self._call_count += 1
        return self._fixtures[idx]

    @property
    def call_count(self) -> int:
        """Total number of ``find_completed_items`` calls made."""
        return self._call_count


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_client(
    app_id: str | None = None,
    mock_fixture_names: list[str] | None = None,
    fixtures_dir: Path | None = None,
) -> FindingClient | MockFindingClient:
    """Return a live or mock client depending on ``EBAY_GRADING_LIVE``.

    Parameters
    ----------
    app_id:
        Override the eBay App ID (live mode only; ignored when mock).
    mock_fixture_names:
        If provided, the mock client is loaded with these specific fixtures.
    fixtures_dir:
        Override the fixture directory for mock mode.
    """
    if is_live_mode():
        return FindingClient(app_id=app_id)
    return MockFindingClient(
        fixture_names=mock_fixture_names,
        fixtures_dir=fixtures_dir,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_params(
    app_id: str,
    keywords: str,
    category_id: str,
    page_number: int,
    entries_per_page: int,
) -> dict[str, str]:
    return {
        "OPERATION-NAME": "findCompletedItems",
        "SERVICE-VERSION": FINDING_API_SERVICE_VERSION,
        "SECURITY-APPNAME": app_id,
        "RESPONSE-DATA-FORMAT": "JSON",
        "keywords": keywords,
        "categoryId": category_id,
        "itemFilter(0).name": "SoldItemsOnly",
        "itemFilter(0).value": "true",
        "paginationInput.entriesPerPage": str(entries_per_page),
        "paginationInput.pageNumber": str(page_number),
    }


# ---------------------------------------------------------------------------
# Response-parsing helpers
# ---------------------------------------------------------------------------


def extract_items(response: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract the list of item dicts from a Finding API response.

    Returns an empty list on zero-result pages or malformed responses.
    """
    try:
        root = response["findCompletedItemsResponse"][0]
        search_result = root.get("searchResult", [{}])[0]
        return search_result.get("item", [])
    except (KeyError, IndexError, TypeError):
        return []


def extract_pagination(response: dict[str, Any]) -> dict[str, int]:
    """Return ``{total_entries, total_pages, entries_per_page, page_number}``."""
    try:
        root = response["findCompletedItemsResponse"][0]
        pag = root.get("paginationOutput", [{}])[0]
        return {
            "total_entries": int(pag.get("totalEntries", ["0"])[0]),
            "total_pages": int(pag.get("totalPages", ["1"])[0]),
            "entries_per_page": int(pag.get("entriesPerPage", ["100"])[0]),
            "page_number": int(pag.get("pageNumber", ["1"])[0]),
        }
    except (KeyError, IndexError, TypeError, ValueError):
        return {"total_entries": 0, "total_pages": 1, "entries_per_page": 100, "page_number": 1}


def extract_item_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Flatten an eBay Finding API item dict into a canonical key-value dict.

    Returns
    -------
    dict with keys:
        ``item_id``, ``title``, ``gallery_url``, ``price_value``,
        ``price_currency``, ``end_time``.
    Missing fields are set to ``None``.
    """
    def _first(obj: Any, *keys: str) -> Any:
        """Navigate a nested dict/list path, returning None on failure."""
        for key in keys:
            if obj is None:
                return None
            if isinstance(obj, list):
                obj = obj[0] if obj else None
            if isinstance(obj, dict):
                obj = obj.get(key)
            else:
                return None
        if isinstance(obj, list):
            obj = obj[0] if obj else None
        return obj

    return {
        "item_id": _first(item, "itemId"),
        "title": _first(item, "title"),
        "gallery_url": _first(item, "galleryURL"),
        "price_value": _first(item, "sellingStatus", "currentPrice", "__value__"),
        "price_currency": _first(item, "sellingStatus", "currentPrice", "@currencyId"),
        "end_time": _first(item, "listingInfo", "endTime"),
    }
