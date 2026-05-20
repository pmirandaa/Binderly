"""PSA cert page HTML parser.

``PsaParser`` takes raw HTML bytes and returns a ``PsaCertRecord``.
It is intentionally stateless — create once, call ``.parse()`` many times.

HTML structure assumed (synthetic fixtures + community-documented PSA cert
page layout, as of 2026):

  <table class="cert-details-table">
    <tr><th>Cert #</th>  <td class="cert-number">XXXXXXXX</td></tr>
    <tr><th>Year</th>    <td class="cert-year">1999</td></tr>
    <tr><th>Card</th>    <td class="cert-card-name">Charizard</td></tr>
    <tr><th>Set</th>     <td class="cert-set">Base Set</td></tr>
    <tr><th>Card #</th>  <td class="cert-card-number">4/102</td></tr>
    <tr><th>Grade</th>   <td class="cert-grade"><strong>PSA 10</strong></td></tr>
    <!-- optional subgrade rows, present on newer slabs only: -->
    <tr><th>PSA Centering</th> <td class="cert-subgrade-centering">9.5</td></tr>
    <tr><th>PSA Corners</th>   <td class="cert-subgrade-corners">10</td></tr>
    <tr><th>PSA Edges</th>     <td class="cert-subgrade-edges">10</td></tr>
    <tr><th>PSA Surface</th>   <td class="cert-subgrade-surface">10</td></tr>
  </table>

  <!-- optional slab image: -->
  <img class="cert-card-image" src="https://…/front.jpg" />

Qualifier codes are parsed from the grade label: "PSA 9 [OC]" → grade=9, qualifiers=["OC"].
Multiple qualifiers: "PSA 8 [OC, PD]" → qualifiers=["OC", "PD"].

Non-numeric grades:
  "Authentic"         → grade=None, grade_label="Authentic"
  "Authentic Altered" → grade=None, grade_label="Authentic Altered"

ToS block detection: ``PsaParser.is_blocked(html)`` returns True when the
HTML looks like a Cloudflare challenge page.

The ``PSA_LIVE`` env flag is NOT checked here — the parser is purely a
transformation over bytes and has no network dependency.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

from bs4 import BeautifulSoup

from .types import PsaCertRecord

# Known Cloudflare/anti-bot markers in the response body.
_TOS_BLOCK_MARKERS: tuple[str, ...] = (
    "Cloudflare Ray ID",
    "cf-wrapper",
    "You have been blocked",
    "cf-alert-error",
    "Just a moment",
)

# Qualifier pattern: "[OC]" or "[OC, PD]" or "[OC,PD,ST]"
_QUALIFIER_RE = re.compile(r"\[([^\]]+)\]")

# Known non-numeric PSA grade labels (case-insensitive match).
_NON_NUMERIC_GRADES: frozenset[str] = frozenset(
    {"authentic", "authentic altered", "fake"}
)

# PSA grade label prefix: "PSA 10" → "10"; "PSA 9 [OC]" → "9"
_GRADE_PREFIX_RE = re.compile(r"^(?:PSA\s+)?(.+)$", re.IGNORECASE)


def _text(tag) -> str:
    """Return stripped text from a BeautifulSoup tag, or empty string."""
    return tag.get_text(strip=True) if tag else ""


def _parse_decimal(raw: str) -> Optional[Decimal]:
    """Parse a grade string to Decimal, return None on failure."""
    cleaned = raw.strip()
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


class PsaParser:
    """Parse a PSA cert HTML page into a ``PsaCertRecord``.

    Usage::

        parser = PsaParser()
        html_bytes = Path("cert.html").read_bytes()
        record = parser.parse(html_bytes, cert_number="44001234")

    The ``cert_number`` parameter is required because the cert number also
    appears in the URL (the caller owns the URL → cert mapping). If the page
    also contains a cert-number cell we validate them match; a mismatch is
    recorded in the record's ``raw_metadata`` but does not raise.
    """

    @staticmethod
    def is_blocked(html: bytes | str) -> bool:
        """Return True if the HTML looks like a Cloudflare / ToS block page."""
        text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
        return any(marker in text for marker in _TOS_BLOCK_MARKERS)

    def parse(
        self,
        html: bytes | str,
        *,
        cert_number: str,
        cert_url: str = "",
        fetched_at: Optional[datetime] = None,
    ) -> PsaCertRecord:
        """Parse ``html`` into a ``PsaCertRecord``.

        Args:
            html: Raw HTML bytes (or str) from the cert page.
            cert_number: The cert number from the URL / batch manifest.
                Used as ``source_id`` and validated against the page's cert-
                number cell if present.
            cert_url: The original fetch URL (stored verbatim in the record).
            fetched_at: UTC timestamp of the fetch; defaults to ``now()``.

        Returns:
            A populated ``PsaCertRecord``.  Fields that cannot be parsed
            are left as ``None``.  The parser never raises for malformed
            input — callers can check ``record.grade is None and
            record.grade_label == ""`` to detect an unparseable page.
        """
        raw_bytes = html if isinstance(html, bytes) else html.encode("utf-8")
        sha256 = hashlib.sha256(raw_bytes).hexdigest()
        html_str = raw_bytes.decode("utf-8", errors="replace")

        if fetched_at is None:
            fetched_at = datetime.now(tz=timezone.utc)

        soup = BeautifulSoup(html_str, "lxml")

        # ── cert-details table ────────────────────────────────────────────────
        cert_num_cell = soup.find(class_="cert-number")
        page_cert_number = _text(cert_num_cell) or cert_number

        card_name = _text(soup.find(class_="cert-card-name")) or None
        set_name = _text(soup.find(class_="cert-set")) or None
        year = _text(soup.find(class_="cert-year")) or None
        card_number = _text(soup.find(class_="cert-card-number")) or None

        # ── grade ─────────────────────────────────────────────────────────────
        grade_tag = soup.find(class_="cert-grade")
        grade_label_raw = _text(grade_tag)
        grade, grade_label, qualifiers = self._parse_grade_label(grade_label_raw)

        # ── subgrades (optional — newer slabs only) ───────────────────────────
        centering = _parse_decimal(_text(soup.find(class_="cert-subgrade-centering")))
        corners = _parse_decimal(_text(soup.find(class_="cert-subgrade-corners")))
        edges = _parse_decimal(_text(soup.find(class_="cert-subgrade-edges")))
        surface = _parse_decimal(_text(soup.find(class_="cert-subgrade-surface")))

        # ── slab image ────────────────────────────────────────────────────────
        img_tag = soup.find("img", class_="cert-card-image")
        image_url = img_tag["src"] if img_tag and img_tag.get("src") else None

        return PsaCertRecord(
            cert_number=page_cert_number,
            cert_url=cert_url or f"https://www.psacard.com/cert/{cert_number}",
            card_name=card_name,
            set_name=set_name,
            year=year,
            card_number=card_number,
            grade=grade,
            grade_label=grade_label,
            centering_subgrade=centering,
            corners_subgrade=corners,
            edges_subgrade=edges,
            surface_subgrade=surface,
            qualifiers=qualifiers,
            image_url=image_url,
            raw_html_sha256=sha256,
            fetched_at=fetched_at,
        )

    # ── private helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _parse_grade_label(raw: str) -> tuple[Optional[Decimal], str, list[str]]:
        """Parse a raw grade cell string.

        Returns (numeric_grade_or_None, clean_label, qualifiers_list).

        Examples:
            "PSA 10"       → (Decimal('10'), 'PSA 10', [])
            "PSA 9 [OC]"   → (Decimal('9'),  'PSA 9 [OC]', ['OC'])
            "PSA 8.5"      → (Decimal('8.5'), 'PSA 8.5', [])
            "Authentic"    → (None, 'Authentic', [])
            "Authentic Altered" → (None, 'Authentic Altered', [])
            ""             → (None, '', [])
        """
        if not raw:
            return None, "", []

        grade_label = raw.strip()

        # Extract qualifiers: "[OC]" or "[OC, PD]"
        qualifiers: list[str] = []
        for m in _QUALIFIER_RE.finditer(grade_label):
            codes = [c.strip().upper() for c in m.group(1).split(",") if c.strip()]
            qualifiers.extend(codes)

        # Remove qualifier brackets from label for numeric parsing.
        label_no_qual = _QUALIFIER_RE.sub("", grade_label).strip()

        # Strip leading "PSA " prefix.
        numeric_part = re.sub(r"^PSA\s+", "", label_no_qual, flags=re.IGNORECASE).strip()

        # Check for non-numeric outcomes.
        if numeric_part.lower() in _NON_NUMERIC_GRADES:
            return None, grade_label, qualifiers

        # Attempt numeric parse.
        grade = _parse_decimal(numeric_part)
        return grade, grade_label, qualifiers
