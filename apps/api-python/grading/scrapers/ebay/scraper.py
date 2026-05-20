"""Main eBay graded-slab scraper orchestrator.

:class:`EbayScraper` drives the full pipeline:
  1. Build a matrix of ``(company, grade_tier)`` queries.
  2. For each query, paginate through the Finding API up to ``max_pages``.
  3. For each item, extract fields → parse title → emit
     :class:`~types.EbayGradedListingObservation`.
  4. Deduplicate by ``listing_id`` within a single run (cross-run dedup is
     handled by the ``UNIQUE(listing_id)`` constraint on the DB table).

Mock-by-default: pass ``client=MockFindingClient(...)`` or let
:func:`~client.build_client` pick the right implementation based on
``EBAY_GRADING_LIVE``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Generator, Union

from .client import (
    EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID,
    FindingClient,
    MockFindingClient,
    build_client,
    extract_item_fields,
    extract_items,
    extract_pagination,
)
from .parser import parse_title
from .types import PARSER_VERSION, EbayGradedListingObservation

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default query matrix
# ---------------------------------------------------------------------------

#: Companies × grade tiers that the scraper queries by default.
DEFAULT_QUERIES: list[str] = [
    "PSA 10",
    "PSA 9",
    "BGS 9.5",
    "BGS 9",
    "CGC 10",
    "CGC 9",
    "SGC 10",
    "SGC 9",
]

#: Conservative page cap per query — 10 pages × 100 = 1 000 listings.
DEFAULT_MAX_PAGES: int = 10


# ---------------------------------------------------------------------------
# Config dataclass
# ---------------------------------------------------------------------------


class ScrapeConfig:
    """Configuration for a single :class:`EbayScraper` run.

    Parameters
    ----------
    queries:
        List of keyword strings to search.  Defaults to
        :data:`DEFAULT_QUERIES`.
    category_id:
        eBay category ID.  Defaults to the Pokémon Individual Cards category.
    max_pages:
        Maximum pages to paginate per query.
    entries_per_page:
        Number of results per page (max 100 per eBay's API).
    """

    def __init__(
        self,
        queries: list[str] | None = None,
        category_id: str = EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID,
        max_pages: int = DEFAULT_MAX_PAGES,
        entries_per_page: int = 100,
    ) -> None:
        self.queries = queries if queries is not None else list(DEFAULT_QUERIES)
        self.category_id = category_id
        self.max_pages = max_pages
        self.entries_per_page = min(entries_per_page, 100)


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------


class EbayScraper:
    """Fetches completed eBay listings and yields structured observations.

    Parameters
    ----------
    client:
        A :class:`~client.FindingClient` or :class:`~client.MockFindingClient`.
        When omitted, :func:`~client.build_client` is called to pick the right
        implementation based on ``EBAY_GRADING_LIVE``.
    config:
        Scrape configuration.  Defaults to :class:`ScrapeConfig`.
    """

    def __init__(
        self,
        client: Union[FindingClient, MockFindingClient, None] = None,
        config: ScrapeConfig | None = None,
    ) -> None:
        self._client = client or build_client()
        self._config = config or ScrapeConfig()

    def scrape(self) -> Generator[EbayGradedListingObservation, None, None]:
        """Yield observations for all configured queries.

        Deduplicates by ``listing_id`` within this run.  The same listing
        appearing in multiple query results (e.g. "PSA 10" and "PSA 10
        Charizard") is emitted only once.
        """
        seen_listing_ids: set[str] = set()
        for query in self._config.queries:
            log.info("ebay-graded-scraper: querying %r (category %s)", query, self._config.category_id)
            yield from self._scrape_query(query, seen_listing_ids)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _scrape_query(
        self,
        query: str,
        seen_listing_ids: set[str],
    ) -> Generator[EbayGradedListingObservation, None, None]:
        fetched_at = datetime.now(tz=timezone.utc)
        for page in range(1, self._config.max_pages + 1):
            response = self._client.find_completed_items(
                keywords=query,
                category_id=self._config.category_id,
                page_number=page,
                entries_per_page=self._config.entries_per_page,
            )
            items = extract_items(response)
            pagination = extract_pagination(response)

            log.debug(
                "ebay-graded-scraper: query=%r page=%d items=%d total_pages=%d",
                query,
                page,
                len(items),
                pagination["total_pages"],
            )

            for raw_item in items:
                obs = self._build_observation(raw_item, fetched_at)
                if obs is None:
                    continue
                if obs.listing_id in seen_listing_ids:
                    log.debug(
                        "ebay-graded-scraper: dedup listing_id=%s", obs.listing_id
                    )
                    continue
                seen_listing_ids.add(obs.listing_id)
                yield obs

            if page >= pagination["total_pages"]:
                break

    def _build_observation(
        self,
        raw_item: dict[str, Any],
        fetched_at: datetime,
    ) -> EbayGradedListingObservation | None:
        fields = extract_item_fields(raw_item)

        listing_id = fields.get("item_id")
        title = fields.get("title")
        if not listing_id or not title:
            log.warning("ebay-graded-scraper: skipping item with missing id/title: %r", fields)
            return None

        price_str = fields.get("price_value")
        currency = fields.get("price_currency") or "USD"
        final_price_cents = _parse_price_cents(price_str, currency)
        if final_price_cents is None:
            log.warning(
                "ebay-graded-scraper: skipping listing %s — unparseable price %r",
                listing_id,
                price_str,
            )
            return None

        sold_at = _parse_datetime(fields.get("end_time"))
        parsed = parse_title(title)

        return EbayGradedListingObservation(
            listing_id=listing_id,
            title=title,
            parsed_grading_company=parsed.grading_company,
            parsed_overall_grade=parsed.overall_grade,
            parsed_sub_grades=parsed.sub_grades,
            final_price_cents=final_price_cents,
            currency_code=currency,
            sold_at=sold_at,
            thumbnail_url=fields.get("gallery_url"),
            raw_blob_json=raw_item,
            parser_version=PARSER_VERSION,
            fetched_at=fetched_at,
            parse_confidence=parsed.parse_confidence,
        )


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------


def _parse_price_cents(price_str: str | None, currency: str) -> int | None:
    """Convert a price string and currency to integer cents.

    For JPY (and other zero-decimal currencies) 1 yen = 1 unit, so we
    round to the nearest integer without multiplying by 100.

    Returns None when the price string is missing or unparseable.
    """
    if price_str is None:
        return None
    try:
        amount = Decimal(price_str)
    except InvalidOperation:
        return None
    if currency in _ZERO_DECIMAL_CURRENCIES:
        return int(amount.to_integral_value())
    return int((amount * 100).to_integral_value())


# ISO 4217 zero-decimal currencies (1 unit = 1 smallest unit).
_ZERO_DECIMAL_CURRENCIES: frozenset[str] = frozenset(
    {"JPY", "KRW", "VND", "IDR", "CLP", "GNF", "ISK", "MGA", "PYG", "RWF", "UGX", "XAF", "XOF"}
)


def _parse_datetime(dt_str: str | None) -> datetime | None:
    """Parse an ISO-8601 datetime string from the Finding API into UTC."""
    if not dt_str:
        return None
    # eBay returns timestamps like "2026-05-20T10:00:00.000Z"
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            dt = datetime.strptime(dt_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        log.debug("ebay-graded-scraper: unparseable datetime %r", dt_str)
        return None
