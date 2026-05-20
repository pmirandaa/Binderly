"""Offline ANN index builder.

Reads the ``.npz`` produced by
:mod:`embeddings.scripts.build_card_embeddings` and emits the binary
+ manifest pair on disk.

The builder validates the upstream contract aggressively — recall@K
on the mobile side depends on the embeddings being L2-normalised and
typed correctly, and the test suite for the upstream pipeline already
guarantees this; we still check at build time so a bad ``.npz`` fails
loudly rather than producing a silently-corrupt index.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ann.format import (
    DTYPE_FLOAT16,
    DTYPE_FLOAT32,
    dtype_tag_for_name,
    pack_index,
)
from ann.manifest import (
    AnnManifest,
    compute_index_hash,
    utc_now_iso8601,
    write_manifest,
)


class IndexBuildError(RuntimeError):
    """Raised when the upstream ``.npz`` cannot be packed into an index."""


@dataclass(frozen=True)
class BuildResult:
    """Lightweight summary of a successful build."""

    manifest: AnnManifest
    index_path: Path
    manifest_path: Path


# Stage rule envelope: per-language ANN indices ship as a single binary
# file with a < 100 MB total disk budget. We enforce a 90 % "soft"
# ceiling here so the manifest write isn't the first place a too-big
# index surfaces.
_INDEX_SIZE_SOFT_CEILING_BYTES: int = 90 * 1024 * 1024


_EXPECTED_NPZ_KEYS: tuple[str, ...] = (
    "printing_ids",
    "embeddings",
    "model_name",
    "model_version",
    "model_hash",
)


def _load_npz(path: Path) -> dict[str, np.ndarray]:
    if not path.exists():
        raise IndexBuildError(f"embeddings npz not found: {path}")
    try:
        npz = np.load(path, allow_pickle=False)
    except (ValueError, OSError) as exc:
        raise IndexBuildError(f"failed to read {path}: {exc}") from exc

    missing = [key for key in _EXPECTED_NPZ_KEYS if key not in npz.files]
    if missing:
        raise IndexBuildError(
            f"npz at {path} is missing required keys {missing}; "
            f"got {sorted(npz.files)}"
        )
    return {key: npz[key] for key in _EXPECTED_NPZ_KEYS}


def _validate_payload(payload: dict[str, np.ndarray]) -> None:
    printing_ids = payload["printing_ids"]
    embeddings = payload["embeddings"]

    if printing_ids.ndim != 1:
        raise IndexBuildError(
            f"printing_ids must be 1-D, got shape {printing_ids.shape!r}"
        )
    if embeddings.ndim != 2:
        raise IndexBuildError(
            f"embeddings must be 2-D, got shape {embeddings.shape!r}"
        )
    if printing_ids.shape[0] != embeddings.shape[0]:
        raise IndexBuildError(
            f"printing_ids count {printing_ids.shape[0]} disagrees with "
            f"embeddings count {embeddings.shape[0]}"
        )
    if not np.issubdtype(embeddings.dtype, np.floating):
        raise IndexBuildError(
            f"embeddings dtype must be floating, got {embeddings.dtype}"
        )

    if embeddings.shape[0] > 0:
        # Confirm rows are L2-normalised; this is the contract the
        # upstream pipeline guarantees and what cosine == dot relies
        # on. Slack tolerance matches the upstream pipeline's check.
        as_float32 = embeddings.astype(np.float32, copy=False)
        norms = np.linalg.norm(as_float32, axis=1)
        if not np.allclose(norms, 1.0, atol=1e-3):
            delta = float(np.max(np.abs(norms - 1.0)))
            raise IndexBuildError(
                "embeddings are not L2-normalised "
                f"(max |‖v‖₂ − 1| = {delta:.6f}); "
                f"upstream build_card_embeddings.py should have produced unit-norm rows"
            )


def _id_length_for(printing_ids: np.ndarray, *, override: int | None) -> int:
    if printing_ids.shape[0] == 0:
        # Empty catalog — use whatever the override says, or 36 (UUID).
        return override if override is not None else 36
    lengths = [len(str(value)) for value in printing_ids.tolist()]
    natural = max(lengths)
    if override is None:
        return natural
    if override < natural:
        raise IndexBuildError(
            f"id_length override {override} is smaller than the longest "
            f"observed id ({natural} bytes)"
        )
    return override


def build_index(
    *,
    embeddings_npz: str | Path,
    output_dir: str | Path,
    name: str,
    version: str,
    dtype: str = "float16",
    id_length: int | None = None,
) -> BuildResult:
    """Build an ANN index from an upstream embeddings ``.npz``.

    Writes ``<output_dir>/index.bin`` and
    ``<output_dir>/index.manifest.json``. Returns a :class:`BuildResult`
    referencing both paths and the validated manifest.

    ``dtype`` defaults to ``float16`` to keep the bundle small; pass
    ``float32`` for a lossless build (used by the recall benchmark).
    """

    embeddings_path = Path(embeddings_npz)
    output_root = Path(output_dir)

    dtype_tag = dtype_tag_for_name(dtype)
    if dtype_tag not in (DTYPE_FLOAT32, DTYPE_FLOAT16):
        raise IndexBuildError(f"unsupported dtype {dtype!r}")

    payload = _load_npz(embeddings_path)
    _validate_payload(payload)

    printing_ids: np.ndarray = payload["printing_ids"]
    embeddings: np.ndarray = payload["embeddings"]

    # Force float32 for the in-memory view; pack_index will downcast
    # to float16 if requested.
    embeddings_f32 = np.ascontiguousarray(
        embeddings.astype(np.float32, copy=False)
    )
    ids_list = [str(value) for value in printing_ids.tolist()]
    effective_id_length = _id_length_for(printing_ids, override=id_length)

    buffer = pack_index(
        ids=ids_list,
        embeddings=embeddings_f32,
        id_length=effective_id_length,
        dtype_tag=dtype_tag,
    )

    if len(buffer) > _INDEX_SIZE_SOFT_CEILING_BYTES:
        raise IndexBuildError(
            f"packed index is {len(buffer) / (1024 * 1024):.1f} MB — "
            f"exceeds the {_INDEX_SIZE_SOFT_CEILING_BYTES / (1024 * 1024):.0f} MB "
            "soft ceiling (stage rule budget is <100 MB)."
        )

    output_root.mkdir(parents=True, exist_ok=True)
    index_path = output_root / "index.bin"
    manifest_path = output_root / "index.manifest.json"
    index_path.write_bytes(buffer)

    embedding_model_hash = str(payload["model_hash"].item())
    manifest = AnnManifest(
        name=name,
        version=version,
        embeddingModelName=str(payload["model_name"].item()),
        embeddingModelVersion=str(payload["model_version"].item()),
        embeddingModelHash=embedding_model_hash,
        dim=int(embeddings_f32.shape[1]),
        count=int(embeddings_f32.shape[0]),
        dtype=dtype,
        idLength=effective_id_length,
        indexHash=compute_index_hash(buffer),
        format="flat",
        metric="cosine",
        createdAt=utc_now_iso8601(),
    )
    write_manifest(manifest, manifest_path)

    return BuildResult(
        manifest=manifest,
        index_path=index_path,
        manifest_path=manifest_path,
    )
