"""Data types for the community submission flywheel.

``CommunitySubmission`` is the raw, user-submitted graded outcome for a single
slab. It maps to one ``community_submission`` row (the user-owned table) and,
once validated + normalised, to one ``grading_training_sample`` row
(``source='community_flywheel'``) — matching the PSA scraper's
``to_training_sample_row`` shape exactly so the ``ml_common`` loaders consume it
without change.

Design notes (mirrors ``grading.scrapers.psa.types.PsaCertRecord``):
- Grade fields are plain ``float`` (the contracts layer already constrains to a
  0.5-step grid in [1, 10]); ``None`` is reserved for non-numeric outcomes
  ("Authentic"), preserved in ``raw_grade_label``.
- Images are stored as **URL references only** (``front``/``back``/``corners``/
  ``surface``/``slab``). Downloading + R2 transcode is a separate pipeline step
  (#FU-39), exactly as the scrapers left ``thumbnail_url`` as a reference.
- ``black_label`` flags a BGS Black Label (4×10 sub-grades) so cross-company
  calibration (#FU-55) can treat it specially later; it does not change the v1
  conservative normalisation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, Optional

GradeCompany = Literal["PSA", "BGS", "CGC", "SGC"]

# The fixed source tag for every community-submitted row. The
# ``grading_training_sample`` CHECK constraint already includes this literal
# (see packages/db/src/schema/grading.ts), so rows land without a schema change.
COMMUNITY_SOURCE = "community_flywheel"

# Sub-grade keys the models expect (PSA/BGS taxonomy). Centering is geometric
# but still carried through when the slab cert reports it.
SUBGRADE_KEYS = ("centering", "corners", "edges", "surface")


@dataclass(frozen=True)
class CommunitySubmission:
    """One user-submitted graded outcome (a single slab + its photos).

    Args:
        grade_company: One of PSA / BGS / CGC / SGC (validated separately).
        cert_number: Raw cert number exactly as the user entered it. The
            canonical, normalised form is produced by ``normalize_cert_number``.
        overall_grade: The company's overall grade as a float, or ``None`` for
            a non-numeric outcome (e.g. PSA "Authentic").
        subgrades: Optional ``{centering?, corners?, edges?, surface?}`` floats
            from the slab when the company prints sub-grades (BGS always; CGC
            often; PSA rarely; SGC no).
        image_urls: ``{front?, back?, corners?: list[str], surface?, slab?}`` —
            URL references to the user's captured photos + (optionally) the slab
            photo. References only; no bytes are downloaded here.
        user_id: The submitting user's id (provenance per rules/07-grading.md
            "training data hygiene"). Optional in tests.
        consent: Whether the user explicitly consented to their images + grades
            becoming training data. Required true for ingestion.
        black_label: BGS Black Label flag (perfect 10/10/10/10 sub-grades).
        raw_grade_label: Original grade string as shown on the slab
            ("PSA 10", "BGS 9.5", "Authentic", ...) for provenance.
        submitted_at: When the user submitted (UTC); provenance only.
        source_version: Pipeline version tag for provenance.
    """

    grade_company: str
    cert_number: str
    overall_grade: Optional[float]
    subgrades: Optional[dict[str, float]] = None
    image_urls: dict[str, Any] = field(default_factory=dict)
    user_id: Optional[str] = None
    consent: bool = False
    black_label: bool = False
    raw_grade_label: Optional[str] = None
    submitted_at: Optional[datetime] = None
    source_version: str = "community_flywheel_v1"

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "CommunitySubmission":
        """Build from a ``community_submission`` DB row (or a test dict).

        Tolerant of missing optional keys so a partially-populated row from an
        older client doesn't crash ingestion — validation downstream rejects
        anything actually unusable.
        """
        submitted_raw = row.get("submitted_at")
        submitted_at: Optional[datetime]
        if isinstance(submitted_raw, datetime):
            submitted_at = submitted_raw
        elif isinstance(submitted_raw, str) and submitted_raw:
            try:
                submitted_at = datetime.fromisoformat(submitted_raw.replace("Z", "+00:00"))
            except ValueError:
                submitted_at = None
        else:
            submitted_at = None

        subgrades_raw = row.get("subgrades")
        subgrades: Optional[dict[str, float]] = None
        if isinstance(subgrades_raw, dict):
            subgrades = {
                k: float(v)
                for k, v in subgrades_raw.items()
                if k in SUBGRADE_KEYS and _is_number(v)
            } or None

        return cls(
            grade_company=str(row.get("grade_company", "")),
            cert_number=str(row.get("cert_number", "")),
            overall_grade=_opt_float(row.get("overall_grade")),
            subgrades=subgrades,
            image_urls=dict(row.get("image_urls") or {}),
            user_id=row.get("user_id"),
            consent=bool(row.get("consent", False)),
            black_label=bool(row.get("black_label", False)),
            raw_grade_label=row.get("raw_grade_label"),
            submitted_at=submitted_at,
            source_version=str(row.get("source_version", "community_flywheel_v1")),
        )

    def has_subgrades(self) -> bool:
        return bool(self.subgrades)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _opt_float(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
