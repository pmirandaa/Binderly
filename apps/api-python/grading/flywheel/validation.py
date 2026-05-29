"""Validation for community submissions.

Server-side mirror of the mobile client-side checks (apps/mobile/src/grading/
community/validation.ts). Both are pinned to the same per-company rules so a
submission that passes on-device also passes here — but the server is the
authority and re-validates everything (never trust the client).

What we validate:

1. **Company** — must be one of PSA / BGS / CGC / SGC.
2. **Cert-number format** — per-company heuristic on the *normalised* cert.
   These are shape checks (digit-count ranges), NOT authoritative checksum
   validation — PSA/Beckett/CGC do not publish a public checksum. The intent is
   to reject obvious typos (letters, empty, absurd lengths), not to guarantee
   the cert exists.
3. **Grade range** — overall + any sub-grades must be on the 0.5 grid in
   [1, 10], OR omitted (``None``) for a non-numeric outcome.
4. **Required photos** — at minimum a front + back reference (the centering +
   corners models need both). The slab photo is optional (some users won't
   share it; rules/07-grading.md surfaces it as optional).
5. **Consent** — the user must explicitly opt in to their data becoming
   training data.

``validate_submission`` returns a ``ValidationResult`` aggregating every error
rather than raising on the first, so the UI/caller can surface all problems at
once.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from .normalization import CANONICAL_GRADE_STEP, normalize_cert_number
from .types import CommunitySubmission, SUBGRADE_KEYS

SUPPORTED_COMPANIES: tuple[str, ...] = ("PSA", "BGS", "CGC", "SGC")

# Per-company cert-number shape (applied to the normalised, digits-only cert).
# Heuristic digit-count ranges drawn from observed real cert numbers; see the
# module docstring on why these are shape checks, not checksums.
_CERT_PATTERNS: dict[str, re.Pattern[str]] = {
    "PSA": re.compile(r"^\d{7,9}$"),
    "BGS": re.compile(r"^\d{8,11}$"),
    "CGC": re.compile(r"^\d{7,12}$"),
    "SGC": re.compile(r"^\d{6,11}$"),
}

_GRADE_MIN = 1.0
_GRADE_MAX = 10.0


class ValidationError(str):
    """A single human-readable validation failure code/message.

    Subclasses ``str`` so errors compare/serialise as plain strings while still
    being a distinct, greppable type at call sites.
    """


@dataclass(frozen=True)
class ValidationResult:
    """Aggregate validation outcome.

    ``ok`` is True iff ``errors`` is empty. ``errors`` are stable, prefixed
    codes (e.g. ``"cert_number: ..."``) so tests can assert on the field
    without coupling to exact prose.
    """

    ok: bool
    errors: list[str] = field(default_factory=list)

    @property
    def error_fields(self) -> set[str]:
        """The set of field prefixes that failed (text before the first ':')."""
        return {e.split(":", 1)[0] for e in self.errors}


def _grade_in_range(value: float) -> bool:
    if not (_GRADE_MIN <= value <= _GRADE_MAX):
        return False
    # On the 0.5 grid: 2*value must be an integer.
    doubled = value / CANONICAL_GRADE_STEP
    return abs(doubled - round(doubled)) < 1e-9


def validate_company(company: str) -> Optional[str]:
    if (company or "").strip().upper() not in SUPPORTED_COMPANIES:
        return f"grade_company: unsupported company {company!r} (expected one of {SUPPORTED_COMPANIES})"
    return None


def validate_cert_number(company: str, cert_number: str) -> Optional[str]:
    company_upper = (company or "").strip().upper()
    normalized = normalize_cert_number(company_upper, cert_number)
    if not normalized:
        return "cert_number: empty after normalisation"
    pattern = _CERT_PATTERNS.get(company_upper)
    if pattern is None:
        # Unknown company already reported by validate_company; nothing to add.
        return None
    if not pattern.fullmatch(normalized):
        return (
            f"cert_number: {cert_number!r} (normalised {normalized!r}) does not "
            f"match the expected {company_upper} format"
        )
    return None


def validate_grades(submission: CommunitySubmission) -> list[str]:
    errors: list[str] = []
    overall = submission.overall_grade
    # Black Label is implicitly a perfect 10; an explicit numeric overall is
    # still allowed but if present must be in range.
    if overall is not None and not _grade_in_range(overall):
        errors.append(
            f"overall_grade: {overall} is outside the [1, 10] 0.5-step grid"
        )
    # A non-Black-Label submission must carry *some* grade signal (an overall
    # or at least one sub-grade) — otherwise the row is unlabelled and useless.
    has_signal = (
        submission.black_label
        or overall is not None
        or bool(submission.subgrades)
    )
    if not has_signal:
        errors.append("overall_grade: no grade provided (overall or sub-grades required)")
    if submission.subgrades:
        for key, value in submission.subgrades.items():
            if key not in SUBGRADE_KEYS:
                errors.append(f"subgrades: unknown sub-grade {key!r}")
                continue
            if not _grade_in_range(value):
                errors.append(
                    f"subgrades: {key}={value} is outside the [1, 10] 0.5-step grid"
                )
    return errors


def validate_photos(submission: CommunitySubmission) -> list[str]:
    errors: list[str] = []
    images = submission.image_urls or {}
    front = images.get("front")
    back = images.get("back")
    if not isinstance(front, str) or not front:
        errors.append("image_urls: a front photo reference is required")
    if not isinstance(back, str) or not back:
        errors.append("image_urls: a back photo reference is required")
    corners = images.get("corners")
    if corners is not None and not isinstance(corners, list):
        errors.append("image_urls: corners must be a list of references when provided")
    return errors


def validate_consent(submission: CommunitySubmission) -> Optional[str]:
    if not submission.consent:
        return "consent: the user must consent to their data becoming training data"
    return None


def validate_submission(submission: CommunitySubmission) -> ValidationResult:
    """Run every check and aggregate the failures.

    Returns ``ValidationResult(ok=True, errors=[])`` for a fully valid
    submission. The order of checks is stable for deterministic test assertions.
    """
    errors: list[str] = []

    company_error = validate_company(submission.grade_company)
    if company_error:
        errors.append(company_error)

    # Only run the format check when the company is known (otherwise the
    # message is noise atop the company error).
    if company_error is None:
        cert_error = validate_cert_number(submission.grade_company, submission.cert_number)
        if cert_error:
            errors.append(cert_error)

    errors.extend(validate_grades(submission))
    errors.extend(validate_photos(submission))

    consent_error = validate_consent(submission)
    if consent_error:
        errors.append(consent_error)

    return ValidationResult(ok=not errors, errors=errors)
