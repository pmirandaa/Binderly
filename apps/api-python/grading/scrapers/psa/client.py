"""Rate-limited HTTP client for PSA cert pages.

Key design decisions:

1. **Mock-by-default** — live HTTP is gated behind the ``PSA_LIVE``
   environment variable.  When ``PSA_LIVE`` is absent or falsy the
   ``fetch_html`` method raises ``LiveFetchDisabledError`` so tests can
   never accidentally hit the real PSA website.

2. **Rate limiting** — a configurable per-request delay (``delay_secs``,
   default 2.0) is enforced via ``asyncio.sleep`` in the async path and
   ``time.sleep`` in the sync path.  The ``rules/07-grading.md`` hard rule
   is ≤ 1 req/sec; we default to 2 s for headroom.

3. **ToS block detection** — ``PsaParser.is_blocked(html)`` is called on
   every response body.  A Cloudflare challenge or "blocked" response raises
   ``TosBlockError``, which the job runner uses to halt the batch.

4. **Exponential backoff** — 429 / 5xx responses are retried up to
   ``max_retries`` times (default 3) with delays of
   ``backoff_base * 2^attempt`` seconds.

5. **Browser-swap seam** — ``fetch_html`` is a regular instance method
   (not a final/sealed class).  Sub-classes or monkey-patches can override
   it to swap in a playwright / selenium backend for JS-rendered pages
   without touching any other component.

No playwright / selenium / chrome is introduced here.  If PSA requires JS
rendering, the ``PSA_LIVE=1`` smoke run will surface the problem and a
browser backend can be wired via ``#FU-37``.
"""

from __future__ import annotations

import os
import time
from typing import Optional

import httpx

from .parser import PsaParser

PSA_BASE_URL = "https://www.psacard.com"
PSA_CERT_PATH = "/cert/{cert_number}"

USER_AGENT = (
    "Binderly-GradingDataPipeline/1.0 "
    "(+https://binderly.app; data@binderly.app)"
)


class LiveFetchDisabledError(RuntimeError):
    """Raised when a live PSA fetch is attempted without ``PSA_LIVE=1``."""


class TosBlockError(RuntimeError):
    """Raised when PSA returns a ToS block / Cloudflare challenge page.

    The job runner catches this and halts the batch to avoid burning
    requests against a blocked session.
    """

    def __init__(self, cert_number: str, status_code: Optional[int] = None) -> None:
        self.cert_number = cert_number
        self.status_code = status_code
        super().__init__(
            f"ToS block detected for cert {cert_number!r} "
            f"(HTTP {status_code or 'unknown'})"
        )


class PsaClient:
    """Rate-limited HTTP client for PSA cert pages.

    Args:
        delay_secs: Minimum seconds between consecutive fetches.
            Default 2.0. The ``rules/07-grading.md`` hard limit is ≤ 1 req/s;
            the default of 2 s is deliberately conservative.
        max_retries: Maximum number of retries on 429 / 5xx responses.
        backoff_base: Base delay in seconds for exponential back-off.
        base_url: Override for testing or alternative PSA endpoints.
        timeout: httpx request timeout in seconds.
    """

    def __init__(
        self,
        *,
        delay_secs: float = 2.0,
        max_retries: int = 3,
        backoff_base: float = 2.0,
        base_url: str = PSA_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        self.delay_secs = delay_secs
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._last_fetch_time: float = 0.0
        self._parser = PsaParser()

    # ── public API ────────────────────────────────────────────────────────────

    def is_live_enabled(self) -> bool:
        """Return True iff ``PSA_LIVE`` env var is set and truthy."""
        return os.environ.get("PSA_LIVE", "0").strip().lower() not in ("0", "", "false", "no")

    def cert_url(self, cert_number: str) -> str:
        """Return the canonical PSA cert page URL."""
        path = PSA_CERT_PATH.format(cert_number=cert_number)
        return f"{self.base_url}{path}"

    def fetch_html(self, cert_number: str) -> bytes:
        """Fetch the PSA cert page for ``cert_number`` and return raw HTML.

        Raises:
            LiveFetchDisabledError: when ``PSA_LIVE`` is not set.
            TosBlockError: when PSA returns a Cloudflare or block page.
            httpx.HTTPStatusError: on permanent 4xx (non-429) responses.
            httpx.TimeoutException: on network timeout.
        """
        if not self.is_live_enabled():
            raise LiveFetchDisabledError(
                "Live PSA fetching is disabled. Set PSA_LIVE=1 to enable."
            )

        url = self.cert_url(cert_number)
        return self._fetch_with_retry(url, cert_number)

    # ── internals ─────────────────────────────────────────────────────────────

    def _enforce_rate_limit(self) -> None:
        """Sleep to enforce ``delay_secs`` between requests."""
        elapsed = time.monotonic() - self._last_fetch_time
        wait = self.delay_secs - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_fetch_time = time.monotonic()

    def _fetch_with_retry(self, url: str, cert_number: str) -> bytes:
        headers = {"User-Agent": USER_AGENT}
        last_exc: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            if attempt > 0:
                backoff = self.backoff_base * (2 ** (attempt - 1))
                time.sleep(backoff)

            self._enforce_rate_limit()

            try:
                resp = httpx.get(url, headers=headers, timeout=self.timeout, follow_redirects=True)
            except httpx.TimeoutException as exc:
                last_exc = exc
                continue

            # ToS block check — takes priority over status code.
            if PsaParser.is_blocked(resp.content):
                raise TosBlockError(cert_number, resp.status_code)

            if resp.status_code == 429 or resp.status_code >= 500:
                last_exc = httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}",
                    request=resp.request,
                    response=resp,
                )
                continue

            resp.raise_for_status()
            return resp.content

        if last_exc is not None:
            raise last_exc
        raise RuntimeError(f"Fetch failed for cert {cert_number!r} after {self.max_retries} retries")
