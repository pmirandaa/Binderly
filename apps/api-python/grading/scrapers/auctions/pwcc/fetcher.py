"""PWCC Marketplace paginated archive fetcher.

Fetches closed lots from PWCC Marketplace auction archives in two modes:
  - Mock mode (default): iterates over the checked-in HTML fixtures.
  - Live mode (AUCTIONS_LIVE=1): paginates through the archive URL.

robots.txt posture (PWCC Marketplace, not yet verified live):
  Archived URL paths scraper accesses:
    /auctions/<slug>/lots?page=N   — lot listing pages (closed auctions only)
    /items/<lot-id>                — individual lot detail pages
  NEVER accessed:
    /auctions/live-*               — live bidding (excluded)
    /account/*                     — user account pages
    /cart/*                        — cart / checkout pages
    /admin/*                       — admin endpoints
  Request delay: ≥ 3 s between requests (configurable).
  User-Agent: Binderly-GradingDataPipeline/1.0 (grading-research; contact: data@binderly.app)

URL patterns:
  Archive index:  https://www.pwccmarketplace.com/auctions
  Lot list page:  https://www.pwccmarketplace.com/auctions/{slug}/lots?page={n}
  Lot detail:     https://www.pwccmarketplace.com/items/{lot_id}
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .._shared.http_client import AuctionHttpClient
from .._shared.types import AuctionLotObservation
from .parser import parse_lot_html

_FIXTURES_DIR = Path(__file__).parent / "fixtures"

_BASE_URL = "https://www.pwccmarketplace.com"


@dataclass
class PwccFetchResult:
    """Result from a PWCC archive fetch (mock or live)."""

    observations: list[AuctionLotObservation] = field(default_factory=list)
    skipped_raw: int = 0
    errors: list[str] = field(default_factory=list)


class PwccFetcher:
    """Fetches and parses PWCC auction archive lots.

    In mock mode (default), returns observations parsed from all fixture files
    in ``pwcc/fixtures/``.  In live mode (``AUCTIONS_LIVE=1``), paginates
    through the archive for the given ``auction_slug``.

    Usage::

        fetcher = PwccFetcher()

        # Mock mode (tests):
        result = fetcher.fetch_mock()

        # Live mode (AUCTIONS_LIVE=1 required):
        result = fetcher.fetch_auction("premium-auction-november-2024")
    """

    def __init__(
        self,
        *,
        client: Optional[AuctionHttpClient] = None,
        fixtures_dir: Optional[Path] = None,
    ) -> None:
        self._client = client or AuctionHttpClient()
        self._fixtures_dir = fixtures_dir or _FIXTURES_DIR

    def fetch_mock(self) -> PwccFetchResult:
        """Parse all HTML fixture files and return observations.

        Raw / ungraded fixture files are counted in ``skipped_raw`` and
        excluded from ``observations``.
        """
        result = PwccFetchResult()
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
        auction_slug: str,
        *,
        max_pages: int = 50,
    ) -> PwccFetchResult:
        """Fetch all closed lots for a given PWCC auction (live mode).

        Args:
            auction_slug: The auction slug from the PWCC URL, e.g.
                ``"premium-auction-november-2024"``.
            max_pages: Safety limit on pages to fetch (default 50 ≈ 4 800 lots).

        Raises:
            LiveModeDisabledError: when ``AUCTIONS_LIVE != "1"``.
        """
        from .._shared.http_client import LiveModeDisabledError  # noqa: PLC0415

        if not self._client.live_mode:
            raise LiveModeDisabledError(
                "AUCTIONS_LIVE is not set to '1'. "
                "fetch_auction() requires live mode."
            )
        result = PwccFetchResult()
        for page in range(1, max_pages + 1):
            url = f"{_BASE_URL}/auctions/{auction_slug}/lots?page={page}"
            try:
                listing_html = self._client.get(url)
            except Exception as exc:
                result.errors.append(f"page {page}: {exc}")
                break

            lot_ids = _extract_lot_ids_from_listing(listing_html)
            if not lot_ids:
                break

            for lot_id in lot_ids:
                lot_url = f"{_BASE_URL}/items/{lot_id}"
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
    """Extract lot IDs from a PWCC auction lot-listing page.

    In the live site, lot IDs appear as ``data-lot-id`` attributes on
    item cards.  Returns an empty list when no lots are found (signals
    end of pagination).
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    ids: list[str] = []
    for tag in soup.find_all(attrs={"data-lot-id": True}):
        lot_id = tag.get("data-lot-id")
        if lot_id:
            ids.append(str(lot_id).strip())
    return ids
