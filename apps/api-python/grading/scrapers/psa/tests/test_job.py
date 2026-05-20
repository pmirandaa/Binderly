"""Tests for ``run_job`` — the PSA cert scraper job runner.

``run_job`` is tested purely against fixture HTML — no live network calls,
no real DB.  ``fetch_fn`` and ``db_upsert_fn`` are in-process stubs.
"""

from __future__ import annotations

import hashlib

import pytest

from grading.scrapers.psa.client import TosBlockError
from grading.scrapers.psa.job import DataConflict, JobResult, run_job


# ── stubs ─────────────────────────────────────────────────────────────────────

def _make_fetch_fn(html_map: dict[str, bytes]):
    """Return a fetch stub that looks up HTML by cert number."""
    def fetch(cert_number: str) -> bytes:
        if cert_number not in html_map:
            raise KeyError(f"No fixture for cert {cert_number!r}")
        return html_map[cert_number]
    return fetch


def _make_upsert_fn(store: list[dict]):
    """Return a DB upsert stub that appends rows to ``store``."""
    def upsert(row: dict) -> None:
        store.append(row)
    return upsert


# ── tests ──────────────────────────────────────────────────────────────────────

class TestRunJobBasic:
    def test_single_cert_produces_one_row(self, html_psa10):
        store: list[dict] = []
        result = run_job(
            ["44001234"],
            fetch_fn=_make_fetch_fn({"44001234": html_psa10}),
            db_upsert_fn=_make_upsert_fn(store),
        )
        assert result.processed == 1
        assert len(store) == 1

    def test_row_source_is_psa_cert(self, html_psa10):
        store: list[dict] = []
        run_job(
            ["44001234"],
            fetch_fn=_make_fetch_fn({"44001234": html_psa10}),
            db_upsert_fn=_make_upsert_fn(store),
        )
        assert store[0]["source"] == "psa_cert"

    def test_row_source_id_is_cert_number(self, html_psa10):
        store: list[dict] = []
        run_job(
            ["44001234"],
            fetch_fn=_make_fetch_fn({"44001234": html_psa10}),
            db_upsert_fn=_make_upsert_fn(store),
        )
        assert store[0]["source_id"] == "44001234"

    def test_multiple_certs_all_processed(self, html_psa10, html_psa9, html_authentic):
        store: list[dict] = []
        result = run_job(
            ["44001234", "22009876", "33012345"],
            fetch_fn=_make_fetch_fn({
                "44001234": html_psa10,
                "22009876": html_psa9,
                "33012345": html_authentic,
            }),
            db_upsert_fn=_make_upsert_fn(store),
        )
        assert result.processed == 3
        assert len(store) == 3

    def test_empty_input_returns_zero(self):
        store: list[dict] = []
        result = run_job(
            [],
            fetch_fn=_make_fetch_fn({}),
            db_upsert_fn=_make_upsert_fn(store),
        )
        assert result.processed == 0
        assert store == []


class TestDeduplication:
    def test_same_sha256_skips_upsert(self, html_psa10):
        store: list[dict] = []
        sha256 = hashlib.sha256(html_psa10).hexdigest()

        result = run_job(
            ["44001234"],
            fetch_fn=_make_fetch_fn({"44001234": html_psa10}),
            db_upsert_fn=_make_upsert_fn(store),
            existing_sha256_fn=lambda cert: sha256,  # same hash → skip
        )

        assert result.processed == 0
        assert result.skipped_unchanged == 1
        assert store == []

    def test_different_sha256_triggers_upsert(self, html_psa10):
        store: list[dict] = []

        result = run_job(
            ["44001234"],
            fetch_fn=_make_fetch_fn({"44001234": html_psa10}),
            db_upsert_fn=_make_upsert_fn(store),
            existing_sha256_fn=lambda cert: "0" * 64,  # different hash → upsert
        )

        assert result.processed == 1
        assert result.skipped_unchanged == 0

    def test_no_existing_sha256_always_upserts(self, html_psa10):
        store: list[dict] = []

        result = run_job(
            ["44001234"],
            fetch_fn=_make_fetch_fn({"44001234": html_psa10}),
            db_upsert_fn=_make_upsert_fn(store),
            existing_sha256_fn=lambda cert: None,
        )

        assert result.processed == 1


class TestTosBlockHalt:
    def test_tos_block_propagates(self, html_cloudflare_block):
        """TosBlockError must bubble up to halt the batch."""
        store: list[dict] = []

        def blocking_fetch(cert_number: str) -> bytes:
            from grading.scrapers.psa.parser import PsaParser
            if PsaParser.is_blocked(html_cloudflare_block):
                raise TosBlockError(cert_number, status_code=403)
            return html_cloudflare_block

        with pytest.raises(TosBlockError):
            run_job(
                ["99999999"],
                fetch_fn=blocking_fetch,
                db_upsert_fn=_make_upsert_fn(store),
            )

        assert store == []


class TestFetchError:
    def test_network_error_logs_conflict_continues(self, html_psa9):
        store: list[dict] = []
        call_count = 0

        def flaky_fetch(cert_number: str) -> bytes:
            nonlocal call_count
            call_count += 1
            if cert_number == "BAD00001":
                raise ConnectionError("simulated network error")
            return html_psa9

        result = run_job(
            ["BAD00001", "22009876"],
            fetch_fn=flaky_fetch,
            db_upsert_fn=_make_upsert_fn(store),
        )

        # The bad cert is logged as a conflict, but the good cert is processed.
        assert result.processed == 1
        assert len(result.data_conflicts) == 1
        assert result.data_conflicts[0].cert_number == "BAD00001"
        assert result.data_conflicts[0].reason == "fetch_error"


class TestDataConflictRecording:
    def test_authentic_grade_no_conflict(self, html_authentic):
        """Authentic grade is valid — no data conflict expected."""
        store: list[dict] = []
        result = run_job(
            ["33012345"],
            fetch_fn=_make_fetch_fn({"33012345": html_authentic}),
            db_upsert_fn=_make_upsert_fn(store),
        )
        assert result.processed == 1
        assert result.data_conflicts == []

    def test_job_result_has_correct_types(self, html_psa10):
        store: list[dict] = []
        result = run_job(
            ["44001234"],
            fetch_fn=_make_fetch_fn({"44001234": html_psa10}),
            db_upsert_fn=_make_upsert_fn(store),
        )
        assert isinstance(result, JobResult)
        assert isinstance(result.data_conflicts, list)
