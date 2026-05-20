"""Image loader for grading ML models.

Mock-by-default: returns deterministic 256×256×3 float32 numpy arrays seeded
from the SHA-256 hash of the URL.  Live mode (``CORNERS_LIVE_IMAGES=1``) fetches
via ``httpx`` and caches to ``~/.cache/binderly/images/<sha256_of_url>``.

This is the seam where #FU-39 (image ingest pipeline) will swap in.

Usage::

    loader = ImageLoader()  # mock mode
    img = loader.load("https://cdn.example.com/front.jpg")
    # img.shape == (256, 256, 3), dtype == float32, values in [0.0, 1.0]

    live_loader = ImageLoader(live=True)  # set CORNERS_LIVE_IMAGES=1 or pass live=True
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Optional

import numpy as np


_CACHE_DIR = Path(os.environ.get("BINDERLY_IMAGE_CACHE", Path.home() / ".cache" / "binderly" / "images"))
_DEFAULT_SIZE = 256
_LIVE_ENV_VAR = "CORNERS_LIVE_IMAGES"


class ImageLoader:
    """Load card images as ``(H, W, 3)`` float32 numpy arrays.

    In mock mode (the default) every URL deterministically maps to a
    unique synthetic array — no network calls, no disk I/O.

    In live mode images are fetched via ``httpx``, resized to ``(size, size)``
    using ``Pillow``, and cached on disk.

    Args:
        live: Override mode.  If ``None`` (default), reads the
            ``CORNERS_LIVE_IMAGES`` env var (truthy iff the var is set to
            ``"1"``).
        size: Output square side length in pixels (default 256).
        cache_dir: Directory for the on-disk cache (live mode only).
    """

    def __init__(
        self,
        live: Optional[bool] = None,
        size: int = _DEFAULT_SIZE,
        cache_dir: Path = _CACHE_DIR,
    ) -> None:
        if live is None:
            live = os.environ.get(_LIVE_ENV_VAR, "0") == "1"
        self._live = live
        self._size = size
        self._cache_dir = cache_dir

    @property
    def is_live(self) -> bool:
        return self._live

    @property
    def size(self) -> int:
        return self._size

    def load(self, url: str) -> np.ndarray:
        """Return an ``(H, W, 3)`` float32 array for the given URL.

        Mock mode: deterministic, no side-effects.
        Live mode: fetches + caches; raises ``ImageFetchError`` on failure.
        """
        if self._live:
            return self._load_live(url)
        return self._load_mock(url)

    def load_batch(self, urls: list[str]) -> np.ndarray:
        """Return ``(N, H, W, 3)`` float32 array for a list of URLs."""
        arrays = [self.load(url) for url in urls]
        if not arrays:
            return np.zeros((0, self._size, self._size, 3), dtype=np.float32)
        return np.stack(arrays, axis=0)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _url_hash(self, url: str) -> str:
        return hashlib.sha256(url.encode()).hexdigest()

    def _load_mock(self, url: str) -> np.ndarray:
        """Deterministic 256×256×3 array seeded from URL hash."""
        seed = int(self._url_hash(url)[:8], 16) % (2**31)
        rng = np.random.default_rng(seed)
        return rng.random((self._size, self._size, 3), dtype=np.float32)

    def _load_live(self, url: str) -> np.ndarray:
        """Fetch URL → Pillow resize → numpy array, with disk cache."""
        url_hash = self._url_hash(url)
        cache_path = self._cache_dir / f"{url_hash}.npy"
        if cache_path.exists():
            return np.load(str(cache_path))

        try:
            import httpx
            from PIL import Image
            import io
        except ImportError as exc:
            raise ImportError(
                "Live image loading requires 'httpx' and 'Pillow'. "
                "Both are already in pyproject.toml dependencies."
            ) from exc

        try:
            response = httpx.get(url, timeout=30.0, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ImageFetchError(f"Failed to fetch {url!r}: {exc}") from exc

        try:
            pil_image = Image.open(io.BytesIO(response.content)).convert("RGB")
            pil_image = pil_image.resize((self._size, self._size), Image.LANCZOS)
            arr = (np.array(pil_image, dtype=np.float32) / 255.0)
        except Exception as exc:
            raise ImageFetchError(f"Failed to decode image from {url!r}: {exc}") from exc

        self._cache_dir.mkdir(parents=True, exist_ok=True)
        np.save(str(cache_path), arr)
        return arr


class ImageFetchError(RuntimeError):
    """Raised when live image fetching fails."""
