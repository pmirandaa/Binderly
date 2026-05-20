"""Build the MobileNetV3-Small TFLite embedding model.

Downloads the ImageNet-pretrained `MobileNetV3Small` from
`tf.keras.applications`, strips its classifier head (we already pass
`include_top=False`), exports it as a TFLite model with int8
dynamic-range quantisation, and writes the companion `manifest.json`.

This script requires the heavy ``tensorflow`` dependency — it is NOT
installed by the base pyproject. Install with the ``build`` extra:

    pip install -e '.[build]'

CLI:

    binderly-build-tflite \\
        --output-dir ./out/mobilenet-v3-small/1.0.0 \\
        --model-name mobilenet-v3-small \\
        --model-version 1.0.0
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

from embeddings.manifest import (
    EmbeddingManifest,
    compute_model_hash,
    utc_now_iso8601,
    write_manifest,
)

# Hard-coded contract for v1. If we swap models, both this script and
# MODEL.md need to be updated together.
_INPUT_SHAPE: tuple[int, int, int, int] = (1, 224, 224, 3)
_EMBEDDING_DIM = 576
_NORMALIZATION = "mobilenet_v3"
_MAX_SIZE_BYTES = 25 * 1024 * 1024
_SOURCE_URL = (
    "https://storage.googleapis.com/tensorflow/keras-applications/mobilenet_v3/"
)


def _build_keras_model():  # type: ignore[no-untyped-def]
    """Construct the Keras feature extractor.

    Done in a helper so the heavy TF import lives behind the CLI entry
    point — importing this module never triggers the TF graph.
    """

    import tensorflow as tf

    base = tf.keras.applications.MobileNetV3Small(
        input_shape=_INPUT_SHAPE[1:],
        include_top=False,
        pooling="avg",
        weights="imagenet",
    )
    # `pooling='avg'` gives us a (batch, 576) tensor directly — no
    # extra Flatten / Dense head needed.
    return base


def _convert_to_tflite(model) -> bytes:  # type: ignore[no-untyped-def]
    import tensorflow as tf

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    # Dynamic-range int8 quantisation — smallest size, near-zero
    # accuracy loss for embedding-similarity, and (importantly) no
    # representative dataset required (we don't have card-image
    # samples committed to the repo).
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    return converter.convert()


def _smoke_inference(tflite_path: Path) -> None:
    """Run a single random-input inference to confirm the model loads."""

    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=str(tflite_path))
    interpreter.allocate_tensors()
    inputs = interpreter.get_input_details()
    outputs = interpreter.get_output_details()
    rng = np.random.default_rng(seed=42)
    dummy = rng.uniform(-1.0, 1.0, size=tuple(inputs[0]["shape"])).astype(np.float32)
    interpreter.set_tensor(inputs[0]["index"], dummy)
    interpreter.invoke()
    embedding = interpreter.get_tensor(outputs[0]["index"])
    assert embedding.shape[-1] == _EMBEDDING_DIM, (
        f"smoke embedding had dim {embedding.shape[-1]}, expected {_EMBEDDING_DIM}"
    )


def build(
    *,
    output_dir: Path,
    model_name: str,
    model_version: str,
    source_url: str = _SOURCE_URL,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    tflite_path = output_dir / "model.tflite"
    manifest_path = output_dir / "manifest.json"

    print(f"[build_tflite] constructing keras feature extractor")
    keras_model = _build_keras_model()

    print(f"[build_tflite] converting to TFLite (dynamic-range int8)")
    tflite_bytes = _convert_to_tflite(keras_model)

    tflite_path.write_bytes(tflite_bytes)
    size = tflite_path.stat().st_size
    print(f"[build_tflite] wrote {tflite_path} ({size:,} bytes)")
    if size > _MAX_SIZE_BYTES:
        raise SystemExit(
            f"TFLite file is {size:,} bytes, exceeds 25 MB budget. "
            f"Either swap to a smaller variant or revisit the quantisation."
        )

    print(f"[build_tflite] running smoke inference")
    _smoke_inference(tflite_path)

    manifest = EmbeddingManifest(
        name=model_name,
        version=model_version,
        modelHash=compute_model_hash(tflite_path),
        inputShape=list(_INPUT_SHAPE),
        embeddingDim=_EMBEDDING_DIM,
        normalization=_NORMALIZATION,
        createdAt=utc_now_iso8601(),
        sourceUrl=source_url,
    )
    write_manifest(manifest, manifest_path)
    print(f"[build_tflite] wrote {manifest_path}")

    return tflite_path, manifest_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-name", type=str, default="mobilenet-v3-small")
    parser.add_argument("--model-version", type=str, default="1.0.0")
    parser.add_argument("--source-url", type=str, default=_SOURCE_URL)
    args = parser.parse_args(argv)

    build(
        output_dir=args.output_dir,
        model_name=args.model_name,
        model_version=args.model_version,
        source_url=args.source_url,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
