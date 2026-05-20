"""End-to-end smoke test for the embedding pipeline."""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest

from embeddings.scripts.smoke import run_smoke


def test_smoke_pipeline(tflite_path: Path, manifest_path: Path) -> None:
    """The smoke pipeline produces L2-normalised embeddings under budget."""

    started = time.perf_counter()
    payload = run_smoke(
        model_path=tflite_path,
        manifest_path=manifest_path,
        count=10,
    )
    elapsed = time.perf_counter() - started

    embeddings: np.ndarray = payload["embeddings"]  # type: ignore[assignment]
    assert embeddings.shape == (10, 32)
    norms = np.linalg.norm(embeddings, axis=1)
    np.testing.assert_allclose(norms, 1.0, atol=1e-5)

    # Smoke must run in well under 30 s on any sensible developer machine.
    assert elapsed < 30.0, f"smoke took {elapsed:.2f}s (budget 30 s)"


def test_smoke_pipeline_emits_metadata(
    tflite_path: Path, manifest_path: Path
) -> None:
    payload = run_smoke(
        model_path=tflite_path,
        manifest_path=manifest_path,
        count=10,
    )
    assert payload["model_name"] == "tiny-embedder"
    assert payload["model_version"] == "1.0.0-fixture"
    assert isinstance(payload["model_hash"], str)
    assert len(payload["model_hash"]) == 64


def test_fixture_tflite_size_under_budget(tflite_path: Path) -> None:
    """The shipped fixture must stay small so it doesn't bloat the repo."""

    size = tflite_path.stat().st_size
    # Fixture should be a tiny synthetic model, well under the
    # production 25 MB budget.
    assert size < 50 * 1024, f"fixture tflite is {size:,} bytes"


def test_real_model_size_budget_assertion() -> None:
    """Document the 25 MB ceiling the *production* build script enforces.

    This is intentionally a constants-only assertion — it's the
    on-paper spec the on-device loader trusts. The actual production
    TFLite is built offline by `build_tflite.py` which has the same
    25 MB assert.
    """

    from embeddings.scripts import build_tflite

    assert build_tflite._MAX_SIZE_BYTES == 25 * 1024 * 1024
    assert build_tflite._EMBEDDING_DIM == 576
    assert build_tflite._INPUT_SHAPE == (1, 224, 224, 3)
    assert build_tflite._NORMALIZATION == "mobilenet_v3"
