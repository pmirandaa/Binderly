"""On-device ANN index build pipeline.

This package consumes the ``(printing_id, embedding)`` ``.npz`` emitted
by :mod:`embeddings.scripts.build_card_embeddings` and produces:

- ``index.bin`` — a portable, little-endian binary layout (see
  :mod:`ann.format`) that the on-device TypeScript loader at
  ``apps/mobile/src/scanner/ann/`` mmap-reads as a single
  ``ArrayBuffer``. No native bindings, no JSON parsing for the bulk
  data.
- ``index.manifest.json`` — pydantic-validated metadata that mirrors
  the Zod schema on the TypeScript side.

The runtime search path lives entirely on the mobile side; the Python
``search`` helpers in this package are reference implementations used
to build the recall benchmark in the test suite.
"""

from __future__ import annotations

from ann.builder import (
    IndexBuildError,
    build_index,
)
from ann.format import (
    DTYPE_FLOAT16,
    DTYPE_FLOAT32,
    HEADER_SIZE_BYTES,
    INDEX_FORMAT_VERSION,
    INDEX_MAGIC,
    pack_index,
    unpack_index,
)
from ann.manifest import (
    AnnManifest,
    ManifestValidationError,
    compute_index_hash,
    load_manifest,
    write_manifest,
)
from ann.search import flat_topk

__all__ = [
    "AnnManifest",
    "DTYPE_FLOAT16",
    "DTYPE_FLOAT32",
    "HEADER_SIZE_BYTES",
    "INDEX_FORMAT_VERSION",
    "INDEX_MAGIC",
    "IndexBuildError",
    "ManifestValidationError",
    "build_index",
    "compute_index_hash",
    "flat_topk",
    "load_manifest",
    "pack_index",
    "unpack_index",
    "write_manifest",
]
