"""Generate the tiny TFLite fixture used by the pytest suite.

This is invoked manually — the produced ``tiny_embedder.tflite`` and
``tiny_embedder.manifest.json`` are committed to the repository so the
pytest suite has no TensorFlow dependency at runtime (TF is only in
the ``[build]`` extra).

Output: a deterministic ``224 × 224 × 3 → 32`` dense projection. The
weights are seeded so re-running this script produces the same bytes.

Usage::

    pip install -e '.[build,dev]'
    python -m embeddings.tests.fixtures.build

Re-run when ``EmbeddingRunner`` adds a contract the current fixture
can no longer exercise (e.g. quantised activations, multiple inputs).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

from embeddings.manifest import (
    EmbeddingManifest,
    compute_model_hash,
    write_manifest,
)

_FIXTURE_DIR = Path(__file__).resolve().parent
_TFLITE_PATH = _FIXTURE_DIR / "tiny_embedder.tflite"
_MANIFEST_PATH = _FIXTURE_DIR / "tiny_embedder.manifest.json"

_FIXTURE_INPUT_SHAPE = (1, 224, 224, 3)
_FIXTURE_EMBEDDING_DIM = 32
_FIXTURE_SEED = 1337


def _build() -> None:
    # Imported lazily so importing this file never pulls TensorFlow.
    import tensorflow as tf

    tf.random.set_seed(_FIXTURE_SEED)
    np.random.seed(_FIXTURE_SEED)

    inputs = tf.keras.Input(shape=_FIXTURE_INPUT_SHAPE[1:], name="image")
    # GlobalAveragePool the input to (B, 3), then project to 32-D.
    pooled = tf.keras.layers.GlobalAveragePooling2D(name="pool")(inputs)
    embedding = tf.keras.layers.Dense(
        _FIXTURE_EMBEDDING_DIM,
        use_bias=False,
        activation=None,
        kernel_initializer=tf.keras.initializers.GlorotUniform(seed=_FIXTURE_SEED),
        name="embedding",
    )(pooled)
    model = tf.keras.Model(inputs=inputs, outputs=embedding, name="tiny_embedder")

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_bytes = converter.convert()
    _TFLITE_PATH.write_bytes(tflite_bytes)

    manifest = EmbeddingManifest(
        name="tiny-embedder",
        version="1.0.0-fixture",
        modelHash=compute_model_hash(_TFLITE_PATH),
        inputShape=list(_FIXTURE_INPUT_SHAPE),
        embeddingDim=_FIXTURE_EMBEDDING_DIM,
        normalization="zero_one",
        createdAt="2026-05-20T00:00:00.000Z",
        sourceUrl=None,
    )
    write_manifest(manifest, _MANIFEST_PATH)
    print(
        f"[fixture] wrote {_TFLITE_PATH.name} "
        f"({_TFLITE_PATH.stat().st_size} bytes) "
        f"and {_MANIFEST_PATH.name}"
    )


def main() -> int:
    _build()
    return 0


if __name__ == "__main__":
    sys.exit(main())
