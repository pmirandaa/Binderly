"""CLI for building an on-device ANN index from an embeddings ``.npz``.

Usage::

    binderly-build-ann-index \\
        --embeddings-npz ./embeddings.npz \\
        --output-dir ./ann/en-v1 \\
        --name pokemon-en \\
        --version 1.0.0 \\
        [--dtype float16] \\
        [--id-length 36]

Writes::

    <output-dir>/index.bin
    <output-dir>/index.manifest.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ann.builder import IndexBuildError, build_index


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--embeddings-npz", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--name", type=str, required=True)
    parser.add_argument("--version", type=str, required=True)
    parser.add_argument(
        "--dtype",
        choices=("float16", "float32"),
        default="float16",
        help="Storage dtype for embeddings inside the index. "
        "Defaults to float16 for ~50%% smaller bundle.",
    )
    parser.add_argument(
        "--id-length",
        type=int,
        default=None,
        help="Override the printing-id byte width (default: detected "
        "from the npz).",
    )
    args = parser.parse_args(argv)

    try:
        result = build_index(
            embeddings_npz=args.embeddings_npz,
            output_dir=args.output_dir,
            name=args.name,
            version=args.version,
            dtype=args.dtype,
            id_length=args.id_length,
        )
    except IndexBuildError as exc:
        print(f"[build_ann_index] ERROR: {exc}", file=sys.stderr)
        return 2

    size_kb = result.index_path.stat().st_size / 1024
    print(
        f"[build_ann_index] wrote {result.index_path} "
        f"({size_kb:.1f} KiB)"
    )
    print(f"[build_ann_index] manifest: {result.manifest_path}")
    print(
        f"[build_ann_index] N={result.manifest.count} "
        f"D={result.manifest.dim} dtype={result.manifest.dtype} "
        f"id_length={result.manifest.idLength}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
