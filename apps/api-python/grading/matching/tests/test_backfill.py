"""Tests for matching/backfill.py — dry-run report + apply guard + CLI."""

from __future__ import annotations

import json

import pytest

from grading.matching.backfill import (
    PlannedUpdate,
    apply_updates,
    extract_text,
    load_rows_fixture,
    main,
    run_backfill,
)
from grading.matching.types import MatchStatus


class TestExtractText:
    def test_nested_path(self):
        row = {"raw_metadata": {"title": "Charizard"}}
        assert extract_text(row, "grading_training_sample") == "Charizard"

    def test_flat_field(self):
        assert extract_text({"title": "x"}, "ebay_graded_listing_observation") == "x"

    def test_lot_title(self):
        assert extract_text({"lot_title": "y"}, "auction_lot_observation") == "y"

    def test_missing_returns_empty(self):
        assert extract_text({}, "grading_training_sample") == ""

    def test_unknown_table_raises(self):
        with pytest.raises(ValueError, match="Unsupported table"):
            extract_text({}, "not_a_table")


class TestRunBackfill:
    def test_resolves_exact_row(self, matcher):
        rows = load_rows_fixture()["grading_training_sample"]
        report = run_backfill(rows, matcher, table="grading_training_sample")
        assert report.exact == 1
        assert report.resolved == 1
        # one row has no title → skipped_no_text
        assert report.skipped_no_text == 1

    def test_skips_already_matched_rows(self, matcher):
        rows = load_rows_fixture()["ebay_graded_listing_observation"]
        report = run_backfill(rows, matcher, table="ebay_graded_listing_observation")
        # ebay-0003 already has a printing_id → not counted at all.
        ids = {u.row_id for u in report.planned_updates}
        assert "ebay-0003" not in ids

    def test_ebay_fuzzy_and_no_match(self, matcher):
        rows = load_rows_fixture()["ebay_graded_listing_observation"]
        report = run_backfill(rows, matcher, table="ebay_graded_listing_observation")
        assert report.fuzzy == 1   # Venusar typo
        assert report.no_match == 1  # Mewtwo

    def test_auction_ambiguous_left_null(self, matcher):
        rows = load_rows_fixture()["auction_lot_observation"]
        report = run_backfill(rows, matcher, table="auction_lot_observation")
        assert report.ambiguous == 1   # plain Charizard #4
        # the Shadowless 1st-edition lot disambiguates → resolved
        assert report.resolved == 1
        resolved_ids = {u.row_id for u in report.planned_updates}
        assert "lot-0001" not in resolved_ids
        assert "lot-0002" in resolved_ids

    def test_report_to_dict_shape(self, matcher):
        rows = load_rows_fixture()["grading_training_sample"]
        report = run_backfill(rows, matcher, table="grading_training_sample")
        d = report.to_dict()
        assert d["table"] == "grading_training_sample"
        assert d["resolved"] == report.resolved
        assert isinstance(d["planned_updates"], list)


class TestApplyUpdates:
    def _updates(self):
        return [
            PlannedUpdate("r1", "p1", MatchStatus.EXACT, 1.0),
            PlannedUpdate("r2", "p2", MatchStatus.FUZZY, 0.9),
        ]

    def test_dry_run_writes_nothing(self):
        n = apply_updates(self._updates(), table="ebay_graded_listing_observation")
        assert n == 2  # counts what *would* be written

    def test_live_without_env_stays_dry(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
        n = apply_updates(
            self._updates(), table="ebay_graded_listing_observation", dry_run=False
        )
        assert n == 0  # refuses to write without credentials


class TestCli:
    def test_main_dry_run_default(self, capsys):
        rc = main([])
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["dry_run"] is True
        assert "grading_training_sample" in out["tables"]
        # Dry-run reports planned writes but writes nothing.
        assert out["total_written"] == sum(
            t["resolved"] for t in out["tables"].values()
        )
