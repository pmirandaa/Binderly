"""Generate per-printing embeddings from a directory of card images.

This is the offline catalog-embedding CLI. It reads card images from
a directory (one image per printing, filename without extension =
``printing_id``), runs them through the TFLite model, and emits a
single ``.npz`` file that `T-SC-ANN-INDEX` consumes:

    {
      "printing_ids": np.array(['…uuid…', …], dtype=U36),
      "embeddings":   np.array(shape=(N, D), dtype=float32),  # L2-normalised
      "model_name":   str,
      "model_version": str,
      "model_hash":   str,
    }

Filenames may be any standard Pillow-readable image extension. The
``printing_id`` is the filename stem; the matcher will join it back
to the `printing` row via that key.

CLI:

    binderly-build-card-embeddings \\
        --model-path ./model.tflite \\
        --manifest-path ./manifest.json \\
        --images-dir ./cards/ \\
        --output-path ./embeddings.npz \\
        --batch-size 32 \\
        [--limit 100]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable

import numpy as np

from embeddings.runner import EmbeddingRunner

_SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}


def _discover_images(images_dir: Path, *, limit: int | None) -> list[Path]:
    if not images_dir.exists():
        raise SystemExit(f"images dir not found: {images_dir}")
    files = sorted(
        p
        for p in images_dir.iterdir()
        if p.is_file() and p.suffix.lower() in _SUPPORTED_EXTS
    )
    if limit is not None:
        files = files[:limit]
    return files


def build_embeddings(
    *,
    model_path: Path,
    manifest_path: Path,
    image_paths: list[Path],
    batch_size: int,
) -> dict[str, object]:
    runner = EmbeddingRunner.from_paths(
        model_path=model_path,
        manifest_path=manifest_path,
    )
    if not image_paths:
        return {
            "printing_ids": np.empty((0,), dtype="U64"),
            "embeddings": np.empty((0, runner.embedding_dim), dtype=np.float32),
            "model_name": runner.manifest.name,
            "model_version": runner.manifest.version,
            "model_hash": runner.manifest.modelHash,
        }

    printing_ids = np.asarray([p.stem for p in image_paths], dtype="U64")
    embeddings = runner.embed_paths(image_paths, batch_size=batch_size)

    return {
        "printing_ids": printing_ids,
        "embeddings": embeddings,
        "model_name": runner.manifest.name,
        "model_version": runner.manifest.version,
        "model_hash": runner.manifest.modelHash,
    }


def write_output(payload: dict[str, object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        output_path,
        printing_ids=payload["printing_ids"],
        embeddings=payload["embeddings"],
        model_name=np.asarray(payload["model_name"]),
        model_version=np.asarray(payload["model_version"]),
        model_hash=np.asarray(payload["model_hash"]),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--manifest-path", type=Path, required=True)
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--output-path", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Smoke-run override — only embed the first N images.",
    )
    args = parser.parse_args(argv)

    image_paths = _discover_images(args.images_dir, limit=args.limit)
    print(f"[build_card_embeddings] found {len(image_paths)} images")

    payload = build_embeddings(
        model_path=args.model_path,
        manifest_path=args.manifest_path,
        image_paths=image_paths,
        batch_size=args.batch_size,
    )

    embeddings: np.ndarray = payload["embeddings"]  # type: ignore[assignment]
    if embeddings.size:
        norms = np.linalg.norm(embeddings, axis=1)
        # Light sanity check that the runner's L2-normalisation held.
        if not np.allclose(norms, 1.0, atol=1e-4):
            offending = float(np.max(np.abs(norms - 1.0)))
            raise SystemExit(
                f"output embeddings are not L2-normalised (max delta {offending:.6f})"
            )

    write_output(payload, args.output_path)
    print(
        f"[build_card_embeddings] wrote {args.output_path} "
        f"(N={embeddings.shape[0]}, D={embeddings.shape[1] if embeddings.size else 0})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
