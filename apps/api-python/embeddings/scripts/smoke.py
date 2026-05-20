"""End-to-end smoke for the embedding pipeline.

Builds a tmpdir of 10 synthetic card images (deterministic noise so
the test is reproducible), runs `build_card_embeddings` against the
shipped tiny TFLite fixture, and asserts the output `.npz` shape +
L2-normalisation + manifest validity.

Runs in well under 30 s on a developer laptop. Used both by the pytest
suite (`tests/test_smoke.py`) and as a standalone CLI.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from embeddings.manifest import load_manifest
from embeddings.scripts.build_card_embeddings import build_embeddings

_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
_DEFAULT_MODEL = _FIXTURE_DIR / "tiny_embedder.tflite"
_DEFAULT_MANIFEST = _FIXTURE_DIR / "tiny_embedder.manifest.json"


def _generate_card_images(target_dir: Path, *, count: int, seed: int = 7) -> list[Path]:
    """Write `count` deterministic synthetic 'card' PNGs to ``target_dir``."""

    rng = np.random.default_rng(seed=seed)
    paths: list[Path] = []
    for i in range(count):
        # Card-ish portrait at the model's native resolution. We use a
        # mix of colour-blocks + noise so we get *different* embeddings
        # per image rather than a flat all-zero output.
        h, w = 224, 224
        arr = rng.integers(low=0, high=256, size=(h, w, 3), dtype=np.uint8)
        printing_id = f"smoke-{i:02d}"
        path = target_dir / f"{printing_id}.png"
        Image.fromarray(arr, mode="RGB").save(path, format="PNG")
        paths.append(path)
    return paths


def run_smoke(
    *,
    model_path: Path = _DEFAULT_MODEL,
    manifest_path: Path = _DEFAULT_MANIFEST,
    count: int = 10,
) -> dict[str, object]:
    """Run the smoke pipeline; return the payload dict for assertions."""

    manifest = load_manifest(manifest_path)
    with tempfile.TemporaryDirectory(prefix="binderly-embed-smoke-") as tmp:
        tmp_path = Path(tmp)
        image_paths = _generate_card_images(tmp_path, count=count)

        payload = build_embeddings(
            model_path=model_path,
            manifest_path=manifest_path,
            image_paths=image_paths,
            batch_size=4,
        )

    embeddings: np.ndarray = payload["embeddings"]  # type: ignore[assignment]
    if embeddings.shape != (count, manifest.embeddingDim):
        raise SystemExit(
            f"smoke: bad embeddings shape {embeddings.shape}, "
            f"expected ({count}, {manifest.embeddingDim})"
        )

    norms = np.linalg.norm(embeddings, axis=1)
    if not np.allclose(norms, 1.0, atol=1e-4):
        raise SystemExit(
            f"smoke: embeddings not L2-normalised (norms range "
            f"{float(norms.min()):.6f}..{float(norms.max()):.6f})"
        )

    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", type=Path, default=_DEFAULT_MODEL)
    parser.add_argument("--manifest-path", type=Path, default=_DEFAULT_MANIFEST)
    parser.add_argument("--count", type=int, default=10)
    args = parser.parse_args(argv)

    payload = run_smoke(
        model_path=args.model_path,
        manifest_path=args.manifest_path,
        count=args.count,
    )
    embeddings: np.ndarray = payload["embeddings"]  # type: ignore[assignment]
    print(
        f"[smoke] OK — model={payload['model_name']} "
        f"version={payload['model_version']} "
        f"N={embeddings.shape[0]} D={embeddings.shape[1]} "
        f"norm-range={float(np.linalg.norm(embeddings, axis=1).min()):.4f}.."
        f"{float(np.linalg.norm(embeddings, axis=1).max()):.4f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
