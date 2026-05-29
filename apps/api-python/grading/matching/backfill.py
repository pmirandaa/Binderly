"""Printing-match backfill job (#FU-40).

This is a *data backfill*, NOT a schema migration: it resolves NULL
``printing_id`` values on already-existing rows via ``UPDATE``.  No DDL.

Three NULL-bearing tables are supported, each with the free-text field the
matcher reads:

    grading_training_sample      → raw_metadata->>'title'
    ebay_graded_listing_observation → title
    auction_lot_observation      → lot_title

Mock / dry-run by default
-------------------------
``run_backfill`` is a pure function: rows + matcher in, ``BackfillReport`` out.
It never writes.  ``apply_updates`` performs the actual ``UPDATE``\\s and is
**dry-run by default**; it only issues live PostgREST PATCHes when
``dry_run=False`` *and* ``SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY`` are
set (same env-gated pattern as the scrapers' writers).

The CLI ``main`` runs entirely on checked-in fixtures so it executes in CI with
no DB connection, printing a JSON summary of what *would* be backfilled.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from grading.matching.matcher import PrintingMatcher
from grading.matching.types import CanonicalPrinting, MatchResult, MatchStatus

log = logging.getLogger(__name__)

_SUPABASE_URL_ENV = "SUPABASE_URL"
_SERVICE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"

_FIXTURES_DIR = Path(__file__).parent / "fixtures"


# Per-table extraction spec: (id column, dotted-path text field).
TABLE_TEXT_FIELDS: dict[str, str] = {
    "grading_training_sample": "raw_metadata.title",
    "ebay_graded_listing_observation": "title",
    "auction_lot_observation": "lot_title",
}


def extract_text(row: dict[str, Any], table: str) -> str:
    """Pull the matchable free-text field out of a row for ``table``."""
    path = TABLE_TEXT_FIELDS.get(table)
    if path is None:
        raise ValueError(f"Unsupported table for printing-match backfill: {table!r}")
    value: Any = row
    for part in path.split("."):
        if not isinstance(value, dict):
            return ""
        value = value.get(part)
    return value if isinstance(value, str) else ""


@dataclass(frozen=True)
class PlannedUpdate:
    """One resolved row that *would* be (or was) written back."""

    row_id: str
    printing_id: str
    status: MatchStatus
    score: float


@dataclass
class BackfillReport:
    """Summary of a backfill pass over a set of NULL-``printing_id`` rows."""

    table: str
    total: int = 0
    exact: int = 0
    fuzzy: int = 0
    ambiguous: int = 0
    no_match: int = 0
    skipped_no_text: int = 0
    planned_updates: list[PlannedUpdate] = field(default_factory=list)

    @property
    def resolved(self) -> int:
        return self.exact + self.fuzzy

    def record(self, row_id: str, result: MatchResult) -> None:
        self.total += 1
        if result.status is MatchStatus.EXACT:
            self.exact += 1
        elif result.status is MatchStatus.FUZZY:
            self.fuzzy += 1
        elif result.status is MatchStatus.AMBIGUOUS:
            self.ambiguous += 1
        else:
            self.no_match += 1
        if result.is_resolved and result.printing_id is not None:
            self.planned_updates.append(
                PlannedUpdate(
                    row_id=row_id,
                    printing_id=result.printing_id,
                    status=result.status,
                    score=round(result.score, 4),
                )
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "table": self.table,
            "total": self.total,
            "exact": self.exact,
            "fuzzy": self.fuzzy,
            "ambiguous": self.ambiguous,
            "no_match": self.no_match,
            "skipped_no_text": self.skipped_no_text,
            "resolved": self.resolved,
            "planned_updates": [
                {
                    "row_id": u.row_id,
                    "printing_id": u.printing_id,
                    "status": u.status.value,
                    "score": u.score,
                }
                for u in self.planned_updates
            ],
        }


def run_backfill(
    rows: Iterable[dict[str, Any]],
    matcher: PrintingMatcher,
    *,
    table: str,
    id_field: str = "id",
) -> BackfillReport:
    """Match every NULL-``printing_id`` row and build a (write-free) report.

    Rows that already have a non-null ``printing_id`` are skipped (the backfill
    only resolves NULLs and never overwrites an existing FK).
    """
    report = BackfillReport(table=table)
    for row in rows:
        if row.get("printing_id") is not None:
            continue
        text = extract_text(row, table)
        row_id = str(row.get(id_field, ""))
        if not text:
            report.skipped_no_text += 1
            report.total += 1
            continue
        result = matcher.match_text(text)
        report.record(row_id, result)
    return report


def apply_updates(
    updates: list[PlannedUpdate],
    *,
    table: str,
    id_field: str = "id",
    dry_run: bool = True,
) -> int:
    """Write resolved ``printing_id``\\s back to the DB.

    Dry-run by default — returns the number of rows that *would* be updated
    without touching the DB.  A live run requires ``dry_run=False`` AND both
    Supabase env vars; otherwise it stays in dry-run and logs a warning.
    """
    if dry_run:
        log.info("dry-run: %d %s rows would be backfilled", len(updates), table)
        return len(updates)

    url = os.environ.get(_SUPABASE_URL_ENV)
    key = os.environ.get(_SERVICE_KEY_ENV)
    if not (url and key):
        log.warning(
            "live backfill requested but %s / %s not set; staying dry-run",
            _SUPABASE_URL_ENV,
            _SERVICE_KEY_ENV,
        )
        return 0

    import httpx  # imported lazily — not needed in dry-run / CI

    base = url.rstrip("/")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    written = 0
    for upd in updates:
        resp = httpx.patch(
            f"{base}/rest/v1/{table}",
            headers=headers,
            params={f"{id_field}": f"eq.{upd.row_id}"},
            content=json.dumps({"printing_id": upd.printing_id}),
        )
        if resp.status_code in (200, 204):
            written += 1
        else:
            log.error(
                "backfill PATCH failed for %s id=%s: %s",
                table,
                upd.row_id,
                resp.status_code,
            )
    return written


# ---------------------------------------------------------------------------
# Fixture loading (mock mode)
# ---------------------------------------------------------------------------


def load_catalog_fixture() -> list[CanonicalPrinting]:
    data = json.loads((_FIXTURES_DIR / "catalog.json").read_text())
    return [
        CanonicalPrinting(
            printing_id=p["printing_id"],
            card_name=p["card_name"],
            set_name=p["set_name"],
            set_code=p.get("set_code", ""),
            number=p["number"],
            language=p.get("language", "en"),
            variant_code=p.get("variant_code", ""),
            variant_flags=tuple(p.get("variant_flags", [])),
        )
        for p in data
    ]


def load_rows_fixture() -> dict[str, list[dict[str, Any]]]:
    return json.loads((_FIXTURES_DIR / "null_rows.json").read_text())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="binderly-backfill-printing-match",
        description="Resolve NULL printing_id on grading observation rows (#FU-40).",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Disable dry-run and issue live UPDATEs (requires Supabase env vars).",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    matcher = PrintingMatcher(load_catalog_fixture())
    rows_by_table = load_rows_fixture()

    summary: dict[str, Any] = {"dry_run": not args.live, "tables": {}}
    total_written = 0
    for table, rows in rows_by_table.items():
        report = run_backfill(rows, matcher, table=table)
        written = apply_updates(
            report.planned_updates, table=table, dry_run=not args.live
        )
        total_written += written
        summary["tables"][table] = report.to_dict()

    summary["total_written"] = total_written
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
