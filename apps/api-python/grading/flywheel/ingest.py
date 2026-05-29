"""Community submission ingestion job runner.

``run_ingestion`` is the entry point. It mirrors
``grading.scrapers.psa.job.run_job`` so the two first-party/scraped inflows
share one operational shape:

- Accepts an iterable of raw submissions (``CommunitySubmission`` or dicts).
- ``db_upsert_fn(row)`` performs the
  ``INSERT … ON CONFLICT (source, source_id) DO UPDATE`` in production; tests
  pass a list-appending stub.
- ``existing_source_ids_fn(source_id)`` returns whether a row already exists for
  dedup. Defaults to "nothing exists" (always upsert).
- ``image_handler(submission) -> images_dict`` is the seam where #FU-39 (image
  ingest / R2 transcode) swaps in. The default keeps **URL references only** —
  no bytes are downloaded — exactly as the scrapers left ``thumbnail_url``.

Dedup policy
------------
The dedup key is ``(source='community_flywheel', source_id='COMPANY:cert')``.
A given cert submitted twice collapses to one training sample. The default
policy is **first-write-wins-then-update**: if the row exists, the upsert is
still issued (so a later submission with better photos refreshes the row), but
it is counted as ``updated`` rather than ``inserted``. Callers that want
strict first-write-wins pass an ``existing_source_ids_fn`` and set
``skip_existing=True``.

Live vs. mock
-------------
No network or storage I/O happens by default — ingestion is pure transform +
``db_upsert_fn``. The ``FLYWHEEL_LIVE_IMAGES`` env var (read by a live
``image_handler``) is the documented gate for the future image pipeline; in CI
it is never set, so tests run fully offline.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional, Union

from .normalization import (
    normalize_grade,
    normalize_subgrades,
    to_source_id,
)
from .types import COMMUNITY_SOURCE, CommunitySubmission
from .validation import validate_submission

logger = logging.getLogger(__name__)

_LIVE_IMAGES_ENV_VAR = "FLYWHEEL_LIVE_IMAGES"

RawSubmission = Union[CommunitySubmission, dict[str, Any]]
ImageHandler = Callable[[CommunitySubmission], dict[str, Any]]


@dataclass
class SubmissionConflict:
    """Records a per-submission rejection without halting the batch."""

    cert_number: str
    grade_company: str
    reason: str
    detail: Optional[str] = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))


@dataclass
class FlywheelJobResult:
    """Summary returned by ``run_ingestion``."""

    inserted: int = 0
    updated: int = 0
    skipped_existing: int = 0
    rejected: int = 0
    conflicts: list[SubmissionConflict] = field(default_factory=list)

    @property
    def processed(self) -> int:
        """Rows written (inserted + updated)."""
        return self.inserted + self.updated


def default_image_handler(submission: CommunitySubmission) -> dict[str, Any]:
    """Default (mock) image handling — pass URL references through untouched.

    Persists the submitted photo references in the
    ``grading_training_sample.images`` jsonb shape
    (``{front?, back?, corners?: list, surface?, slab?}``) without downloading
    any bytes. The live image-ingest pipeline (#FU-39) replaces this.
    """
    images: dict[str, Any] = {}
    raw = submission.image_urls or {}
    for key in ("front", "back", "surface", "slab"):
        value = raw.get(key)
        if isinstance(value, str) and value:
            images[key] = value
    corners = raw.get("corners")
    if isinstance(corners, list):
        cleaned = [str(c) for c in corners if c]
        if cleaned:
            images["corners"] = cleaned
    return images


def build_training_sample_row(
    submission: CommunitySubmission,
    *,
    image_handler: ImageHandler = default_image_handler,
) -> dict[str, Any]:
    """Serialise a validated submission to a ``grading_training_sample`` row.

    Matches ``grading.scrapers.psa.types.PsaCertRecord.to_training_sample_row``
    column-for-column: ``source`` / ``source_id`` / ``source_url`` /
    ``printing_id`` / ``grade_company`` / ``grade`` / ``subgrades`` / ``images``
    / ``parse_confidence`` / ``raw_metadata``.

    Does NOT validate — call ``validate_submission`` first (``run_ingestion``
    does). ``printing_id`` is left ``None`` (catalog matching is #FU-40, same as
    the scrapers).
    """
    company = submission.grade_company.strip().upper()
    grade = normalize_grade(submission.overall_grade, black_label=submission.black_label)
    subgrades = normalize_subgrades(submission.subgrades, black_label=submission.black_label)
    images = image_handler(submission)

    raw_metadata: dict[str, Any] = {
        "cert_number": submission.cert_number,
        "normalized_source_id": to_source_id(company, submission.cert_number),
        "raw_overall_grade": submission.overall_grade,
        "raw_grade_label": submission.raw_grade_label,
        "black_label": submission.black_label,
        "source_version": submission.source_version,
        # Conservative-normalisation marker: the row carries the company so the
        # PSA-calibrated loaders keep streams separate. Proper cross-company
        # calibration is #FU-55.
        "calibration": "raw_per_company_v1",
    }
    if submission.user_id is not None:
        raw_metadata["user_id"] = submission.user_id
    if submission.submitted_at is not None:
        raw_metadata["submitted_at"] = submission.submitted_at.isoformat()

    return {
        "source": COMMUNITY_SOURCE,
        "source_id": to_source_id(company, submission.cert_number),
        "source_url": None,
        "printing_id": None,
        "grade_company": company,
        "grade": grade,
        "subgrades": subgrades,
        "images": images,
        # Community-submitted grades are authoritative (a real slab), so parse
        # confidence is 1.0 — same posture the PSA cert scraper takes.
        "parse_confidence": 1.0,
        "raw_metadata": raw_metadata,
    }


def _coerce(submission: RawSubmission) -> CommunitySubmission:
    if isinstance(submission, CommunitySubmission):
        return submission
    return CommunitySubmission.from_row(submission)


def run_ingestion(
    submissions: Iterable[RawSubmission],
    *,
    db_upsert_fn: Callable[[dict[str, Any]], None],
    existing_source_ids_fn: Optional[Callable[[str], bool]] = None,
    image_handler: Optional[ImageHandler] = None,
    skip_existing: bool = False,
) -> FlywheelJobResult:
    """Validate → normalise → dedup → upsert a batch of community submissions.

    Args:
        submissions: Iterable of ``CommunitySubmission`` or raw dicts (DB rows).
        db_upsert_fn: ``(row) -> None``; upsert on ``(source, source_id)``.
        existing_source_ids_fn: ``(source_id) -> bool`` — True iff a row already
            exists. Defaults to "nothing exists".
        image_handler: Override the (mock) image handling seam (#FU-39).
        skip_existing: When True, an already-existing ``source_id`` is skipped
            entirely (strict first-write-wins) instead of re-upserted.

    Returns:
        ``FlywheelJobResult`` with per-outcome counters + rejection conflicts.

    Never raises on a bad individual submission — invalid rows are recorded in
    ``conflicts`` and processing continues.
    """
    if existing_source_ids_fn is None:
        existing_source_ids_fn = lambda _sid: False  # noqa: E731
    handler = image_handler or default_image_handler

    result = FlywheelJobResult()

    for raw in submissions:
        submission = _coerce(raw)

        # ── validate ────────────────────────────────────────────────────────
        validation = validate_submission(submission)
        if not validation.ok:
            result.rejected += 1
            result.conflicts.append(
                SubmissionConflict(
                    cert_number=submission.cert_number,
                    grade_company=submission.grade_company,
                    reason="validation_failed",
                    detail="; ".join(validation.errors),
                )
            )
            logger.info(
                "Rejected community submission %r (%s): %s",
                submission.cert_number,
                submission.grade_company,
                validation.errors,
            )
            continue

        company = submission.grade_company.strip().upper()
        source_id = to_source_id(company, submission.cert_number)
        already_exists = existing_source_ids_fn(source_id)

        if already_exists and skip_existing:
            result.skipped_existing += 1
            logger.debug("Skipping existing community submission %s", source_id)
            continue

        # ── build + upsert ───────────────────────────────────────────────────
        row = build_training_sample_row(submission, image_handler=handler)
        try:
            db_upsert_fn(row)
        except Exception as exc:  # noqa: BLE001
            result.rejected += 1
            result.conflicts.append(
                SubmissionConflict(
                    cert_number=submission.cert_number,
                    grade_company=submission.grade_company,
                    reason="db_upsert_error",
                    detail=str(exc),
                )
            )
            logger.error("DB upsert failed for %s: %s", source_id, exc)
            continue

        if already_exists:
            result.updated += 1
        else:
            result.inserted += 1
        logger.info("Ingested community submission %s (grade=%s)", source_id, row["grade"])

    return result


def live_images_enabled() -> bool:
    """Whether the live image-ingest gate is set (``FLYWHEEL_LIVE_IMAGES=1``).

    Mirrors ``ml_common.image_loader``'s env-gate convention. The default
    ``image_handler`` ignores this (refs-only); a future live handler (#FU-39)
    reads it before performing any network/storage I/O.
    """
    return os.environ.get(_LIVE_IMAGES_ENV_VAR, "0") == "1"
