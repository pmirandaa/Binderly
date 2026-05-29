"""Ingestion tests — build → validate → normalise → dedup → upsert.

All offline: ``db_upsert_fn`` appends to a list, no network/storage.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from grading.flywheel.ingest import (
    FlywheelJobResult,
    SubmissionConflict,
    build_training_sample_row,
    default_image_handler,
    live_images_enabled,
    run_ingestion,
)
from grading.flywheel.types import CommunitySubmission

# The training corpus loaders are consumed read-only to prove the produced row
# is loadable by the existing ml_common pipeline.
from grading.ml_common.data_loader import PSADataLoader
from grading.ml_common.types import LabelledGradingSample


class TestBuildTrainingSampleRow:
    def test_source_tag_is_community_flywheel(self, valid_submission):
        row = build_training_sample_row(valid_submission)
        assert row["source"] == "community_flywheel"

    def test_source_id_is_company_cert(self, valid_submission):
        row = build_training_sample_row(valid_submission)
        assert row["source_id"] == "PSA:12345678"

    def test_grade_company_uppercased(self, make_submission):
        row = build_training_sample_row(make_submission(grade_company="psa"))
        assert row["grade_company"] == "PSA"

    def test_printing_id_is_none(self, valid_submission):
        # Catalog matching deferred to #FU-40, same as the scrapers.
        assert build_training_sample_row(valid_submission)["printing_id"] is None

    def test_source_url_is_none(self, valid_submission):
        assert build_training_sample_row(valid_submission)["source_url"] is None

    def test_parse_confidence_is_one(self, valid_submission):
        # A real slab is authoritative.
        assert build_training_sample_row(valid_submission)["parse_confidence"] == 1.0

    def test_grade_normalised(self, make_submission):
        row = build_training_sample_row(make_submission(overall_grade=8.3))
        assert row["grade"] == 8.5

    def test_images_refs_only(self, valid_submission):
        row = build_training_sample_row(valid_submission)
        assert row["images"]["front"].startswith("https://")
        assert isinstance(row["images"]["corners"], list)
        assert "slab" in row["images"]

    def test_raw_metadata_preserves_provenance(self, make_submission):
        sub = make_submission(
            overall_grade=9.0,
            raw_grade_label="PSA 9",
            user_id="user-xyz",
            submitted_at=datetime(2026, 5, 29, tzinfo=timezone.utc),
        )
        row = build_training_sample_row(sub)
        meta = row["raw_metadata"]
        assert meta["cert_number"] == "12345678"
        assert meta["raw_overall_grade"] == 9.0
        assert meta["raw_grade_label"] == "PSA 9"
        assert meta["user_id"] == "user-xyz"
        assert meta["calibration"] == "raw_per_company_v1"
        assert meta["submitted_at"].startswith("2026-05-29")

    def test_black_label_produces_perfect_subgrades(self, make_submission):
        sub = make_submission(
            grade_company="BGS",
            cert_number="0015384312",
            overall_grade=None,
            black_label=True,
        )
        row = build_training_sample_row(sub)
        assert row["grade"] == 10.0
        assert row["subgrades"] == {
            "centering": 10.0,
            "corners": 10.0,
            "edges": 10.0,
            "surface": 10.0,
        }

    def test_row_loadable_by_psa_data_loader(self, make_submission):
        sub = make_submission(
            overall_grade=9.0,
            subgrades={"corners": 9.5},
        )
        row = build_training_sample_row(sub)
        # PSADataLoader reads grading_training_sample rows and filters PSA.
        samples = PSADataLoader([row]).load()
        assert len(samples) == 1
        sample = samples[0]
        assert isinstance(sample, LabelledGradingSample)
        assert sample.source == "psa_cert"  # loader re-tags by table
        assert sample.grade_company == "PSA"
        assert sample.corners_score == 9.5
        assert sample.overall_grade == 9.0
        assert sample.is_labelled_for_corners()


class TestImageHandler:
    def test_default_handler_passes_refs(self, valid_submission):
        images = default_image_handler(valid_submission)
        assert images["front"].startswith("https://")
        assert images["back"].startswith("https://")
        assert len(images["corners"]) == 2

    def test_default_handler_drops_empty(self, make_submission):
        sub = make_submission(image_urls={"front": "https://x/f.jpg", "back": "https://x/b.jpg", "surface": ""})
        images = default_image_handler(sub)
        assert "surface" not in images

    def test_custom_handler_invoked(self, make_submission, upsert_store, upsert_fn):
        def handler(_sub):
            return {"front": "transcoded://abc"}

        run_ingestion([make_submission()], db_upsert_fn=upsert_fn, image_handler=handler)
        assert upsert_store[0]["images"] == {"front": "transcoded://abc"}


class TestRunIngestionHappyPath:
    def test_single_submission_inserts_one(self, valid_submission, upsert_store, upsert_fn):
        result = run_ingestion([valid_submission], db_upsert_fn=upsert_fn)
        assert result.inserted == 1
        assert result.processed == 1
        assert len(upsert_store) == 1

    def test_multiple_submissions(self, make_submission, upsert_store, upsert_fn):
        subs = [
            make_submission(cert_number="12345678"),
            make_submission(cert_number="87654321"),
            make_submission(grade_company="BGS", cert_number="0015384312"),
        ]
        result = run_ingestion(subs, db_upsert_fn=upsert_fn)
        assert result.inserted == 3
        assert len(upsert_store) == 3

    def test_empty_batch(self, upsert_store, upsert_fn):
        result = run_ingestion([], db_upsert_fn=upsert_fn)
        assert result.processed == 0
        assert upsert_store == []

    def test_accepts_raw_dicts(self, upsert_store, upsert_fn):
        row = {
            "grade_company": "PSA",
            "cert_number": "12345678",
            "overall_grade": 9.0,
            "image_urls": {"front": "https://x/f.jpg", "back": "https://x/b.jpg"},
            "consent": True,
        }
        result = run_ingestion([row], db_upsert_fn=upsert_fn)
        assert result.inserted == 1
        assert upsert_store[0]["source_id"] == "PSA:12345678"


class TestDedup:
    def test_existing_updates_not_inserts(self, valid_submission, upsert_store, upsert_fn):
        result = run_ingestion(
            [valid_submission],
            db_upsert_fn=upsert_fn,
            existing_source_ids_fn=lambda sid: True,
        )
        assert result.updated == 1
        assert result.inserted == 0
        assert len(upsert_store) == 1  # still upserts to refresh

    def test_skip_existing_skips(self, valid_submission, upsert_store, upsert_fn):
        result = run_ingestion(
            [valid_submission],
            db_upsert_fn=upsert_fn,
            existing_source_ids_fn=lambda sid: True,
            skip_existing=True,
        )
        assert result.skipped_existing == 1
        assert result.inserted == 0
        assert upsert_store == []

    def test_duplicate_certs_same_source_id(self, make_submission, upsert_store, upsert_fn):
        subs = [
            make_submission(cert_number="PSA 1234-5678"),
            make_submission(cert_number="12345678"),
        ]
        run_ingestion(subs, db_upsert_fn=upsert_fn)
        assert upsert_store[0]["source_id"] == upsert_store[1]["source_id"] == "PSA:12345678"

    def test_dedup_against_real_existing_set(self, make_submission, upsert_store, upsert_fn):
        seen: set[str] = set()

        def exists(sid: str) -> bool:
            return sid in seen

        def upsert(row):
            seen.add(row["source_id"])
            upsert_store.append(row)

        first = run_ingestion(
            [make_submission(cert_number="12345678")],
            db_upsert_fn=upsert,
            existing_source_ids_fn=exists,
            skip_existing=True,
        )
        second = run_ingestion(
            [make_submission(cert_number="12345678")],
            db_upsert_fn=upsert,
            existing_source_ids_fn=exists,
            skip_existing=True,
        )
        assert first.inserted == 1
        assert second.skipped_existing == 1
        assert len(upsert_store) == 1


class TestRejection:
    def test_invalid_submission_rejected(self, make_submission, upsert_store, upsert_fn):
        result = run_ingestion([make_submission(consent=False)], db_upsert_fn=upsert_fn)
        assert result.rejected == 1
        assert result.inserted == 0
        assert upsert_store == []
        assert result.conflicts[0].reason == "validation_failed"

    def test_bad_cert_rejected(self, make_submission, upsert_store, upsert_fn):
        result = run_ingestion([make_submission(cert_number="ABC")], db_upsert_fn=upsert_fn)
        assert result.rejected == 1
        assert "cert_number" in result.conflicts[0].detail

    def test_valid_and_invalid_mixed(self, make_submission, upsert_store, upsert_fn):
        subs = [
            make_submission(cert_number="12345678"),
            make_submission(consent=False),
            make_submission(grade_company="BGS", cert_number="0015384312"),
        ]
        result = run_ingestion(subs, db_upsert_fn=upsert_fn)
        assert result.inserted == 2
        assert result.rejected == 1
        assert len(upsert_store) == 2

    def test_db_error_recorded_as_conflict(self, valid_submission):
        def boom(_row):
            raise RuntimeError("connection lost")

        result = run_ingestion([valid_submission], db_upsert_fn=boom)
        assert result.rejected == 1
        assert result.inserted == 0
        assert result.conflicts[0].reason == "db_upsert_error"
        assert "connection lost" in (result.conflicts[0].detail or "")


class TestResultTypes:
    def test_result_types(self, valid_submission, upsert_fn):
        result = run_ingestion([valid_submission], db_upsert_fn=upsert_fn)
        assert isinstance(result, FlywheelJobResult)
        assert isinstance(result.conflicts, list)

    def test_conflict_is_dataclass(self, make_submission, upsert_fn):
        result = run_ingestion([make_submission(consent=False)], db_upsert_fn=upsert_fn)
        conflict = result.conflicts[0]
        assert isinstance(conflict, SubmissionConflict)
        assert conflict.grade_company == "PSA"


class TestFromRow:
    def test_from_row_parses_iso_datetime(self):
        sub = CommunitySubmission.from_row(
            {
                "grade_company": "PSA",
                "cert_number": "12345678",
                "overall_grade": "9.0",
                "submitted_at": "2026-05-29T12:00:00Z",
                "consent": True,
            }
        )
        assert sub.overall_grade == 9.0
        assert sub.submitted_at is not None
        assert sub.submitted_at.year == 2026

    def test_from_row_filters_unknown_subgrade_keys(self):
        sub = CommunitySubmission.from_row(
            {
                "grade_company": "BGS",
                "cert_number": "0015384312",
                "subgrades": {"corners": 9.5, "bogus": 1.0},
                "consent": True,
            }
        )
        assert sub.subgrades == {"corners": 9.5}

    def test_from_row_tolerates_missing_optionals(self):
        sub = CommunitySubmission.from_row({"grade_company": "PSA", "cert_number": "1"})
        assert sub.consent is False
        assert sub.subgrades is None
        assert sub.overall_grade is None


class TestLiveGate:
    def test_live_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("FLYWHEEL_LIVE_IMAGES", raising=False)
        assert live_images_enabled() is False

    def test_live_enabled_when_set(self, monkeypatch):
        monkeypatch.setenv("FLYWHEEL_LIVE_IMAGES", "1")
        assert live_images_enabled() is True

    def test_ingestion_does_no_io_by_default(self, valid_submission, upsert_fn, monkeypatch):
        # No network/storage modules are touched; default handler is refs-only.
        monkeypatch.delenv("FLYWHEEL_LIVE_IMAGES", raising=False)
        result = run_ingestion([valid_submission], db_upsert_fn=upsert_fn)
        assert result.inserted == 1
