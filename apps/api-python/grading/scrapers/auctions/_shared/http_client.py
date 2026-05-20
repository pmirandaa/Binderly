"""Rate-limited HTTP client for auction archive scrapers.

Design:
- Uses ``httpx`` (sync) for simplicity; async upgrade is a drop-in swap.
- Configurable delay between requests (default 3 s) to be polite.
- Identifies as the Binderly grading-data-pipeline with a contact email
  placeholder so site operators can reach out.
- Live network access is gated behind the ``AUCTIONS_LIVE`` environment
  variable (default: off). When ``AUCTIONS_LIVE != "1"`` any call to
  ``get()`` raises ``LiveModeDisabledError`` — callers are expected to
  use the ``mock`` fixture path instead.
- ToS posture: only archive (closed-lot) paths are fetched; live bidding
  endpoints are never called; ``robots.txt`` is respected via the docstring
  policy and the Disallow list documented in each fetcher.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

import httpx


BINDERLY_USER_AGENT = (
    "Binderly-GradingDataPipeline/1.0 "
    "(grading-research; contact: data@binderly.app)"
)

_DEFAULT_DELAY_SECONDS = 3.0
_DEFAULT_TIMEOUT_SECONDS = 30.0


class LiveModeDisabledError(RuntimeError):
    """Raised when a live HTTP fetch is attempted without AUCTIONS_LIVE=1."""


class AuctionHttpClient:
    """Thin httpx wrapper with rate-limiting and mock-mode gate.

    Usage::

        client = AuctionHttpClient()

        # In tests / default mode — pass HTML bytes directly:
        html = Path("fixtures/psa_lot.html").read_bytes()

        # In live mode (AUCTIONS_LIVE=1):
        html = client.get("https://www.pwccmarketplace.com/items/12345")

    ``get()`` raises ``LiveModeDisabledError`` when ``AUCTIONS_LIVE != "1"``.
    Call ``get_fixture()`` to load a local HTML fixture regardless of mode.
    """

    def __init__(
        self,
        *,
        delay_seconds: float = _DEFAULT_DELAY_SECONDS,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        user_agent: str = BINDERLY_USER_AGENT,
    ) -> None:
        self._delay = delay_seconds
        self._last_request_at: Optional[float] = None
        self._client = httpx.Client(
            headers={"User-Agent": user_agent},
            timeout=timeout_seconds,
            follow_redirects=True,
        )

    @property
    def live_mode(self) -> bool:
        return os.environ.get("AUCTIONS_LIVE", "0") == "1"

    def get(self, url: str) -> bytes:
        """Fetch ``url`` and return raw response bytes.

        Raises:
            LiveModeDisabledError: when ``AUCTIONS_LIVE != "1"``.
            httpx.HTTPError: on network / HTTP errors in live mode.
        """
        if not self.live_mode:
            raise LiveModeDisabledError(
                f"Live network fetch attempted for {url!r} but AUCTIONS_LIVE "
                "is not set to '1'. Use mock fixtures in tests or set "
                "AUCTIONS_LIVE=1 to enable live scraping."
            )
        self._rate_limit()
        response = self._client.get(url)
        response.raise_for_status()
        return response.content

    def get_fixture(self, path: Path) -> bytes:
        """Return the bytes of a local fixture file (ignores live-mode gate)."""
        return path.read_bytes()

    def _rate_limit(self) -> None:
        if self._last_request_at is not None:
            elapsed = time.monotonic() - self._last_request_at
            remaining = self._delay - elapsed
            if remaining > 0:
                time.sleep(remaining)
        self._last_request_at = time.monotonic()

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "AuctionHttpClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
