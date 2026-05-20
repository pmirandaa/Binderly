"""Smoke tests for the ``build_ann_index`` CLI wrapper."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from ann.format import unpack_index
from ann.scripts.build_ann_index import main


class TestCli:
    def test_builds_artifacts_end_to_end(
        self,
        synthetic_corpus_npz: Path,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        output_dir = tmp_path / "out"
        exit_code = main(
            [
                "--embeddings-npz",
                str(synthetic_corpus_npz),
                "--output-dir",
                str(output_dir),
                "--name",
                "pokemon-en",
                "--version",
                "1.0.0",
            ]
        )
        assert exit_code == 0
        assert (output_dir / "index.bin").exists()
        assert (output_dir / "index.manifest.json").exists()

        manifest_data = json.loads((output_dir / "index.manifest.json").read_text())
        assert manifest_data["dtype"] == "float16"
        assert manifest_data["dim"] == 32
        assert manifest_data["count"] == 16

        header, ids, embeddings = unpack_index(
            (output_dir / "index.bin").read_bytes()
        )
        assert header.count == 16
        assert len(ids) == 16
        assert embeddings.shape == (16, 32)

        captured = capsys.readouterr()
        assert "wrote" in captured.out

    def test_dtype_override_respected(
        self, synthetic_corpus_npz: Path, tmp_path: Path
    ) -> None:
        output_dir = tmp_path / "out-f32"
        exit_code = main(
            [
                "--embeddings-npz",
                str(synthetic_corpus_npz),
                "--output-dir",
                str(output_dir),
                "--name",
                "pokemon-en",
                "--version",
                "1.0.0",
                "--dtype",
                "float32",
            ]
        )
        assert exit_code == 0
        manifest_data = json.loads((output_dir / "index.manifest.json").read_text())
        assert manifest_data["dtype"] == "float32"

    def test_missing_npz_returns_nonzero_exit(
        self,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        exit_code = main(
            [
                "--embeddings-npz",
                str(tmp_path / "nope.npz"),
                "--output-dir",
                str(tmp_path / "out"),
                "--name",
                "pokemon-en",
                "--version",
                "1.0.0",
            ]
        )
        assert exit_code == 2
        err = capsys.readouterr().err
        assert "ERROR" in err
