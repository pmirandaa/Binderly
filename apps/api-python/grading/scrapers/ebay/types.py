"""Pydantic models for eBay graded-slab listing observations.

These types are the canonical in-memory representation produced by the
scraper pipeline.  They map 1-to-1 onto the ``ebay_graded_listing_observation``
DB table columns and onto the ``grading_training_sample`` upsert payload.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

# Increment when the regex logic in ``parser.py`` changes so stale DB rows
# can be identified and re-parsed without re-fetching from eBay.
PARSER_VERSION: str = "1"

# Valid grading companies — mirrors the CHECK constraint on both DB tables.
GRADING_COMPANIES = frozenset({"PSA", "BGS", "CGC", "SGC", "OTHER"})


class ParsedSlabTitle(BaseModel):
    """Output of ``parser.parse_title(title)``."""

    grading_company: str
    """PSA | BGS | CGC | SGC | OTHER"""

    overall_grade: Optional[Decimal] = None
    """Numeric grade 1.0–10.0, or None for Authentic / unparseable."""

    grade_str: str
    """Raw grade token extracted from the title (e.g. ``'10'``, ``'9.5'``,
    ``'Auth'``).  Empty string when no grade token was found."""

    sub_grades: Optional[dict[str, float]] = None
    """BGS sub-grades only: ``{centering, corners, edges, surface}``.
    None for all other companies."""

    parse_confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    """0.0–1.0 confidence score for the parse.  Degrades when the grade
    token is not adjacent to the company abbreviation, or when no company
    was matched (→ 0.5)."""


class EbayGradedListingObservation(BaseModel):
    """One row of ``ebay_graded_listing_observation``.

    Produced by the scraper for every completed eBay listing that passes
    the graded-slab filter (i.e., the title contains a grading company
    abbreviation or no company filter was applied).
    """

    listing_id: str
    """eBay item ID (globally unique within a marketplace)."""

    title: str
    """Raw eBay listing title."""

    parsed_grading_company: str
    """PSA | BGS | CGC | SGC | OTHER"""

    parsed_overall_grade: Optional[Decimal] = None
    """1.0–10.0 or None."""

    parsed_sub_grades: Optional[dict[str, float]] = None
    """BGS sub-grades: {centering, corners, edges, surface}."""

    final_price_cents: int
    """Sale price in smallest currency unit (cents for USD/GBP/EUR; yen for JPY)."""

    currency_code: str
    """ISO 4217 currency code (e.g. ``'USD'``, ``'GBP'``)."""

    sold_at: Optional[datetime] = None
    """Listing end time (UTC).  None when absent from the API response."""

    thumbnail_url: Optional[str] = None
    """eBay hosted gallery image URL.  NOT proxied or downloaded."""

    raw_blob_json: dict
    """Full eBay Finding API item dict.  Preserved for regex re-parsing."""

    parser_version: str = PARSER_VERSION
    """Parser version string — increment when regex changes."""

    fetched_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))
    """Wall-clock UTC timestamp when this observation was produced."""

    parse_confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    """Confidence of the title parse.  Forwarded to ``grading_training_sample.parse_confidence``."""
