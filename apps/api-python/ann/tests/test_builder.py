"""Tests for the offline ANN index builder."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from ann.builder import IndexBuildError, build_index
from ann.format import DTYPE_FLOAT16, DTYPE_FLOAT32, unpack_index
from ann.manifest import load_manifest


class TestBuildIndexHappyPath:
    def test_builds_float16_artifacts(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        output_dir = tmp_path / "out"
        result = build_index(
            embeddings_npz=synthetic_corpus_npz,
            output_dir=output_dir,
            name="pokemon-en",
            version="1.0.0",
            dtype="float16",
        )
        assert result.index_path == output_dir / "index.bin"
        assert result.manifest_path == output_dir / "index.manifest.json"
        assert result.index_path.exists()
        assert result.manifest_path.exists()

        manifest = result.manifest
        assert manifest.name == "pokemon-en"
        assert manifest.version == "1.0.0"
        assert manifest.dtype == "float16"
        assert manifest.format == "flat"
        assert manifest.metric == "cosine"
        assert manifest.count == 16
        assert manifest.dim == 32

    def test_builds_float32_artifacts(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        output_dir = tmp_path / "out"
        result = build_index(
            embeddings_npz=synthetic_corpus_npz,
            output_dir=output_dir,
            name="pokemon-en",
            version="1.0.0",
            dtype="float32",
        )
        # Binary must be exactly: header + ids + count*dim*4
        body_bytes = result.manifest.count * result.manifest.dim * 4
        ids_bytes = result.manifest.count * result.manifest.idLength
        assert result.index_path.stat().st_size == 32 + ids_bytes + body_bytes

    def test_manifest_round_trips_to_disk(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        result = build_index(
            embeddings_npz=synthetic_corpus_npz,
            output_dir=tmp_path / "out",
            name="pokemon-en",
            version="1.0.0",
        )
        loaded = load_manifest(result.manifest_path)
        assert loaded == result.manifest

    def test_index_hash_matches_binary(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        import hashlib

        result = build_index(
            embeddings_npz=synthetic_corpus_npz,
            output_dir=tmp_path / "out",
            name="pokemon-en",
            version="1.0.0",
        )
        expected = hashlib.sha256(result.index_path.read_bytes()).hexdigest()
        assert expected == result.manifest.indexHash

    def test_id_length_detected_from_corpus(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        # The fixture writes ids like "uuid-0000…0001" — 37 chars.
        result = build_index(
            embeddings_npz=synthetic_corpus_npz,
            output_dir=tmp_path / "out",
            name="pokemon-en",
            version="1.0.0",
        )
        assert result.manifest.idLength == 37
        header, ids, _ = unpack_index(result.index_path.read_bytes())
        assert header.id_length == 37
        assert ids[0].startswith("uuid-")

    def test_id_length_override_must_be_at_least_natural(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        with pytest.raises(IndexBuildError, match="smaller than the longest"):
            build_index(
                embeddings_npz=synthetic_corpus_npz,
                output_dir=tmp_path / "out",
                name="pokemon-en",
                version="1.0.0",
                id_length=8,
            )

    def test_id_length_override_pads_when_larger(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        result = build_index(
            embeddings_npz=synthetic_corpus_npz,
            output_dir=tmp_path / "out",
            name="pokemon-en",
            version="1.0.0",
            id_length=64,
        )
        assert result.manifest.idLength == 64


class TestBuildIndexErrorPaths:
    def test_missing_npz_raises(self, tmp_path: Path) -> None:
        with pytest.raises(IndexBuildError, match="not found"):
            build_index(
                embeddings_npz=tmp_path / "nope.npz",
                output_dir=tmp_path / "out",
                name="pokemon-en",
                version="1.0.0",
            )

    def test_missing_keys_raises(self, tmp_path: Path) -> None:
        bad_npz = tmp_path / "bad.npz"
        np.savez(
            bad_npz,
            printing_ids=np.array(["a"], dtype="U16"),
            # missing embeddings + identity fields
        )
        with pytest.raises(IndexBuildError, match="missing required keys"):
            build_index(
                embeddings_npz=bad_npz,
                output_dir=tmp_path / "out",
                name="pokemon-en",
                version="1.0.0",
            )

    def test_unnormalised_embeddings_raises(self, tmp_path: Path) -> None:
        bad_npz = tmp_path / "bad.npz"
        np.savez(
            bad_npz,
            printing_ids=np.array(["a", "b"], dtype="U16"),
            embeddings=np.full((2, 4), 2.0, dtype=np.float32),  # ‖v‖₂ = 4
            model_name=np.asarray("m"),
            model_version=np.asarray("v"),
            model_hash=np.asarray("a" * 64),
        )
        with pytest.raises(IndexBuildError, match="L2-normalised"):
            build_index(
                embeddings_npz=bad_npz,
                output_dir=tmp_path / "out",
                name="pokemon-en",
                version="1.0.0",
            )

    def test_unsupported_dtype_raises(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        with pytest.raises(ValueError, match="unknown dtype"):
            build_index(
                embeddings_npz=synthetic_corpus_npz,
                output_dir=tmp_path / "out",
                name="pokemon-en",
                version="1.0.0",
                dtype="int8",  # type: ignore[arg-type]
            )

    def test_empty_corpus_builds_zero_count_index(self, tmp_path: Path) -> None:
        empty_npz = tmp_path / "empty.npz"
        np.savez(
            empty_npz,
            printing_ids=np.array([], dtype="U36"),
            embeddings=np.empty((0, 8), dtype=np.float32),
            model_name=np.asarray("m"),
            model_version=np.asarray("v"),
            model_hash=np.asarray("a" * 64),
        )
        result = build_index(
            embeddings_npz=empty_npz,
            output_dir=tmp_path / "out",
            name="pokemon-en",
            version="1.0.0",
        )
        assert result.manifest.count == 0
        assert result.manifest.dim == 8
