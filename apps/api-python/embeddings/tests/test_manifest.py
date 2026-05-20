"""Tests for the embedding manifest schema."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from embeddings.manifest import (
    EmbeddingManifest,
    ManifestValidationError,
    compute_model_hash,
    load_manifest,
    utc_now_iso8601,
    write_manifest,
)


_VALID_HASH = "a" * 64


def _valid_payload() -> dict:
    return {
        "name": "mobilenet-v3-small",
        "version": "1.0.0",
        "modelHash": _VALID_HASH,
        "inputShape": [1, 224, 224, 3],
        "embeddingDim": 576,
        "normalization": "mobilenet_v3",
        "createdAt": "2026-05-20T09:30:00.000Z",
        "sourceUrl": "https://example.com/m.tflite",
    }


class TestEmbeddingManifest:
    def test_accepts_valid_payload(self) -> None:
        manifest = EmbeddingManifest.model_validate(_valid_payload())
        assert manifest.name == "mobilenet-v3-small"
        assert manifest.embeddingDim == 576

    def test_round_trip_through_json(self) -> None:
        manifest = EmbeddingManifest.model_validate(_valid_payload())
        as_json = json.dumps(manifest.model_dump(mode="json"))
        rehydrated = EmbeddingManifest.model_validate(json.loads(as_json))
        assert rehydrated == manifest

    def test_rejects_unknown_fields(self) -> None:
        payload = {**_valid_payload(), "extra": "nope"}
        with pytest.raises(Exception):
            EmbeddingManifest.model_validate(payload)

    @pytest.mark.parametrize(
        "field,bad_value",
        [
            ("name", ""),
            ("version", ""),
            ("modelHash", "too-short"),
            ("modelHash", "g" * 64),  # not hex
            ("embeddingDim", 0),
            ("embeddingDim", -1),
            ("inputShape", [1, 224, 224]),  # only 3 dims
            ("inputShape", [1, 224, 224, 3, 1]),  # 5 dims
            ("inputShape", [1, 0, 224, 3]),  # zero entry
            ("normalization", ""),
            ("createdAt", "not-a-date"),
        ],
    )
    def test_rejects_invalid_field(self, field: str, bad_value: object) -> None:
        payload = {**_valid_payload(), field: bad_value}
        with pytest.raises(Exception):
            EmbeddingManifest.model_validate(payload)

    def test_source_url_is_optional(self) -> None:
        payload = {**_valid_payload(), "sourceUrl": None}
        manifest = EmbeddingManifest.model_validate(payload)
        assert manifest.sourceUrl is None

    def test_model_hash_normalised_to_lowercase(self) -> None:
        payload = {**_valid_payload(), "modelHash": "A" * 64}
        manifest = EmbeddingManifest.model_validate(payload)
        assert manifest.modelHash == "a" * 64


class TestLoadManifest:
    def test_load_round_trips(self, tmp_path: Path) -> None:
        manifest = EmbeddingManifest.model_validate(_valid_payload())
        target = tmp_path / "manifest.json"
        write_manifest(manifest, target)

        loaded = load_manifest(target)
        assert loaded == manifest

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ManifestValidationError, match="not found"):
            load_manifest(tmp_path / "nope.json")

    def test_invalid_json_raises(self, tmp_path: Path) -> None:
        target = tmp_path / "bad.json"
        target.write_text("not json", encoding="utf-8")
        with pytest.raises(ManifestValidationError, match="not valid JSON"):
            load_manifest(target)

    def test_non_object_root_raises(self, tmp_path: Path) -> None:
        target = tmp_path / "arr.json"
        target.write_text("[1, 2, 3]", encoding="utf-8")
        with pytest.raises(ManifestValidationError, match="must be a JSON object"):
            load_manifest(target)

    def test_schema_violation_raises(self, tmp_path: Path) -> None:
        bad = {**_valid_payload(), "embeddingDim": -10}
        target = tmp_path / "bad.json"
        target.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(ManifestValidationError):
            load_manifest(target)


class TestComputeModelHash:
    def test_hash_is_deterministic(self, tmp_path: Path) -> None:
        target = tmp_path / "blob.bin"
        target.write_bytes(b"binderly-test")
        assert compute_model_hash(target) == compute_model_hash(target)

    def test_hash_changes_with_bytes(self, tmp_path: Path) -> None:
        a = tmp_path / "a.bin"
        b = tmp_path / "b.bin"
        a.write_bytes(b"binderly-a")
        b.write_bytes(b"binderly-b")
        assert compute_model_hash(a) != compute_model_hash(b)

    def test_hash_is_64_hex(self, tmp_path: Path) -> None:
        target = tmp_path / "blob.bin"
        target.write_bytes(b"binderly")
        digest = compute_model_hash(target)
        assert len(digest) == 64
        int(digest, 16)


class TestUtcNowHelper:
    def test_returns_string_ending_in_z(self) -> None:
        s = utc_now_iso8601()
        assert s.endswith("Z")
        # Parse round-trip.
        EmbeddingManifest.model_validate({**_valid_payload(), "createdAt": s})


def test_fixture_manifest_loads(manifest_path: Path) -> None:
    """The committed fixture manifest is valid against the schema."""

    manifest = load_manifest(manifest_path)
    assert manifest.name == "tiny-embedder"
    assert manifest.embeddingDim == 32
    assert manifest.inputShape == [1, 224, 224, 3]
