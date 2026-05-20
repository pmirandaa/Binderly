"""PSA cert scraper job runner.

``run_job`` is the entry point for batch scraping.  It accepts:

- An iterable of cert numbers to process.
- A ``fetch_fn`` callable that takes a cert number and returns raw HTML bytes.
  In production this is ``PsaClient().fetch_html``; in tests it is a fixture-
  backed stub.
- A ``db_upsert_fn`` callable that takes a ``dict`` (one row) and performs the
  DB upsert.  Tests provide a list-appending stub so they can assert on the
  rows that would be written.

This decoupled design keeps the job runner unit-testable without a real DB or
network.

## Re-fetch policy

``run_job`` accepts an optional ``existing_sha256_fn`` callable that, given a
cert number, returns the ``raw_html_sha256`` of the most-recently ingested row
(or ``None`` if the cert has not been ingested yet).  If the SHA-256 of the
freshly fetched HTML matches the stored one, the row is skipped (no upsert).

## Error handling

- ``TosBlockError`` → re-raised immediately (halt the batch).
- ``LiveFetchDisabledError`` → re-raised (caller should not have called
  ``run_job`` without providing a mock ``fetch_fn``).
- Per-cert parse failures → logged to ``data_conflict`` list; processing
  continues with the next cert.
- Network errors (non-ToS) → logged; cert skipped.

## Logging / data-conflict records

``run_job`` returns a ``JobResult`` dataclass that includes:

- ``processed``: count of successfully upserted rows.
- ``skipped_unchanged``: count of certs skipped (same SHA-256).
- ``data_conflicts``: list of ``DataConflict`` records for any certs that
  could not be fully parsed or produced unexpected results.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Iterable, Optional

from .client import LiveFetchDisabledError, TosBlockError
from .parser import PsaParser
from .types import PsaCertRecord

logger = logging.getLogger(__name__)


@dataclass
class DataConflict:
    """Records a per-cert parsing anomaly without halting the batch."""

    cert_number: str
    reason: str
    detail: Optional[str] = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))


@dataclass
class JobResult:
    """Summary returned by ``run_job``."""

    processed: int = 0
    skipped_unchanged: int = 0
    data_conflicts: list[DataConflict] = field(default_factory=list)


def run_job(
    cert_numbers: Iterable[str],
    *,
    fetch_fn: Callable[[str], bytes],
    db_upsert_fn: Callable[[dict], None],
    existing_sha256_fn: Optional[Callable[[str], Optional[str]]] = None,
    cert_url_fn: Optional[Callable[[str], str]] = None,
) -> JobResult:
    """Scrape a batch of PSA cert pages and upsert rows.

    Args:
        cert_numbers: Iterable of PSA cert number strings to process.
        fetch_fn: ``(cert_number) → raw_html_bytes``.
            Use ``PsaClient().fetch_html`` in production;
            use a fixture stub in tests.
        db_upsert_fn: ``(row_dict) → None``.
            Performs an ``INSERT … ON CONFLICT (source, source_id) DO UPDATE``
            in the real pipeline; in tests it appends to a list.
        existing_sha256_fn: ``(cert_number) → sha256_hex | None``.
            Returns the stored SHA-256 for deduplication.  Defaults to
            ``lambda _: None`` (no dedup — always upsert).
        cert_url_fn: ``(cert_number) → url``.
            Builds the cert page URL.  Defaults to the PSA standard URL.

    Returns:
        ``JobResult`` with counters and any data-conflict records.

    Raises:
        TosBlockError: immediately when PSA returns a Cloudflare challenge.
        LiveFetchDisabledError: when ``fetch_fn`` is the real PsaClient but
            ``PSA_LIVE`` is not set.
    """
    if existing_sha256_fn is None:
        existing_sha256_fn = lambda _: None  # noqa: E731

    if cert_url_fn is None:
        cert_url_fn = lambda cn: f"https://www.psacard.com/cert/{cn}"  # noqa: E731

    parser = PsaParser()
    result = JobResult()

    for cert_number in cert_numbers:
        cert_url = cert_url_fn(cert_number)
        logger.debug("Fetching cert %s → %s", cert_number, cert_url)

        # ── fetch ──────────────────────────────────────────────────────────────
        try:
            html_bytes = fetch_fn(cert_number)
        except (TosBlockError, LiveFetchDisabledError):
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Fetch error for cert %s: %s", cert_number, exc)
            result.data_conflicts.append(
                DataConflict(cert_number=cert_number, reason="fetch_error", detail=str(exc))
            )
            continue

        # ── dedup by SHA-256 ───────────────────────────────────────────────────
        import hashlib
        sha256 = hashlib.sha256(html_bytes).hexdigest()
        stored_sha = existing_sha256_fn(cert_number)
        if stored_sha is not None and stored_sha == sha256:
            logger.debug("Cert %s unchanged (sha256 match) — skip", cert_number)
            result.skipped_unchanged += 1
            continue

        # ── parse ──────────────────────────────────────────────────────────────
        record: PsaCertRecord = parser.parse(
            html_bytes,
            cert_number=cert_number,
            cert_url=cert_url,
        )

        # ── data-conflict checks ───────────────────────────────────────────────
        if record.grade is None and record.grade_label == "":
            logger.warning("Cert %s: unparseable grade label (empty)", cert_number)
            result.data_conflicts.append(
                DataConflict(
                    cert_number=cert_number,
                    reason="unparseable_grade",
                    detail=f"raw grade tag text was empty or missing",
                )
            )

        if record.has_subgrades():
            # Sanity: all present subgrades should be in [1, 10].
            for subgrade_name, subgrade_val in {
                "centering": record.centering_subgrade,
                "corners": record.corners_subgrade,
                "edges": record.edges_subgrade,
                "surface": record.surface_subgrade,
            }.items():
                if subgrade_val is not None and not (1 <= subgrade_val <= 10):
                    result.data_conflicts.append(
                        DataConflict(
                            cert_number=cert_number,
                            reason="subgrade_out_of_range",
                            detail=f"{subgrade_name}={subgrade_val}",
                        )
                    )

        # ── upsert ─────────────────────────────────────────────────────────────
        row = record.to_training_sample_row()
        try:
            db_upsert_fn(row)
            result.processed += 1
            logger.info("Upserted cert %s (grade=%s)", cert_number, record.grade_label)
        except Exception as exc:  # noqa: BLE001
            logger.error("DB upsert failed for cert %s: %s", cert_number, exc)
            result.data_conflicts.append(
                DataConflict(cert_number=cert_number, reason="db_upsert_error", detail=str(exc))
            )

    return result
