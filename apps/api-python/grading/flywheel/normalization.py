"""Cert-number + grade normalisation for community submissions.

Two concerns:

1. **Cert-number normalisation.** Users type cert numbers inconsistently
   ("PSA 12345678", "1234-5678", " 12345678 "). ``normalize_cert_number``
   produces a single canonical string per company so the dedup key
   ``(source, source_id)`` is stable: the same physical slab submitted twice
   collapses to one ``grading_training_sample`` row.

2. **Grade normalisation.** All four companies grade nominally on a 1–10 scale
   with 0.5 steps (BGS adds Black Label = 10/10/10/10; CGC adds "Pristine 10";
   SGC adds "Gold/Gem 10"). v1 normalisation is **conservative**: clamp to
   [1, 10], snap to the nearest 0.5, and keep the raw company + grade in
   provenance. We deliberately do NOT rescale across companies — a BGS 9.5 is
   not difficulty-equivalent to a PSA 9.5, and turning one into the other is a
   real ML calibration decision, not a mechanical map. The models calibrate to
   PSA (rules/07-grading.md "keep separate label streams"); the company tag on
   each row keeps the streams separable. Proper cross-company calibration is
   tracked as **#FU-55**.
"""

from __future__ import annotations

import re
from typing import Optional

from .types import COMMUNITY_SOURCE

# Canonical grade grid: 0.5 steps in [1.0, 10.0].
CANONICAL_GRADE_STEP = 0.5
_GRADE_MIN = 1.0
_GRADE_MAX = 10.0

# Company tokens we strip if a user prefixes the cert with them.
_COMPANY_TOKENS = ("PSA", "BGS", "BVG", "CGC", "SGC", "BECKETT", "CERT", "#")


def normalize_cert_number(company: str, raw: str) -> str:
    """Canonicalise a raw cert number into a stable dedup token.

    - Uppercases.
    - Strips a leading company/label token ("PSA 123" → "123").
    - Removes spaces, hyphens, and ``#``.

    Returns the canonical string (may be empty if ``raw`` was blank — validation
    rejects that separately). Company is accepted for symmetry / future
    per-company quirks but currently only used to recognise its own token.
    """
    text = (raw or "").strip().upper()
    if not text:
        return ""
    # Strip any leading recognised label token (and following separators).
    changed = True
    while changed:
        changed = False
        for token in _COMPANY_TOKENS:
            if text.startswith(token):
                text = text[len(token) :].lstrip(" :#-")
                changed = True
    # Also drop the company's own abbreviation anywhere it leads.
    company_upper = (company or "").strip().upper()
    if company_upper and text.startswith(company_upper):
        text = text[len(company_upper) :].lstrip(" :#-")
    # Remove internal separators.
    return re.sub(r"[\s\-#]", "", text)


def to_source_id(company: str, raw_cert: str) -> str:
    """Build the ``grading_training_sample.source_id`` dedup key.

    Keyed by ``COMPANY:cert`` so two different companies can legitimately share
    a numeric cert without colliding, while the same company + cert always
    collapses to one row.
    """
    return f"{(company or '').strip().upper()}:{normalize_cert_number(company, raw_cert)}"


def normalize_grade(
    raw_grade: Optional[float],
    *,
    black_label: bool = False,
) -> Optional[float]:
    """Conservatively normalise an overall/sub grade to the canonical grid.

    - ``None`` (non-numeric outcome, e.g. "Authentic") passes through as ``None``.
    - A BGS Black Label is canonicalised to a perfect ``10.0`` regardless of the
      numeric value supplied (it *is* a 10/10/10/10 by definition).
    - Otherwise: clamp to [1, 10] and snap to the nearest 0.5.

    No cross-company rescaling is applied (see module docstring / #FU-55).
    """
    if black_label:
        return _GRADE_MAX
    if raw_grade is None:
        return None
    clamped = max(_GRADE_MIN, min(_GRADE_MAX, float(raw_grade)))
    snapped = round(clamped / CANONICAL_GRADE_STEP) * CANONICAL_GRADE_STEP
    # round() can produce 9.999999; normalise to one decimal place.
    return round(snapped, 1)


def normalize_subgrades(
    subgrades: Optional[dict[str, float]],
    *,
    black_label: bool = False,
) -> Optional[dict[str, float]]:
    """Normalise each present sub-grade with ``normalize_grade``.

    Returns ``None`` when no usable sub-grade survives. A Black Label expands to
    a full 10/10/10/10 set even if the submission omitted them.
    """
    if black_label:
        return {"centering": 10.0, "corners": 10.0, "edges": 10.0, "surface": 10.0}
    if not subgrades:
        return None
    out: dict[str, float] = {}
    for key, value in subgrades.items():
        normalized = normalize_grade(value)
        if normalized is not None:
            out[key] = normalized
    return out or None


def source_tag() -> str:
    """The literal source tag every community row carries."""
    return COMMUNITY_SOURCE
