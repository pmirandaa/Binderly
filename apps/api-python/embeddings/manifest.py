"""Manifest schema for embedding model artefacts.

The manifest is the on-the-wire contract between the offline TFLite
builder (Python) and the on-device loader (TypeScript). It lives next
to the ``.tflite`` file and pins down:

- Identity: ``name`` + ``version`` form the cache key in R2.
- Topology: ``inputShape`` + ``embeddingDim`` — the on-device loader
  rejects any model whose interpreter output disagrees with
  ``embeddingDim``.
- Preprocessing: ``normalization`` names which preprocessor recipe
  was used at training/conversion time. Both Python and TS share the
  same recipe list (``PREPROCESSING_NAMES`` in :mod:`embeddings.normalize`).
- Integrity: ``modelHash`` is the SHA-256 of the bytes of the
  ``.tflite`` file. Mismatches mean the artefact was tampered with
  or corrupted in transit.
- Provenance: ``sourceUrl`` is the upstream source of the weights, for
  audit. Optional for forks / fine-tunes.

The schema is intentionally minimal — it must round-trip cleanly
through both pydantic and the Zod schema in
``apps/mobile/src/scanner/embed/manifest.ts``. Adding a field requires
updating both sides.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class ManifestValidationError(ValueError):
    """Raised when a manifest file does not match the schema."""


class EmbeddingManifest(BaseModel):
    """Pydantic representation of a `manifest.json` next to a TFLite file."""

    model_config = ConfigDict(
        # Reject unknown fields rather than silently accepting them — if
        # we add a field we want both Python and TypeScript to gate on it
        # explicitly, not silently shrug.
        extra="forbid",
        # Keep camelCase on the wire (matches the TS Zod schema).
        populate_by_name=True,
    )

    name: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    modelHash: str = Field(..., min_length=64, max_length=64)
    inputShape: list[int] = Field(..., min_length=4, max_length=4)
    embeddingDim: int = Field(..., gt=0)
    normalization: str = Field(..., min_length=1)
    createdAt: str = Field(..., min_length=1)
    sourceUrl: str | None = Field(default=None)

    @field_validator("modelHash")
    @classmethod
    def _hash_is_hex(cls, value: str) -> str:
        try:
            int(value, 16)
        except ValueError as exc:  # pragma: no cover - guarded by length too
            raise ValueError("modelHash must be a 64-char hex SHA-256") from exc
        return value.lower()

    @field_validator("inputShape")
    @classmethod
    def _input_shape_positive(cls, value: list[int]) -> list[int]:
        if any(dim <= 0 for dim in value):
            raise ValueError("inputShape entries must all be positive integers")
        return value

    @field_validator("createdAt")
    @classmethod
    def _created_at_iso8601(cls, value: str) -> str:
        # Accept the trailing-`Z` form that the JS Date.toISOString() emits.
        candidate = value.replace("Z", "+00:00") if value.endswith("Z") else value
        try:
            datetime.fromisoformat(candidate)
        except ValueError as exc:
            raise ValueError("createdAt must be ISO-8601") from exc
        return value


def compute_model_hash(model_path: str | Path) -> str:
    """Return the SHA-256 hex digest of the bytes at ``model_path``."""

    path = Path(model_path)
    sha = hashlib.sha256()
    with path.open("rb") as fh:
        # 1 MiB chunks — TFLite files in our regime are < 25 MB so this
        # is plenty fast.
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def write_manifest(manifest: EmbeddingManifest, path: str | Path) -> None:
    """Serialise the manifest to ``path`` as pretty-printed JSON."""

    Path(path).write_text(
        json.dumps(manifest.model_dump(mode="json"), indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def load_manifest(path: str | Path) -> EmbeddingManifest:
    """Load + validate a manifest JSON file.

    Raises :class:`ManifestValidationError` if the file cannot be parsed
    or fails schema validation. The error chain preserves the original
    :class:`pydantic.ValidationError` for callers that need granular
    field reporting.
    """

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
        return EmbeddingManifest.model_validate(raw)
    except ValidationError as exc:
        raise ManifestValidationError(str(exc)) from exc


def utc_now_iso8601() -> str:
    """Helper used by the build scripts so their `createdAt` is consistent."""

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
