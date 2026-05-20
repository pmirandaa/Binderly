"""Binderly card-image embedding pipeline.

Two surfaces live here:

- The :mod:`embeddings.scripts` CLIs — build the TFLite model and run
  it offline over the catalog to produce ``(printing_id, embedding)``
  pairs the ANN builder consumes.
- The :class:`embeddings.runner.EmbeddingRunner` — thin wrapper around
  ``ai_edge_litert`` used by the smoke tests and any downstream
  server-side consumer (e.g. a future cloud-fallback recognition
  endpoint).

The on-device half lives in ``apps/mobile/src/scanner/embed/``; the
two halves agree on the manifest format defined here.
"""

from embeddings.manifest import (
    EmbeddingManifest,
    ManifestValidationError,
    compute_model_hash,
    load_manifest,
    write_manifest,
)
from embeddings.normalize import (
    PREPROCESSING_NAMES,
    l2_normalize,
    preprocess_image,
)
from embeddings.runner import EmbeddingRunner

__all__ = [
    "EmbeddingManifest",
    "EmbeddingRunner",
    "ManifestValidationError",
    "PREPROCESSING_NAMES",
    "compute_model_hash",
    "l2_normalize",
    "load_manifest",
    "preprocess_image",
    "write_manifest",
]
