"""Title regex parser for eBay graded-slab listings.

``parse_title(title)`` extracts grading company + overall grade + optional
BGS sub-grades from a raw eBay listing title.

Design decisions
----------------
* **Priority order** for company matching: PSA → BGS/Beckett → CGC → SGC.
  First match wins; a title with both "PSA" and "BGS" (unusual but legal)
  is attributed to PSA.
* **Grade adjacency**: the grade token must appear within 3 space-separated
  tokens of the company abbreviation.  Titles like "PSA Pop Report 10" would
  match the company but the grade token is far away — parse_confidence is
  penalised by 0.1 per non-adjacent position beyond 1.
* **BGS sub-grades**: captured only when four slash-separated floats appear
  after the grade (e.g. ``"BGS 9.5 10/9.5/9.5/9"``).
* **Authentic slabs**: ``AUTH`` / ``AUTHENTIC`` → overall_grade=None,
  grade_str="Auth".
* **Parser version** (``PARSER_VERSION``) must be incremented whenever this
  module changes so stale DB rows can be re-parsed.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Optional

from .types import GRADING_COMPANIES, ParsedSlabTitle

# ---------------------------------------------------------------------------
# Grade company patterns (searched via re.search, case-insensitive)
# ---------------------------------------------------------------------------

_COMPANY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("PSA", re.compile(r"\bPSA\b", re.IGNORECASE)),
    ("BGS", re.compile(r"\b(?:BGS|Beckett)\b", re.IGNORECASE)),
    ("CGC", re.compile(r"\bCGC\b", re.IGNORECASE)),
    ("SGC", re.compile(r"\bSGC\b", re.IGNORECASE)),
]

# ---------------------------------------------------------------------------
# Grade token pattern — the set of valid numeric grades + Authentic variants.
# Order matters: longer tokens (9.5, 8.5, …) must appear before their
# integer prefixes so the regex matches the full token.
# ---------------------------------------------------------------------------

_GRADE_TOKENS = (
    "10",
    "9\\.5", "9",
    "8\\.5", "8",
    "7\\.5", "7",
    "6\\.5", "6",
    "5\\.5", "5",
    "4\\.5", "4",
    "3\\.5", "3",
    "2\\.5", "2",
    "1\\.5", "1",
    "AUTH(?:ENTIC)?",
)

_GRADE_PATTERN = re.compile(
    r"\b(" + "|".join(_GRADE_TOKENS) + r")\b",
    re.IGNORECASE,
)

# BGS sub-grade block: four floats separated by / or spaces, e.g.
# "10/9.5/9.5/9" or "10 9.5 9.5 9"
_BGS_SUBGRADE_PATTERN = re.compile(
    r"\b(\d+(?:\.\d+)?)[/ ](\d+(?:\.\d+)?)[/ ](\d+(?:\.\d+)?)[/ ](\d+(?:\.\d+)?)\b"
)

# Maximum token distance (number of words) between company abbreviation
# and grade token before confidence is penalised.
_ADJACENT_WINDOW = 3
_CONFIDENCE_PENALTY_PER_EXTRA_TOKEN = 0.1


def parse_title(title: str) -> ParsedSlabTitle:
    """Parse a raw eBay listing title into a :class:`ParsedSlabTitle`.

    Parameters
    ----------
    title:
        Raw eBay listing title, e.g.
        ``"PSA 10 Pokemon Base Set Charizard Holo 4/102"``.

    Returns
    -------
    ParsedSlabTitle
        Always returns a result; ``grading_company = 'OTHER'`` and
        ``parse_confidence = 0.5`` when no company is matched.
    """
    company = _detect_company(title)
    if company == "OTHER":
        return ParsedSlabTitle(
            grading_company="OTHER",
            overall_grade=None,
            grade_str="",
            sub_grades=None,
            parse_confidence=0.5,
        )

    grade_str, overall_grade, confidence, grade_match = _extract_grade(title, company)
    sub_grades: Optional[dict[str, float]] = None
    if company == "BGS" and grade_match is not None:
        sub_grades = _extract_bgs_subgrades(title, grade_match.end())

    return ParsedSlabTitle(
        grading_company=company,
        overall_grade=overall_grade,
        grade_str=grade_str,
        sub_grades=sub_grades,
        parse_confidence=confidence,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _detect_company(title: str) -> str:
    for company, pattern in _COMPANY_PATTERNS:
        if pattern.search(title):
            return company
    return "OTHER"


def _extract_grade(
    title: str,
    company: str,
) -> tuple[str, Optional[Decimal], float, Optional[re.Match[str]]]:
    """Return ``(grade_str, overall_grade, confidence, match_object)``."""
    # Find the position of the company abbreviation in the title tokens.
    tokens = title.split()
    company_idx: Optional[int] = None
    company_pattern = next(p for c, p in _COMPANY_PATTERNS if c == company)
    for i, tok in enumerate(tokens):
        if company_pattern.fullmatch(tok.strip(".,;:")):
            company_idx = i
            break
        if company_pattern.search(tok):
            company_idx = i
            break

    # Search for a grade token in the full title.
    grade_match = _GRADE_PATTERN.search(title)
    if grade_match is None:
        return "", None, max(0.1, (1.0 if company != "OTHER" else 0.5) - 0.3), None

    raw_grade = grade_match.group(1)

    # Compute adjacency confidence penalty.
    confidence = 1.0
    if company_idx is not None:
        grade_token_idx: Optional[int] = None
        for i, tok in enumerate(tokens):
            if _GRADE_PATTERN.fullmatch(tok.strip(".,;:")):
                grade_token_idx = i
                break
            if _GRADE_PATTERN.search(tok):
                grade_token_idx = i
                break
        if grade_token_idx is not None:
            distance = abs(grade_token_idx - company_idx)
            if distance > _ADJACENT_WINDOW:
                extra = distance - _ADJACENT_WINDOW
                confidence = max(0.1, 1.0 - extra * _CONFIDENCE_PENALTY_PER_EXTRA_TOKEN)

    # Parse the grade value.
    if re.fullmatch(r"AUTH(?:ENTIC)?", raw_grade, re.IGNORECASE):
        return "Auth", None, confidence, grade_match
    overall = Decimal(raw_grade)
    return raw_grade, overall, confidence, grade_match


def _extract_bgs_subgrades(
    title: str,
    search_from: int,
) -> Optional[dict[str, float]]:
    """Try to parse BGS sub-grades from the title tail after the grade token.

    The Finding API title rarely contains the sub-grade breakdown, but
    some sellers include it (e.g. ``"BGS 9.5 10/9.5/9.5/9"``).  Returns
    ``None`` when not found.
    """
    m = _BGS_SUBGRADE_PATTERN.search(title, search_from)
    if m is None:
        return None
    centering, corners, edges, surface = (float(m.group(i)) for i in range(1, 5))
    return {
        "centering": centering,
        "corners": corners,
        "edges": edges,
        "surface": surface,
    }
