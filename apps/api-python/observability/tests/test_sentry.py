"""Tests for the inert-until-configured Sentry init seam."""

from __future__ import annotations

import importlib.util

import pytest

from observability import SENTRY_DSN_ENV, init_sentry

_SENTRY_SDK_INSTALLED = importlib.util.find_spec("sentry_sdk") is not None


def test_no_dsn_is_a_noop() -> None:
    result = init_sentry(env={})
    assert result.enabled is False
    assert result.reason == "no_dsn"


def test_empty_dsn_env_is_treated_as_absent() -> None:
    result = init_sentry(env={SENTRY_DSN_ENV: ""})
    assert result.enabled is False
    assert result.reason == "no_dsn"


def test_explicit_dsn_invokes_injected_initializer() -> None:
    calls: list[tuple[str, str | None]] = []

    def fake_init(dsn: str, environment: str | None) -> None:
        calls.append((dsn, environment))

    result = init_sentry(
        dsn="https://abc@o1.ingest.sentry.io/1",
        environment="production",
        initializer=fake_init,
        env={},
    )

    assert result.enabled is True
    assert result.reason == "initialized"
    assert calls == [("https://abc@o1.ingest.sentry.io/1", "production")]


def test_dsn_from_env_is_resolved() -> None:
    calls: list[str] = []

    result = init_sentry(
        initializer=lambda dsn, _env: calls.append(dsn),
        env={SENTRY_DSN_ENV: "https://from-env@o1.ingest.sentry.io/2"},
    )

    assert result.enabled is True
    assert calls == ["https://from-env@o1.ingest.sentry.io/2"]


def test_explicit_dsn_overrides_env() -> None:
    seen: list[str] = []

    init_sentry(
        dsn="https://explicit@o1.ingest.sentry.io/9",
        initializer=lambda dsn, _env: seen.append(dsn),
        env={SENTRY_DSN_ENV: "https://from-env@o1.ingest.sentry.io/2"},
    )

    assert seen == ["https://explicit@o1.ingest.sentry.io/9"]


@pytest.mark.skipif(
    _SENTRY_SDK_INSTALLED,
    reason="sentry-sdk is not a dependency until go-live; this asserts the no-op fallback",
)
def test_missing_sdk_degrades_to_noop_without_raising() -> None:
    # `sentry-sdk` is intentionally NOT a dependency until go-live, so the
    # default (no injected initializer) path must report `sdk_missing`
    # rather than crash.
    result = init_sentry(dsn="https://abc@o1.ingest.sentry.io/1", env={})
    assert result.enabled is False
    assert result.reason == "sdk_missing"
