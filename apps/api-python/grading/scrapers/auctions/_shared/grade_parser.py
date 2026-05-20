"""Parse grading company + grade + sub-grades from an auction lot title.

Auction lot titles for graded Pokémon slabs follow patterns like:

    PSA 10 GEM MT 1999 Pokemon Base Set #4 Charizard 1st Edition
    BGS 9.5 GEM MINT Charizard Base Set Holo 1st Ed
    BGS 10 BLACK LABEL Pokemon Base Set 1st Edition Charizard
    CGC 9 MINT Pokemon Japanese Base Set Charizard No Rarity
    SGC 8 NM/M Pokemon Base Set 1st Edition Venusaur
    SGC PRISTINE 10 Pokemon Base Set Blastoise

Raw / ungraded lots do NOT carry a company prefix:
    1999 Pokemon Base Set Shadowless Charizard Raw
    Pokemon Base Set #4 Charizard Holo LP

The parser is deliberately conservative: it requires the company abbreviation
to appear as a word boundary match before a numeric grade (or AUTHENTIC /
PRISTINE for PSA/SGC variants). If no match is found the lot is considered
ungraded and returns ("unknown", None, None).

BGS sub-grades appear in the title as e.g. "BGS 9 [9.5 9 9.5 9]" or in
the lot description; the regex captures the bracketed sub-grade block when
present, mapping to {centering, corners, edges, surface} positionally.
"""

from __future__ import annotations

import re
from typing import Optional


# ---------------------------------------------------------------------------
# Grade patterns per company
# ---------------------------------------------------------------------------

# PSA: "PSA 10", "PSA 9.5", "PSA 1", "PSA AUTHENTIC"
_PSA_RE = re.compile(
    r"\bPSA\s+"
    r"(?P<grade>(?:GEM[-\s]?MT\s+)?\d{1,2}(?:\.\d)?|AUTHENTIC)\b",
    re.IGNORECASE,
)

# BGS: "BGS 9.5", "BGS 10 BLACK LABEL"
_BGS_RE = re.compile(
    r"\bBGS\s+"
    r"(?P<grade>\d{1,2}(?:\.\d)?)(?:\s+(?P<qualifier>BLACK\s+LABEL|GEM\s+MINT))?\b",
    re.IGNORECASE,
)

# BGS sub-grades in brackets: "[9.5 9 9.5 9]" — centering corners edges surface
_BGS_SUB_RE = re.compile(
    r"\[(?P<c1>\d{1,2}(?:\.\d)?)\s+"
    r"(?P<c2>\d{1,2}(?:\.\d)?)\s+"
    r"(?P<c3>\d{1,2}(?:\.\d)?)\s+"
    r"(?P<c4>\d{1,2}(?:\.\d)?)\]"
)

# CGC: "CGC 9", "CGC 9.5"
_CGC_RE = re.compile(
    r"\bCGC\s+(?P<grade>\d{1,2}(?:\.\d)?)\b",
    re.IGNORECASE,
)

# SGC: "SGC 8", "SGC PRISTINE 10", "SGC 10 PRISTINE"
_SGC_RE = re.compile(
    r"\bSGC\s+"
    r"(?:PRISTINE\s+)?(?P<grade>\d{1,2}(?:\.\d)?)(?:\s+PRISTINE)?\b",
    re.IGNORECASE,
)

_PARSERS: list[tuple[str, re.Pattern]] = [
    ("PSA", _PSA_RE),
    ("BGS", _BGS_RE),
    ("CGC", _CGC_RE),
    ("SGC", _SGC_RE),
]


def _parse_grade_string(grade_str: str) -> Optional[float]:
    """Convert a raw grade string to a float, or None for text grades."""
    cleaned = re.sub(r"GEM[-\s]?MT\s*", "", grade_str, flags=re.IGNORECASE).strip()
    if re.match(r"^\d{1,2}(?:\.\d)?$", cleaned):
        return float(cleaned)
    return None  # "AUTHENTIC" etc.


def parse_lot_title(
    title: str,
) -> tuple[str, Optional[float], Optional[dict]]:
    """Parse grading information from an auction lot title.

    Returns:
        (grading_company, overall_grade, sub_grades) where:
        - ``grading_company`` is ``"PSA"``, ``"BGS"``, ``"CGC"``, ``"SGC"``,
          or ``"unknown"`` when no match is found.
        - ``overall_grade`` is a float (e.g. ``10.0``, ``9.5``) or ``None``
          for text-grade lots (PSA AUTHENTIC) or when company is unknown.
        - ``sub_grades`` is a dict with keys ``centering``, ``corners``,
          ``edges``, ``surface`` (all float) when BGS sub-grades are found,
          otherwise ``None``.
    """
    for company, pattern in _PARSERS:
        m = pattern.search(title)
        if m is None:
            continue
        grade_str = m.group("grade")
        overall_grade = _parse_grade_string(grade_str)
        sub_grades: Optional[dict] = None
        if company == "BGS":
            sub_m = _BGS_SUB_RE.search(title)
            if sub_m:
                sub_grades = {
                    "centering": float(sub_m.group("c1")),
                    "corners": float(sub_m.group("c2")),
                    "edges": float(sub_m.group("c3")),
                    "surface": float(sub_m.group("c4")),
                }
        return (company, overall_grade, sub_grades)

    return ("unknown", None, None)
