"""Tests for the ANN manifest schema."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ann.manifest import (
    INDEX_DTYPES,
    INDEX_FORMATS,
    INDEX_METRICS,
    AnnManifest,
    ManifestValidationError,
    compute_index_hash,
    load_manifest,
    utc_now_iso8601,
    write_manifest,
)


_VALID_PAYLOAD = {
    "name": "pokemon-en",
    "version": "1.0.0",
    "embeddingModelName": "mobilenet-v3-small",
    "embeddingModelVersion": "1.0.0",
    "embeddingModelHash": "a" * 64,
    "dim": 576,
    "count": 1000,
    "dtype": "float16",
    "idLength": 36,
    "indexHash": "b" * 64,
    "format": "flat",
    "metric": "cosine",
    "createdAt": "2026-05-20T11:00:00.000Z",
}


class TestSchemaHappyPath:
    def test_minimal_payload_validates(self) -> None:
        manifest = AnnManifest.model_validate(_VALID_PAYLOAD)
        assert manifest.dim == 576
        assert manifest.dtype == "float16"
        assert manifest.format == "flat"
        assert manifest.metric == "cosine"

    def test_round_trip_to_disk(self, tmp_path: Path) -> None:
        manifest = AnnManifest.model_validate(_VALID_PAYLOAD)
        path = tmp_path / "index.manifest.json"
        write_manifest(manifest, path)
        loaded = load_manifest(path)
        assert loaded == manifest
        # Confirm hash field is lowercased on validation.
        assert loaded.indexHash == _VALID_PAYLOAD["indexHash"]

    def test_format_and_metric_defaults(self) -> None:
        payload = dict(_VALID_PAYLOAD)
        payload.pop("format")
        payload.pop("metric")
        manifest = AnnManifest.model_validate(payload)
        assert manifest.format == "flat"
        assert manifest.metric == "cosine"

    def test_iso_timestamp_zulu_accepted(self) -> None:
        payload = dict(_VALID_PAYLOAD)
        payload["createdAt"] = utc_now_iso8601()
        manifest = AnnManifest.model_validate(payload)
        assert manifest.createdAt.endswith("Z")


class TestSchemaFailureModes:
    def test_unknown_field_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "extraField": "nope"}
        with pytest.raises(ValidationError, match="Extra inputs"):
            AnnManifest.model_validate(payload)

    def test_bad_hash_length_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "indexHash": "abc"}
        with pytest.raises(ValidationError):
            AnnManifest.model_validate(payload)

    def test_non_hex_hash_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "indexHash": "z" * 64}
        with pytest.raises(ValidationError, match="hex SHA-256"):
            AnnManifest.model_validate(payload)

    def test_bad_dim_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "dim": 0}
        with pytest.raises(ValidationError):
            AnnManifest.model_validate(payload)

    def test_bad_dtype_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "dtype": "uint8"}
        with pytest.raises(ValidationError):
            AnnManifest.model_validate(payload)

    def test_bad_format_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "format": "ivf"}
        with pytest.raises(ValidationError):
            AnnManifest.model_validate(payload)

    def test_bad_metric_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "metric": "euclidean"}
        with pytest.raises(ValidationError):
            AnnManifest.model_validate(payload)

    def test_bad_timestamp_rejected(self) -> None:
        payload = {**_VALID_PAYLOAD, "createdAt": "not-a-date"}
        with pytest.raises(ValidationError, match="ISO-8601"):
            AnnManifest.model_validate(payload)


class TestLoadManifest:
    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ManifestValidationError, match="not found"):
            load_manifest(tmp_path / "nope.json")

    def test_invalid_json_raises(self, tmp_path: Path) -> None:
        path = tmp_path / "manifest.json"
        path.write_text("not-json", encoding="utf-8")
        with pytest.raises(ManifestValidationError, match="not valid JSON"):
            load_manifest(path)

    def test_non_object_raises(self, tmp_path: Path) -> None:
        path = tmp_path / "manifest.json"
        path.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
        with pytest.raises(ManifestValidationError, match="JSON object"):
            load_manifest(path)


class TestHashHelper:
    def test_hash_is_deterministic(self) -> None:
        h1 = compute_index_hash(b"hello")
        h2 = compute_index_hash(b"hello")
        assert h1 == h2
        assert len(h1) == 64

    def test_distinct_inputs_produce_distinct_hashes(self) -> None:
        assert compute_index_hash(b"hello") != compute_index_hash(b"world")


class TestConstants:
    def test_dtype_choices_present(self) -> None:
        assert "float16" in INDEX_DTYPES
        assert "float32" in INDEX_DTYPES

    def test_format_choices_present(self) -> None:
        assert "flat" in INDEX_FORMATS

    def test_metric_is_cosine_only(self) -> None:
        assert INDEX_METRICS == ("cosine",)
