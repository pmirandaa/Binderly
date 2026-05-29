"""Text normalisation + observation-title parsing for printing matching.

The scrapers store a free-text description per observation:
- ``ebay_graded_listing_observation.title``
- ``auction_lot_observation.lot_title``
- ``grading_training_sample.raw_metadata.title``

These titles are noisy ("PSA 10 GEM MT 1999 Pokemon Base Set #4 Charizard 1st
Edition Holo").  ``parse_observation`` strips the grading/grade/era noise and
extracts the signal we match on: the card-name tokens, the card number, and any
variant hints (1st edition, shadowless, holo, …).

Pure stdlib (``re`` + ``difflib``) — no fuzzy-match dependency is added so CI
stays light, consistent with the placeholder-model / numpy convention used
across the grading tree.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Tokens that are pure noise for card identity: grading companies, grade words,
# the "Pokemon" brand word, condition abbreviations, language qualifiers we
# handle separately, etc.
_STOPWORDS: frozenset[str] = frozenset(
    {
        "psa", "bgs", "cgc", "sgc", "gem", "mt", "mint", "nm", "near",
        "black", "label", "pristine", "authentic", "auth", "graded",
        "pokemon", "pokémon", "tcg", "card", "the", "a", "lp", "mp", "hp",
        "ex", "raw", "ungraded", "lot", "of",
    }
)

# Variant flag synonyms → canonical ``printing.variant_flags`` style token.
_VARIANT_SYNONYMS: dict[str, str] = {
    "1st": "FIRST_EDITION",
    "first": "FIRST_EDITION",
    "1sted": "FIRST_EDITION",
    "1stedition": "FIRST_EDITION",
    "shadowless": "SHADOWLESS",
    "holo": "HOLO",
    "holofoil": "HOLO",
    "reverse": "REVERSE_HOLO",
    "unlimited": "UNLIMITED",
    "promo": "PROMO",
}

# Leading "<COMPANY> <grade>" prefix, optionally with GEM MT / BLACK LABEL /
# PRISTINE / AUTHENTIC qualifiers.  Stripped before name extraction.
_GRADE_PREFIX_RE = re.compile(
    r"^\s*(?:psa|bgs|cgc|sgc)\s+"
    r"(?:gem[-\s]?mt\s+|black\s+label\s+|pristine\s+)?"
    r"(?:\d{1,2}(?:\.\d)?|authentic)\b",
    re.IGNORECASE,
)

# Four-digit release year, e.g. "1999".
_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")

# Card number forms we recognise, most specific first:
#   "#4", "4/102", "SWSH001", "TG01", "GG12", "001a"
_NUMBER_RES: tuple[re.Pattern[str], ...] = (
    re.compile(r"#\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]?)\b"),
    re.compile(r"\b(\d{1,4})\s*/\s*\d{1,4}\b"),
    re.compile(r"\b([A-Z]{2,4}\d{1,4}[A-Za-z]?)\b"),
)


def normalize(text: str) -> str:
    """Lowercase, strip punctuation to spaces, collapse whitespace."""
    lowered = text.lower()
    cleaned = re.sub(r"[^a-z0-9]+", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def normalize_number(number: str) -> str:
    """Normalise a card number for equality comparison.

    Lowercases, drops a leading ``#``, and strips leading zeros from the numeric
    run while preserving any alpha prefix/suffix (``SWSH001`` → ``swsh1``,
    ``004`` → ``4``, ``TG01`` → ``tg1``).
    """
    n = number.strip().lower().lstrip("#")
    m = re.match(r"^([a-z]*)0*(\d+)([a-z]*)$", n)
    if m:
        prefix, digits, suffix = m.groups()
        return f"{prefix}{int(digits)}{suffix}"
    return n


@dataclass(frozen=True)
class ObservationQuery:
    """Structured signal extracted from a noisy observation title."""

    raw: str
    name_tokens: tuple[str, ...]
    number: str | None
    variant_flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def name(self) -> str:
        return " ".join(self.name_tokens)

    @property
    def normalized_number(self) -> str | None:
        return normalize_number(self.number) if self.number is not None else None


def _extract_number(raw: str) -> str | None:
    for pattern in _NUMBER_RES:
        m = pattern.search(raw)
        if m:
            return m.group(1)
    return None


def parse_observation(title: str) -> ObservationQuery:
    """Parse a raw observation title into an ``ObservationQuery``.

    Steps: strip the leading grade prefix, pull out the card number + variant
    hints, then keep the remaining non-stopword alpha tokens as the card name.
    """
    raw = title or ""
    number = _extract_number(raw)

    # Strip the "PSA 10 …" grade prefix so the grade digit isn't mistaken for a
    # card number or name token.
    body = _GRADE_PREFIX_RE.sub(" ", raw)
    norm = normalize(body)
    tokens = norm.split()

    variant_flags: list[str] = []
    name_tokens: list[str] = []
    for tok in tokens:
        if tok in _VARIANT_SYNONYMS:
            flag = _VARIANT_SYNONYMS[tok]
            if flag not in variant_flags:
                variant_flags.append(flag)
            continue
        if tok in _STOPWORDS:
            continue
        if tok.isdigit():
            # Pure numbers are card-number / year noise, not name tokens.
            continue
        if _YEAR_RE.fullmatch(tok):
            continue
        name_tokens.append(tok)

    return ObservationQuery(
        raw=raw,
        name_tokens=tuple(name_tokens),
        number=number,
        variant_flags=tuple(variant_flags),
    )
