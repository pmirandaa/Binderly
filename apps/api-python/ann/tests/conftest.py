"""Shared pytest fixtures for the ANN test suite."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest


@pytest.fixture()
def synthetic_corpus(tmp_path: Path) -> dict[str, np.ndarray]:
    """Return a deterministic ``(printing_ids, embeddings)`` payload.

    Embeddings are sampled from a normal distribution then L2-normalised
    to mimic the upstream pipeline's output. Dimension is 32 to keep
    the binary small in tests.
    """

    rng = np.random.default_rng(20260520)
    count = 16
    dim = 32
    raw = rng.normal(size=(count, dim)).astype(np.float32)
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    embeddings = raw / np.where(norms == 0.0, 1.0, norms)
    printing_ids = np.array(
        [f"uuid-{index:032d}" for index in range(count)],
        dtype="U64",
    )
    return {
        "printing_ids": printing_ids,
        "embeddings": embeddings,
        "model_name": np.asarray("tiny-embedder"),
        "model_version": np.asarray("1.0.0-fixture"),
        "model_hash": np.asarray(
            "ae821f7a9d48341e52bbb22401f882f8fbf647e294b64fd97db44b4e4105cb2a"
        ),
    }


@pytest.fixture()
def synthetic_corpus_npz(
    tmp_path: Path, synthetic_corpus: dict[str, np.ndarray]
) -> Path:
    """Write the synthetic corpus to an ``.npz`` and return its path."""

    npz_path = tmp_path / "embeddings.npz"
    np.savez(
        npz_path,
        printing_ids=synthetic_corpus["printing_ids"],
        embeddings=synthetic_corpus["embeddings"],
        model_name=synthetic_corpus["model_name"],
        model_version=synthetic_corpus["model_version"],
        model_hash=synthetic_corpus["model_hash"],
    )
    return npz_path
