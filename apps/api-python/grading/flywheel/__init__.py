"""Community submission flywheel — first-party labelled grading data.

Pro users submit their real graded-card outcomes (PSA/BGS/CGC/SGC slab cert +
the photos they captured). This package validates, normalises, and ingests those
submissions into the shared ``grading_training_sample`` table with
``source='community_flywheel'`` — the same shape the iter-28 scrapers write, so
the existing ``ml_common`` data loaders pick them up unchanged.

This is the first-party analogue of ``grading/scrapers/`` (PSA/eBay/auction):
instead of scraping public data, users contribute their own. It closes the
long-term grading-accuracy flywheel (PROJECT.md § 12).

Public surface:
    - ``CommunitySubmission`` — the raw submitted outcome (one slab).
    - ``validate_submission`` — per-company cert + grade + photo + consent checks.
    - ``normalize_cert_number`` / ``normalize_grade`` — canonicalisation.
    - ``run_ingestion`` — the validate → normalize → dedup → upsert job runner,
      mirroring ``grading.scrapers.psa.job.run_job``.
    - ``FlywheelJobResult`` / ``SubmissionConflict`` — job telemetry.
"""

from __future__ import annotations

from .ingest import FlywheelJobResult, SubmissionConflict, run_ingestion
from .normalization import (
    CANONICAL_GRADE_STEP,
    normalize_cert_number,
    normalize_grade,
    to_source_id,
)
from .types import CommunitySubmission, GradeCompany
from .validation import (
    SUPPORTED_COMPANIES,
    ValidationError,
    ValidationResult,
    validate_submission,
)

__all__ = [
    "CANONICAL_GRADE_STEP",
    "CommunitySubmission",
    "FlywheelJobResult",
    "GradeCompany",
    "SUPPORTED_COMPANIES",
    "SubmissionConflict",
    "ValidationError",
    "ValidationResult",
    "normalize_cert_number",
    "normalize_grade",
    "run_ingestion",
    "to_source_id",
    "validate_submission",
]
