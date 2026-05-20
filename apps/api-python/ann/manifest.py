"""Pydantic schema for the ANN index manifest.

The manifest lives next to ``index.bin`` and pins down everything the
on-device runtime needs to validate the bundled asset:

- **Identity**: ``name`` + ``version`` form the cache key.
- **Compatibility**: ``embeddingModelName`` / ``embeddingModelVersion``
  / ``embeddingModelHash`` are copied verbatim from the upstream
  embedding manifest (:mod:`embeddings.manifest`). The on-device
  loader refuses to pair this index with an embedding model whose
  identity disagrees.
- **Topology**: ``dim`` (must equal the embedding model's
  ``embeddingDim``) and ``count``.
- **Storage**: ``dtype`` is one of ``float32`` / ``float16``,
  ``idLength`` is the fixed-width ASCII byte length per printing id
  (UUIDs are 36 bytes; that's the v1 default).
- **Format**: ``format`` is ``flat`` for v1 — reserved values
  ``hnsw`` / ``pq`` are gated for future migration.
- **Metric**: ``cosine`` (the only one for v1).
- **Integrity**: ``indexHash`` is the SHA-256 hex digest of the
  ``index.bin`` bytes; mismatch means corruption.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


_INDEX_DTYPES = ("float32", "float16")
_INDEX_FORMATS = ("flat", "hnsw", "pq")
_INDEX_METRICS = ("cosine",)


class ManifestValidationError(ValueError):
    """Raised when a manifest file does not match the schema."""


class AnnManifest(BaseModel):
    """Pydantic representation of an ``index.manifest.json`` file."""

    model_config = ConfigDict(
        # Keep camelCase on the wire (mirrors Zod naming on mobile).
        extra="forbid",
        populate_by_name=True,
    )

    name: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)

    embeddingModelName: str = Field(..., min_length=1)
    embeddingModelVersion: str = Field(..., min_length=1)
    embeddingModelHash: str = Field(..., min_length=64, max_length=64)

    dim: int = Field(..., gt=0)
    count: int = Field(..., ge=0)
    dtype: Literal["float32", "float16"]
    idLength: int = Field(..., gt=0)

    indexHash: str = Field(..., min_length=64, max_length=64)
    format: Literal["flat", "hnsw", "pq"] = Field(default="flat")
    metric: Literal["cosine"] = Field(default="cosine")
    createdAt: str = Field(..., min_length=1)

    @field_validator("embeddingModelHash", "indexHash")
    @classmethod
    def _hash_is_hex(cls, value: str) -> str:
        try:
            int(value, 16)
        except ValueError as exc:
            raise ValueError("hash must be 64-char hex SHA-256") from exc
        return value.lower()

    @field_validator("createdAt")
    @classmethod
    def _created_at_iso8601(cls, value: str) -> str:
        candidate = value.replace("Z", "+00:00") if value.endswith("Z") else value
        try:
            datetime.fromisoformat(candidate)
        except ValueError as exc:
            raise ValueError("createdAt must be ISO-8601") from exc
        return value


def compute_index_hash(buffer: bytes | bytearray | memoryview) -> str:
    """Return the SHA-256 hex digest of an ``index.bin`` payload."""

    return hashlib.sha256(bytes(buffer)).hexdigest()


def write_manifest(manifest: AnnManifest, path: str | Path) -> None:
    """Serialise the manifest to ``path`` as pretty-printed JSON."""

    Path(path).write_text(
        json.dumps(manifest.model_dump(mode="json"), indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def load_manifest(path: str | Path) -> AnnManifest:
    """Load + validate an ``index.manifest.json`` file."""

    p = Path(path)
    try:
        raw: Any = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ManifestValidationError(f"manifest not found: {p}") from exc
    except json.JSONDecodeError as exc:
        raise ManifestValidationError(f"manifest is not valid JSON: {p}") from exc

    if not isinstance(raw, dict):
        raise ManifestValidationError(
            f"manifest must be a JSON object, got {type(raw).__name__}"
        )

    try:
        return AnnManifest.model_validate(raw)
    except ValidationError as exc:
        raise ManifestValidationError(str(exc)) from exc


def utc_now_iso8601() -> str:
    """Helper used by the build scripts so their ``createdAt`` is consistent."""

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# Expose tuples for tests that want to assert the allowed values
# without coupling to the literal types above.
INDEX_DTYPES: tuple[str, ...] = _INDEX_DTYPES
INDEX_FORMATS: tuple[str, ...] = _INDEX_FORMATS
INDEX_METRICS: tuple[str, ...] = _INDEX_METRICS
