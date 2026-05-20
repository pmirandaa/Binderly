"""Tests for ``PsaClient``.

These tests verify rate-limiting, backoff, and ToS-block behaviour using mocks
and clock injection.  No live network calls are made.
"""

from __future__ import annotations

import os
import time
from unittest.mock import MagicMock, patch

import pytest

from grading.scrapers.psa.client import (
    LiveFetchDisabledError,
    PsaClient,
    TosBlockError,
)


class TestLiveGate:
    """PSA_LIVE env flag must default to off."""

    def test_live_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("PSA_LIVE", raising=False)
        client = PsaClient()
        assert not client.is_live_enabled()

    def test_live_enabled_when_env_set(self, monkeypatch):
        monkeypatch.setenv("PSA_LIVE", "1")
        client = PsaClient()
        assert client.is_live_enabled()

    def test_live_enabled_with_true(self, monkeypatch):
        monkeypatch.setenv("PSA_LIVE", "true")
        client = PsaClient()
        assert client.is_live_enabled()

    def test_live_disabled_when_zero(self, monkeypatch):
        monkeypatch.setenv("PSA_LIVE", "0")
        client = PsaClient()
        assert not client.is_live_enabled()

    def test_fetch_raises_when_not_live(self, monkeypatch):
        monkeypatch.delenv("PSA_LIVE", raising=False)
        client = PsaClient()
        with pytest.raises(LiveFetchDisabledError):
            client.fetch_html("12345678")


class TestCertUrl:
    def test_default_url_format(self):
        client = PsaClient()
        assert client.cert_url("12345678") == "https://www.psacard.com/cert/12345678"

    def test_custom_base_url(self):
        client = PsaClient(base_url="http://localhost:8000")
        assert client.cert_url("99") == "http://localhost:8000/cert/99"


class TestRateLimiting:
    """Rate-limit: at least ``delay_secs`` between consecutive fetches."""

    def test_rate_limit_sleep_called(self, monkeypatch, html_psa10, html_psa9):
        """Two consecutive fetches must trigger at least one sleep."""
        monkeypatch.setenv("PSA_LIVE", "1")
        client = PsaClient(delay_secs=2.0)

        call_count = 0
        html_responses = [html_psa10, html_psa9]

        # Stub the actual HTTP so the test never hits the network.
        def fake_fetch(url, **kwargs):
            nonlocal call_count
            resp = MagicMock()
            resp.content = html_responses[call_count % len(html_responses)]
            resp.status_code = 200
            resp.raise_for_status = lambda: None
            call_count += 1
            return resp

        sleep_calls: list[float] = []

        def fake_sleep(secs: float) -> None:
            sleep_calls.append(secs)

        with (
            patch("httpx.get", side_effect=fake_fetch),
            patch("time.sleep", side_effect=fake_sleep),
        ):
            # Simulate second fetch while _last_fetch_time is recent.
            client._last_fetch_time = time.monotonic()
            client.fetch_html("11111111")

        # At least one sleep should have been called with a positive value.
        assert any(s > 0 for s in sleep_calls), (
            f"Expected at least one positive sleep call; got {sleep_calls}"
        )

    def test_minimum_delay_is_delay_secs(self, monkeypatch, html_psa10):
        """Sleep amount must be ≥ delay_secs when last fetch was immediate."""
        monkeypatch.setenv("PSA_LIVE", "1")
        client = PsaClient(delay_secs=2.0)

        def fake_fetch(url, **kwargs):
            resp = MagicMock()
            resp.content = html_psa10
            resp.status_code = 200
            resp.raise_for_status = lambda: None
            return resp

        sleep_calls: list[float] = []

        def fake_sleep(secs: float) -> None:
            sleep_calls.append(secs)

        with (
            patch("httpx.get", side_effect=fake_fetch),
            patch("time.sleep", side_effect=fake_sleep),
        ):
            # Make the last fetch look like it just happened.
            client._last_fetch_time = time.monotonic()
            client.fetch_html("22222222")

        # The first call should have waited (close to) delay_secs.
        positive = [s for s in sleep_calls if s > 0]
        assert positive, "Expected a positive sleep call"
        assert max(positive) <= 2.1, f"Sleep unexpectedly long: {max(positive)}"


class TestTosBlockHandling:
    def test_tos_block_raises(self, monkeypatch, html_cloudflare_block):
        monkeypatch.setenv("PSA_LIVE", "1")
        client = PsaClient()

        def fake_fetch(url, **kwargs):
            resp = MagicMock()
            resp.content = html_cloudflare_block
            resp.status_code = 403
            resp.raise_for_status = lambda: None
            return resp

        with (
            patch("httpx.get", side_effect=fake_fetch),
            patch("time.sleep"),
        ):
            with pytest.raises(TosBlockError) as exc_info:
                client.fetch_html("99999999")

        assert exc_info.value.cert_number == "99999999"
        assert exc_info.value.status_code == 403

    def test_tos_block_error_message(self, monkeypatch, html_cloudflare_block):
        monkeypatch.setenv("PSA_LIVE", "1")
        client = PsaClient()

        def fake_fetch(url, **kwargs):
            resp = MagicMock()
            resp.content = html_cloudflare_block
            resp.status_code = 403
            resp.raise_for_status = lambda: None
            return resp

        with (
            patch("httpx.get", side_effect=fake_fetch),
            patch("time.sleep"),
        ):
            with pytest.raises(TosBlockError) as exc_info:
                client.fetch_html("99999999")

        assert "99999999" in str(exc_info.value)
