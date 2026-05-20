"""Tests for the EmbeddingRunner."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import numpy as np
import pytest
from ai_edge_litert.interpreter import Interpreter

from embeddings.manifest import EmbeddingManifest, load_manifest
from embeddings.runner import EmbeddingRunner, EmbeddingRunnerError


def _new_interpreter(path: Path) -> Interpreter:
    interpreter = Interpreter(model_path=str(path))
    interpreter.allocate_tensors()
    return interpreter


class TestEmbeddingRunnerHappyPath:
    def test_from_paths_loads(self, tflite_path: Path, manifest_path: Path) -> None:
        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        assert runner.embedding_dim == 32
        assert runner.manifest.name == "tiny-embedder"

    def test_embed_single_returns_unit_norm(
        self, tflite_path: Path, manifest_path: Path
    ) -> None:
        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        rng = np.random.default_rng(7)
        image = rng.uniform(0.0, 1.0, size=(224, 224, 3)).astype(np.float32)
        vec = runner.embed(image)
        assert vec.shape == (32,)
        assert vec.dtype == np.float32
        np.testing.assert_allclose(float(np.linalg.norm(vec)), 1.0, atol=1e-5)

    def test_embed_batch_returns_unit_norm_rows(
        self, tflite_path: Path, manifest_path: Path
    ) -> None:
        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        rng = np.random.default_rng(11)
        batch = rng.uniform(0.0, 1.0, size=(5, 224, 224, 3)).astype(np.float32)
        out = runner.embed_batch(batch)
        assert out.shape == (5, 32)
        norms = np.linalg.norm(out, axis=1)
        np.testing.assert_allclose(norms, 1.0, atol=1e-5)

    def test_embed_batch_handles_empty(
        self, tflite_path: Path, manifest_path: Path
    ) -> None:
        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        out = runner.embed_batch(np.empty((0, 224, 224, 3), dtype=np.float32))
        assert out.shape == (0, 32)
        assert out.dtype == np.float32

    def test_embed_batch_converts_dtype(
        self, tflite_path: Path, manifest_path: Path
    ) -> None:
        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        # float64 input — runner must downcast cleanly.
        rng = np.random.default_rng(3)
        batch = rng.uniform(0.0, 1.0, size=(2, 224, 224, 3)).astype(np.float64)
        out = runner.embed_batch(batch)
        assert out.dtype == np.float32


class TestEmbeddingRunnerErrors:
    def test_rejects_wrong_input_rank(
        self, tflite_path: Path, manifest_path: Path
    ) -> None:
        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        with pytest.raises(ValueError, match=r"\(N, H, W, 3\)"):
            runner.embed_batch(np.zeros((2, 4, 5, 6, 3), dtype=np.float32))

    def test_rejects_wrong_channel_count(
        self, tflite_path: Path, manifest_path: Path
    ) -> None:
        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        with pytest.raises(ValueError, match=r"\(N, H, W, 3\)"):
            runner.embed_batch(np.zeros((1, 224, 224, 4), dtype=np.float32))

    def test_rejects_manifest_dim_mismatch(
        self, tflite_path: Path, manifest_path: Path, tmp_path: Path
    ) -> None:
        # Forge a manifest with a wrong embeddingDim and confirm the
        # runner refuses to construct.
        manifest = load_manifest(manifest_path)
        bad = manifest.model_dump(mode="json")
        bad["embeddingDim"] = 9999
        bad_path = tmp_path / "bad_manifest.json"
        bad_path.write_text(json.dumps(bad), encoding="utf-8")

        interpreter = _new_interpreter(tflite_path)
        with pytest.raises(EmbeddingRunnerError, match="embeddingDim"):
            EmbeddingRunner(
                EmbeddingManifest.model_validate(bad), interpreter
            )

    def test_rejects_manifest_input_shape_mismatch(
        self, tflite_path: Path, manifest_path: Path
    ) -> None:
        manifest = load_manifest(manifest_path)
        bad = manifest.model_copy(update={"inputShape": [1, 128, 128, 3]})
        interpreter = _new_interpreter(tflite_path)
        with pytest.raises(EmbeddingRunnerError, match="inputShape"):
            EmbeddingRunner(bad, interpreter)


class TestEmbedPaths:
    def test_round_trips_directory(
        self,
        tflite_path: Path,
        manifest_path: Path,
        tmp_path: Path,
    ) -> None:
        # Create three fake card images.
        from PIL import Image

        rng = np.random.default_rng(99)
        paths = []
        for i in range(3):
            arr = rng.integers(0, 256, size=(64, 64, 3), dtype=np.uint8)
            p = tmp_path / f"card-{i}.png"
            Image.fromarray(arr, mode="RGB").save(p)
            paths.append(p)

        runner = EmbeddingRunner.from_paths(
            model_path=tflite_path, manifest_path=manifest_path
        )
        out = runner.embed_paths(paths, batch_size=2)
        assert out.shape == (3, 32)
        np.testing.assert_allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-5)
