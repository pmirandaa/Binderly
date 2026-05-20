"""Shared pytest fixtures.

The tests depend on the committed tiny TFLite fixture at
``embeddings/tests/fixtures/tiny_embedder.tflite``. Regenerate with::

    pip install -e '.[build,dev]'
    python -m embeddings.tests.fixtures.build
"""

from __future__ import annotations

from pathlib import Path

import pytest

_FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(scope="session")
def fixture_dir() -> Path:
    return _FIXTURE_DIR


@pytest.fixture(scope="session")
def tflite_path(fixture_dir: Path) -> Path:
    path = fixture_dir / "tiny_embedder.tflite"
    if not path.exists():
        raise pytest.UsageError(
            f"missing TFLite fixture at {path} — run "
            f"`python -m embeddings.tests.fixtures.build` after installing "
            f"the `build` extras."
        )
    return path


@pytest.fixture(scope="session")
def manifest_path(fixture_dir: Path) -> Path:
    path = fixture_dir / "tiny_embedder.manifest.json"
    if not path.exists():
        raise pytest.UsageError(
            f"missing manifest fixture at {path} — run "
            f"`python -m embeddings.tests.fixtures.build`."
        )
    return path
