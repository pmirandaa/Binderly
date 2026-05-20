"""Image preprocessing + vector normalisation utilities.

The preprocessor names registered here are referenced by name from the
manifest's ``normalization`` field. The on-device TypeScript loader
must implement the same name → recipe mapping (see
``apps/mobile/src/scanner/embed/embed.ts``).

Adding a recipe requires updating BOTH sides; the manifest's pydantic
validator rejects unknown names indirectly by way of the runtime
``preprocess_image`` lookup.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable

import numpy as np
from PIL import Image

# Public name → (resize, dtype, pixel-mapping) recipe. We keep this as a
# plain dict-of-callables instead of a class hierarchy because the
# recipes are tiny and we want the on-device TS side to mirror them
# trivially. Adding a recipe = adding a key on both sides.
_Preprocessor = Callable[[np.ndarray], np.ndarray]


def _mobilenet_v3(image_chw_uint8: np.ndarray) -> np.ndarray:
    """MobileNetV3 family — float32, scaled to ``[-1, 1]`` per channel.

    Mirrors ``tf.keras.applications.mobilenet_v3.preprocess_input`` for
    inputs already in the model's HWC RGB byte layout.
    """

    arr = image_chw_uint8.astype(np.float32)
    # tf.keras.applications.mobilenet_v3.preprocess_input: x / 127.5 - 1
    return (arr / 127.5) - 1.0


def _zero_one(image_chw_uint8: np.ndarray) -> np.ndarray:
    """Plain ``[0, 1]`` float32. Useful for test fixtures."""

    return image_chw_uint8.astype(np.float32) / 255.0


def _imagenet(image_chw_uint8: np.ndarray) -> np.ndarray:
    """ImageNet-mean/std normalisation. Reserved for future models."""

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr = image_chw_uint8.astype(np.float32) / 255.0
    return (arr - mean) / std


_RECIPES: dict[str, _Preprocessor] = {
    "mobilenet_v3": _mobilenet_v3,
    "zero_one": _zero_one,
    "imagenet": _imagenet,
}

# Snapshot for the TS side / docs.
PREPROCESSING_NAMES: tuple[str, ...] = tuple(_RECIPES.keys())


def preprocess_image(
    source: str | Path | Image.Image | np.ndarray,
    *,
    target_size: tuple[int, int],
    normalization: str,
) -> np.ndarray:
    """Load + resize + normalise an image to a model-ready tensor.

    ``source`` may be a path, a PIL ``Image``, or a HWC ``uint8`` numpy
    array. ``target_size`` is ``(height, width)`` to match TFLite's
    ``inputShape`` convention. The returned tensor has shape
    ``(height, width, 3)`` and dtype ``float32``.
    """

    if normalization not in _RECIPES:
        raise ValueError(
            f"unknown normalization {normalization!r}; "
            f"expected one of {sorted(_RECIPES)}"
        )

    if isinstance(source, np.ndarray):
        # Assume HWC uint8 RGB; the caller is responsible for upstream
        # decode if they hand us bytes.
        if source.ndim != 3 or source.shape[-1] != 3:
            raise ValueError(
                f"numpy source must be HWC RGB, got shape {source.shape!r}"
            )
        img = Image.fromarray(source.astype(np.uint8), mode="RGB")
    elif isinstance(source, Image.Image):
        img = source.convert("RGB")
    else:
        img = Image.open(source).convert("RGB")

    h, w = target_size
    # Pillow uses (width, height), TFLite + numpy use (height, width).
    img = img.resize((w, h), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.uint8)
    return _RECIPES[normalization](arr)


def preprocess_batch(
    sources: Iterable[str | Path | Image.Image | np.ndarray],
    *,
    target_size: tuple[int, int],
    normalization: str,
) -> np.ndarray:
    """Vectorised :func:`preprocess_image` returning ``(N, H, W, 3)``."""

    tensors = [
        preprocess_image(src, target_size=target_size, normalization=normalization)
        for src in sources
    ]
    if not tensors:
        return np.empty((0, *target_size, 3), dtype=np.float32)
    return np.stack(tensors, axis=0)


def l2_normalize(vectors: np.ndarray, *, eps: float = 1e-12) -> np.ndarray:
    """Row-wise L2 normalisation of a 1-D or 2-D float array.

    A zero-vector is mapped to itself (rather than NaN) — important for
    test fixtures that occasionally synthesise all-zero embeddings.
    """

    if vectors.ndim == 1:
        norm = float(np.linalg.norm(vectors))
        if norm < eps:
            return vectors.astype(np.float32, copy=True)
        return (vectors / norm).astype(np.float32, copy=False)

    if vectors.ndim != 2:
        raise ValueError(f"expected 1-D or 2-D array, got shape {vectors.shape!r}")

    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    safe_norms = np.where(norms < eps, 1.0, norms)
    return (vectors / safe_norms).astype(np.float32, copy=False)
