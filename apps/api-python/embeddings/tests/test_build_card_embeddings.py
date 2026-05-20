"""Tests for the offline catalog-embedding CLI."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from embeddings.scripts.build_card_embeddings import (
    _discover_images,
    build_embeddings,
    main,
    write_output,
)


def _seed_card_images(target_dir: Path, count: int) -> list[Path]:
    rng = np.random.default_rng(123)
    paths: list[Path] = []
    for i in range(count):
        arr = rng.integers(0, 256, size=(48, 48, 3), dtype=np.uint8)
        p = target_dir / f"printing-{i:03d}.png"
        Image.fromarray(arr, mode="RGB").save(p)
        paths.append(p)
    return paths


class TestDiscoverImages:
    def test_picks_up_supported_extensions(self, tmp_path: Path) -> None:
        for ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp"]:
            (tmp_path / f"a{ext}").write_bytes(b"\x00")
        (tmp_path / "skip.txt").write_bytes(b"")
        files = _discover_images(tmp_path, limit=None)
        # 5 image extensions discovered; .txt skipped.
        assert len(files) == 5

    def test_limit_caps_results(self, tmp_path: Path) -> None:
        for i in range(10):
            (tmp_path / f"p-{i}.png").write_bytes(b"")
        files = _discover_images(tmp_path, limit=3)
        assert len(files) == 3

    def test_sorts_results(self, tmp_path: Path) -> None:
        for name in ["b.png", "c.png", "a.png"]:
            (tmp_path / name).write_bytes(b"")
        files = _discover_images(tmp_path, limit=None)
        assert [p.name for p in files] == ["a.png", "b.png", "c.png"]

    def test_missing_dir_raises(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit):
            _discover_images(tmp_path / "nope", limit=None)


class TestBuildEmbeddings:
    def test_produces_normalised_output(
        self,
        tmp_path: Path,
        tflite_path: Path,
        manifest_path: Path,
    ) -> None:
        image_paths = _seed_card_images(tmp_path, count=4)
        payload = build_embeddings(
            model_path=tflite_path,
            manifest_path=manifest_path,
            image_paths=image_paths,
            batch_size=2,
        )

        ids: np.ndarray = payload["printing_ids"]  # type: ignore[assignment]
        embeddings: np.ndarray = payload["embeddings"]  # type: ignore[assignment]

        assert ids.shape == (4,)
        assert ids.tolist() == [p.stem for p in image_paths]
        assert embeddings.shape == (4, 32)
        np.testing.assert_allclose(
            np.linalg.norm(embeddings, axis=1), 1.0, atol=1e-5
        )

        assert payload["model_name"] == "tiny-embedder"
        assert payload["model_version"] == "1.0.0-fixture"

    def test_empty_input_returns_empty_arrays(
        self,
        tmp_path: Path,
        tflite_path: Path,
        manifest_path: Path,
    ) -> None:
        payload = build_embeddings(
            model_path=tflite_path,
            manifest_path=manifest_path,
            image_paths=[],
            batch_size=2,
        )
        embeddings: np.ndarray = payload["embeddings"]  # type: ignore[assignment]
        ids: np.ndarray = payload["printing_ids"]  # type: ignore[assignment]
        assert embeddings.shape == (0, 32)
        assert ids.shape == (0,)


class TestWriteOutput:
    def test_writes_loadable_npz(
        self,
        tmp_path: Path,
        tflite_path: Path,
        manifest_path: Path,
    ) -> None:
        imgs_dir = tmp_path / "imgs"
        imgs_dir.mkdir()
        image_paths = _seed_card_images(imgs_dir, count=2)
        for p in image_paths:
            assert p.exists()

        payload = build_embeddings(
            model_path=tflite_path,
            manifest_path=manifest_path,
            image_paths=image_paths,
            batch_size=2,
        )
        out = tmp_path / "nested" / "embeddings.npz"
        write_output(payload, out)

        assert out.exists()
        loaded = np.load(out, allow_pickle=False)
        assert "printing_ids" in loaded.files
        assert "embeddings" in loaded.files
        assert loaded["embeddings"].shape == (2, 32)
        assert str(loaded["model_name"]) == "tiny-embedder"


class TestMainCli:
    def test_cli_round_trip(
        self,
        tmp_path: Path,
        tflite_path: Path,
        manifest_path: Path,
    ) -> None:
        # Set up an images dir with 6 PNGs.
        images_dir = tmp_path / "cards"
        images_dir.mkdir()
        _seed_card_images(images_dir, count=6)

        out = tmp_path / "out.npz"

        rc = main(
            [
                "--model-path",
                str(tflite_path),
                "--manifest-path",
                str(manifest_path),
                "--images-dir",
                str(images_dir),
                "--output-path",
                str(out),
                "--batch-size",
                "3",
                "--limit",
                "4",
            ]
        )
        assert rc == 0
        assert out.exists()

        loaded = np.load(out, allow_pickle=False)
        # --limit 4 capped the discovery.
        assert loaded["embeddings"].shape == (4, 32)
        assert loaded["printing_ids"].shape == (4,)
        np.testing.assert_allclose(
            np.linalg.norm(loaded["embeddings"], axis=1), 1.0, atol=1e-5
        )
