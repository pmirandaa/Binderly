"""Currency and price parsing utilities for auction scrapers.

Auction sites display prices in various formats:
    "$1,234.56"   → (123456, "USD")
    "$12,500"     → (1250000, "USD")
    "£500.00"     → (50000, "GBP")
    "CAD$1,200"   → (120000, "CAD")
    "1,234.56 USD"→ (123456, "USD")

Strategy:
1. Detect currency from a leading symbol or trailing/prefix ISO code.
2. Strip thousands separators and parse the decimal value.
3. Convert to cents (integer, smallest currency unit) by multiplying by
   100 and rounding.

Only USD and GBP are expected in practice for PWCC / Goldin; the parser
handles a wider set so the same utility can be re-used across scrapers.
"""

from __future__ import annotations

import re
from typing import Optional


# ---------------------------------------------------------------------------
# Currency symbol / prefix → ISO 4217 code
# ---------------------------------------------------------------------------

_SYMBOL_MAP: dict[str, str] = {
    "$": "USD",
    "£": "GBP",
    "€": "EUR",
    "¥": "JPY",
    "A$": "AUD",
    "CA$": "CAD",
    "CAD$": "CAD",
    "CAD": "CAD",
    "USD": "USD",
    "GBP": "GBP",
    "EUR": "EUR",
}

# Pattern: optional currency prefix, then numeric value, optional trailing code
_PRICE_RE = re.compile(
    r"(?P<prefix>CAD\$|CA\$|A\$|USD|GBP|EUR|CAD)?"
    r"\s*(?P<symbol>[£€¥\$])?"
    r"\s*(?P<amount>[\d,]+(?:\.\d{1,2})?)"
    r"\s*(?P<suffix>USD|GBP|EUR|CAD|AUD)?",
    re.IGNORECASE,
)


def parse_price(raw: str) -> tuple[Optional[int], Optional[str]]:
    """Parse a price string into (cents, currency_code).

    Returns (None, None) if the string cannot be parsed.

    Args:
        raw: Raw price string from the auction lot page, e.g. ``"$1,234.56"``.

    Returns:
        Tuple of (price_in_cents: int | None, currency_code: str | None).
        ``price_in_cents`` is rounded to the nearest cent.
    """
    if not raw or not raw.strip():
        return (None, None)

    cleaned = raw.strip()
    m = _PRICE_RE.search(cleaned)
    if m is None:
        return (None, None)

    # Determine currency code
    prefix = (m.group("prefix") or "").upper().replace(" ", "")
    symbol = m.group("symbol") or ""
    suffix = (m.group("suffix") or "").upper()

    currency: Optional[str] = None
    if prefix:
        currency = _SYMBOL_MAP.get(prefix)
    if currency is None and symbol:
        currency = _SYMBOL_MAP.get(symbol)
    if currency is None and suffix:
        currency = _SYMBOL_MAP.get(suffix)
    if currency is None:
        # Default to USD if dollar sign found without explicit prefix
        if "$" in cleaned and not prefix:
            currency = "USD"

    amount_str = m.group("amount").replace(",", "")
    try:
        amount_float = float(amount_str)
    except ValueError:
        return (None, None)

    cents = round(amount_float * 100)
    return (cents, currency)
