"""Thin wrapper around ``ai_edge_litert`` for batched image inference.

The runner owns:

- The TFLite interpreter (loaded once, reused per batch).
- The bridge between the manifest's declared ``inputShape`` /
  ``embeddingDim`` and the interpreter's actual input / output tensors
  (it fails loudly on mismatch).
- The batched ``embed_batch`` path that resizes the input tensor when
  necessary and runs inference one item at a time (most TFLite models
  ship with a static input batch dimension; we honor whatever the
  model declares).
- L2-normalisation of the output rows.

It DOES NOT own image decoding — callers preprocess into the model's
expected ``(H, W, 3)`` float layout via
:func:`embeddings.normalize.preprocess_batch` first.
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import numpy as np
from ai_edge_litert.interpreter import Interpreter

from embeddings.manifest import EmbeddingManifest, load_manifest
from embeddings.normalize import l2_normalize


class EmbeddingRunnerError(RuntimeError):
    """Raised when the runner cannot align the manifest with the model."""


class EmbeddingRunner:
    """Stateful TFLite inference helper.

    Construct via :meth:`from_paths` (most callers) or pass a manifest
    + interpreter directly (tests). ``embed_batch`` is the main entry
    point.
    """

    def __init__(self, manifest: EmbeddingManifest, interpreter: Interpreter) -> None:
        self._manifest = manifest
        self._interpreter = interpreter
        self._input_index, self._output_index = self._resolve_io()

    @classmethod
    def from_paths(
        cls,
        *,
        model_path: str | Path,
        manifest_path: str | Path,
        num_threads: int | None = None,
    ) -> "EmbeddingRunner":
        manifest = load_manifest(manifest_path)
        interpreter = Interpreter(
            model_path=str(model_path),
            num_threads=num_threads,
        )
        interpreter.allocate_tensors()
        return cls(manifest, interpreter)

    @property
    def manifest(self) -> EmbeddingManifest:
        return self._manifest

    @property
    def embedding_dim(self) -> int:
        return self._manifest.embeddingDim

    def _resolve_io(self) -> tuple[int, int]:
        inputs = self._interpreter.get_input_details()
        outputs = self._interpreter.get_output_details()
        if len(inputs) != 1:
            raise EmbeddingRunnerError(
                f"expected exactly 1 input tensor, got {len(inputs)}"
            )
        if len(outputs) != 1:
            raise EmbeddingRunnerError(
                f"expected exactly 1 output tensor, got {len(outputs)}"
            )

        input_shape = list(inputs[0]["shape"])
        expected = list(self._manifest.inputShape)
        # Allow batch dim == 1 vs unknown (-1); compare the spatial part.
        if input_shape[1:] != expected[1:]:
            raise EmbeddingRunnerError(
                f"manifest inputShape {expected} disagrees with model "
                f"input tensor {input_shape}"
            )

        output_shape = list(outputs[0]["shape"])
        # Output is normally (1, D) — last axis is the embedding dim.
        if output_shape[-1] != self._manifest.embeddingDim:
            raise EmbeddingRunnerError(
                f"manifest embeddingDim {self._manifest.embeddingDim} "
                f"disagrees with model output tensor {output_shape}"
            )

        return inputs[0]["index"], outputs[0]["index"]

    def embed(self, image_tensor: np.ndarray) -> np.ndarray:
        """Run inference on a single ``(H, W, 3)`` float tensor."""

        return self.embed_batch(image_tensor[np.newaxis, :, :, :])[0]

    def embed_batch(self, image_batch: np.ndarray) -> np.ndarray:
        """Run inference on ``(N, H, W, 3)`` float tensor; return ``(N, D)``."""

        if image_batch.ndim != 4 or image_batch.shape[-1] != 3:
            raise ValueError(
                f"expected (N, H, W, 3) tensor, got {image_batch.shape!r}"
            )
        if image_batch.dtype != np.float32:
            image_batch = image_batch.astype(np.float32, copy=False)

        n = image_batch.shape[0]
        if n == 0:
            return np.empty((0, self._manifest.embeddingDim), dtype=np.float32)

        out = np.empty((n, self._manifest.embeddingDim), dtype=np.float32)
        for i in range(n):
            # Re-shape input on every call to handle models whose batch
            # dim is dynamic. For static batch=1 this is a no-op.
            self._interpreter.set_tensor(
                self._input_index, image_batch[i : i + 1].astype(np.float32)
            )
            self._interpreter.invoke()
            raw = self._interpreter.get_tensor(self._output_index)
            # Output is typically (1, D); squeeze to (D,).
            out[i] = raw.reshape(-1)

        return l2_normalize(out)

    def embed_paths(
        self,
        image_paths: Sequence[str | Path],
        *,
        batch_size: int = 32,
    ) -> np.ndarray:
        """Convenience: load + preprocess + embed a list of file paths.

        Returns an ``(N, D)`` L2-normalised float32 array.
        """

        # Local import to avoid a circular import at module load time.
        from embeddings.normalize import preprocess_batch

        h, w = self._manifest.inputShape[1], self._manifest.inputShape[2]
        out_chunks: list[np.ndarray] = []
        for start in range(0, len(image_paths), batch_size):
            chunk = image_paths[start : start + batch_size]
            tensor = preprocess_batch(
                chunk,
                target_size=(h, w),
                normalization=self._manifest.normalization,
            )
            out_chunks.append(self.embed_batch(tensor))

        if not out_chunks:
            return np.empty((0, self._manifest.embeddingDim), dtype=np.float32)
        return np.concatenate(out_chunks, axis=0)
