"""Goldin Auctions lot-page HTML parser.

Parses a single closed-lot detail page from Goldin Auctions into an
``AuctionLotObservation``.

Goldin lot page structure (as of 2024 / synthetic fixture):

    <div class="lot-detail" data-lot-id="goldin-NNNNNNN">
      <div class="lot-header">
        <h1 class="lot-title">...</h1>
      </div>
      <div class="auction-meta">
        <span class="auction-id-val">...</span>
        <span class="auction-name-val">...</span>
      </div>
      <div class="lot-price-section">
        <div class="hammer-price">
          <span class="price-value">$N,NNN.NN</span>
        </div>
        <div class="buyers-premium-section">
          <span class="premium-value">$N,NNN.NN</span>
        </div>
      </div>
      <div class="close-time-section">
        <time class="lot-close-time" datetime="ISO8601">...</time>
      </div>
      <div class="lot-image-gallery">
        <img class="gallery-image" src="..." ...>
      </div>
    </div>

Returns ``None`` for lots that cannot be identified as graded slabs
(raw / ungraded cards are excluded).

robots.txt posture (Goldin Auctions, not yet verified live):
  Fetched paths: /lot/<year>/<slug>/<lot-id>/ (closed lot detail pages)
  NOT fetched: /bid/* (live bidding), /account/*, /checkout/*
  Status: not yet verified live (sandbox blocks network).
  All fetches are from the closed-lot archive only.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup

from .._shared.currency import parse_price
from .._shared.grade_parser import parse_lot_title
from .._shared.types import AuctionLotObservation

AUCTION_HOUSE = "goldin"
PARSER_VERSION = "1.0.0"


def parse_lot_html(
    html: bytes,
    *,
    source_url: Optional[str] = None,
    fetched_at: Optional[datetime] = None,
) -> Optional[AuctionLotObservation]:
    """Parse a Goldin lot detail page and return an observation, or None.

    Returns None when:
    - The lot title does not match a graded slab (raw / ungraded card).
    - Required fields (lot_id, lot_title) are absent from the page.

    Args:
        html: Raw HTML bytes of the lot detail page.
        source_url: Optional URL the page was fetched from (for provenance).
        fetched_at: Optional fetch timestamp; defaults to utcnow().

    Returns:
        ``AuctionLotObservation`` or ``None``.
    """
    if fetched_at is None:
        fetched_at = datetime.now(tz=timezone.utc)

    raw_sha256 = hashlib.sha256(html).hexdigest()
    soup = BeautifulSoup(html, "lxml")

    # --- lot_id ---
    lot_div = soup.find("div", class_="lot-detail")
    if lot_div is None:
        return None
    lot_id = lot_div.get("data-lot-id")  # type: ignore[union-attr]
    if not lot_id:
        return None
    lot_id = str(lot_id).strip()

    # --- lot_title ---
    title_tag = soup.find("h1", class_="lot-title")
    if title_tag is None:
        return None
    lot_title = title_tag.get_text(strip=True)
    if not lot_title:
        return None

    # --- grade parsing (exclude raw / ungraded lots) ---
    grading_company, overall_grade, sub_grades = parse_lot_title(lot_title)
    if grading_company == "unknown":
        return None

    # --- auction metadata ---
    auction_id: Optional[str] = None
    auction_name: Optional[str] = None
    meta_div = soup.find("div", class_="auction-meta")
    if meta_div:
        aid_tag = meta_div.find("span", class_="auction-id-val")  # type: ignore[union-attr]
        if aid_tag:
            auction_id = aid_tag.get_text(strip=True) or None
        aname_tag = meta_div.find("span", class_="auction-name-val")  # type: ignore[union-attr]
        if aname_tag:
            auction_name = aname_tag.get_text(strip=True) or None

    # --- realised price (hammer) ---
    realised_price_cents: Optional[int] = None
    currency_code: Optional[str] = None
    price_span = soup.find("span", class_="price-value")
    if price_span:
        price_text = price_span.get_text(strip=True)
        realised_price_cents, currency_code = parse_price(price_text)

    # --- buyer's premium ---
    realised_premium_cents: Optional[int] = None
    premium_span = soup.find("span", class_="premium-value")
    if premium_span:
        premium_text = premium_span.get_text(strip=True)
        realised_premium_cents, _ = parse_price(premium_text)

    # --- close date ---
    closed_at: Optional[datetime] = None
    time_tag = soup.find("time", class_="lot-close-time")
    if time_tag:
        dt_attr = time_tag.get("datetime")  # type: ignore[union-attr]
        if dt_attr:
            try:
                closed_at = datetime.fromisoformat(str(dt_attr).replace("Z", "+00:00"))
            except ValueError:
                closed_at = None

    # --- images ---
    lot_image_urls: list[str] = []
    for img in soup.find_all("img", class_="gallery-image"):
        src = img.get("src")
        if src:
            lot_image_urls.append(str(src))

    return AuctionLotObservation(
        lot_id=lot_id,
        auction_house=AUCTION_HOUSE,
        lot_title=lot_title,
        auction_id=auction_id,
        auction_name=auction_name,
        parsed_grading_company=grading_company,
        parsed_overall_grade=overall_grade,
        parsed_sub_grades=sub_grades,
        realised_price_cents=realised_price_cents,
        currency_code=currency_code,
        realised_premium_cents=realised_premium_cents,
        closed_at=closed_at,
        lot_image_urls=lot_image_urls,
        raw_html_sha256=raw_sha256,
        parser_version=PARSER_VERSION,
        fetched_at=fetched_at,
    )


def parse_lot_file(path: Path) -> Optional[AuctionLotObservation]:
    """Convenience wrapper: parse a fixture file on disk."""
    return parse_lot_html(path.read_bytes(), source_url=str(path))
