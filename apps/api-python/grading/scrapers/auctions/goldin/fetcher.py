"""Goldin Auctions paginated archive fetcher.

Fetches closed lots from Goldin Auctions archives in two modes:
  - Mock mode (default): iterates over the checked-in HTML fixtures.
  - Live mode (AUCTIONS_LIVE=1): paginates through the archive.

robots.txt posture (Goldin Auctions, not yet verified live):
  Archived URL paths scraper accesses:
    /lot-list/?auctionid=<id>&page=N  — lot listing pages (past auctions only)
    /lot/<year>/<slug>/<lot-id>/       — individual lot detail pages
  NEVER accessed:
    /bid/*                             — live bidding pages
    /account/*                         — user account pages
    /checkout/*                        — checkout pages
  Request delay: ≥ 3 s between requests (configurable).
  User-Agent: Binderly-GradingDataPipeline/1.0 (grading-research; contact: data@binderly.app)

URL patterns:
  Past auctions:  https://goldinauctions.com/past-auctions/
  Lot list:       https://goldinauctions.com/lot-list/?auctionid={id}&page={n}
  Lot detail:     https://goldinauctions.com/lot/{year}/{auction-slug}/{lot-id}/
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .._shared.http_client import AuctionHttpClient
from .._shared.types import AuctionLotObservation
from .parser import parse_lot_html

_FIXTURES_DIR = Path(__file__).parent / "fixtures"

_BASE_URL = "https://goldinauctions.com"


@dataclass
class GoldinFetchResult:
    """Result from a Goldin archive fetch (mock or live)."""

    observations: list[AuctionLotObservation] = field(default_factory=list)
    skipped_raw: int = 0
    errors: list[str] = field(default_factory=list)


class GoldinFetcher:
    """Fetches and parses Goldin Auctions archive lots.

    In mock mode (default), returns observations parsed from all fixture files
    in ``goldin/fixtures/``.  In live mode (``AUCTIONS_LIVE=1``), paginates
    through the past-auction archive for the given auction ID.

    Usage::

        fetcher = GoldinFetcher()

        # Mock mode (tests):
        result = fetcher.fetch_mock()

        # Live mode (AUCTIONS_LIVE=1 required):
        result = fetcher.fetch_auction(auction_id="1234", year="2024",
                                       auction_slug="spring-2024")
    """

    def __init__(
        self,
        *,
        client: Optional[AuctionHttpClient] = None,
        fixtures_dir: Optional[Path] = None,
    ) -> None:
        self._client = client or AuctionHttpClient()
        self._fixtures_dir = fixtures_dir or _FIXTURES_DIR

    def fetch_mock(self) -> GoldinFetchResult:
        """Parse all HTML fixture files and return observations.

        Raw / ungraded fixture files are counted in ``skipped_raw`` and
        excluded from ``observations``.
        """
        result = GoldinFetchResult()
        for html_path in sorted(self._fixtures_dir.glob("*.html")):
            try:
                html = html_path.read_bytes()
                obs = parse_lot_html(html, source_url=str(html_path))
                if obs is None:
                    result.skipped_raw += 1
                else:
                    result.observations.append(obs)
            except Exception as exc:
                result.errors.append(f"{html_path.name}: {exc}")
        return result

    def fetch_auction(
        self,
        *,
        auction_id: str,
        year: str,
        auction_slug: str,
        max_pages: int = 50,
    ) -> GoldinFetchResult:
        """Fetch all closed lots for a given Goldin auction (live mode).

        Args:
            auction_id: Numeric auction ID used in the lot-list URL parameter.
            year: Four-digit year string, e.g. ``"2024"``.
            auction_slug: Auction slug for lot detail URLs, e.g.
                ``"spring-2024"``.
            max_pages: Safety limit on pages to fetch (default 50).

        Raises:
            LiveModeDisabledError: when ``AUCTIONS_LIVE != "1"``.
        """
        from .._shared.http_client import LiveModeDisabledError  # noqa: PLC0415

        if not self._client.live_mode:
            raise LiveModeDisabledError(
                "AUCTIONS_LIVE is not set to '1'. "
                "fetch_auction() requires live mode."
            )
        result = GoldinFetchResult()
        for page in range(1, max_pages + 1):
            url = f"{_BASE_URL}/lot-list/?auctionid={auction_id}&page={page}"
            try:
                listing_html = self._client.get(url)
            except Exception as exc:
                result.errors.append(f"page {page}: {exc}")
                break

            lot_ids = _extract_lot_ids_from_listing(listing_html)
            if not lot_ids:
                break

            for lot_id in lot_ids:
                lot_url = f"{_BASE_URL}/lot/{year}/{auction_slug}/{lot_id}/"
                try:
                    lot_html = self._client.get(lot_url)
                    obs = parse_lot_html(lot_html, source_url=lot_url)
                    if obs is None:
                        result.skipped_raw += 1
                    else:
                        result.observations.append(obs)
                except Exception as exc:
                    result.errors.append(f"{lot_id}: {exc}")

        return result


def _extract_lot_ids_from_listing(html: bytes) -> list[str]:
    """Extract lot IDs from a Goldin lot-listing page.

    Lot IDs appear as ``data-lot-id`` attributes on item containers.
    Returns an empty list when no lots are found (signals end of pagination).
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    ids: list[str] = []
    for tag in soup.find_all(attrs={"data-lot-id": True}):
        lot_id = tag.get("data-lot-id")
        if lot_id:
            ids.append(str(lot_id).strip())
    return ids
