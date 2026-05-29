"""Sentry error-tracking init for the Binderly Python service.

SCAFFOLDING MODE (Stage 11, T-DP-MONITORING): this is the wiring seam
for Sentry on the Python side. It is **inert until two things are
true**: a DSN is present (``API_PYTHON_SENTRY_DSN`` or the ``dsn``
argument) *and* the ``sentry-sdk`` package is installed (or an
``initializer`` is injected). Until then :func:`init_sentry` is a
guaranteed no-op that never raises — importing it is always safe.

Why ``sentry-sdk`` is not yet a dependency in ``pyproject.toml``: the
service has no HTTP entrypoint yet (Q-021 / #FU-53), so there is no
long-lived process to instrument. We scaffold the init + env wiring now
and add ``sentry-sdk`` at go-live alongside the FastAPI entrypoint — see
``infra/monitoring/README.md`` and ``infra/DEPLOYMENT_SECRETS.md``.

Typical go-live call (from the future ``binderly_api.main`` ASGI app)::

    from observability import init_sentry

    result = init_sentry(environment="production")
    if not result.enabled:
        logger.warning("sentry disabled: %s", result.reason)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Callable, Mapping, Optional

#: Canonical env var holding the Sentry DSN for the Python service.
SENTRY_DSN_ENV = "API_PYTHON_SENTRY_DSN"

#: An injectable Sentry initializer. Receives the resolved DSN + the
#: environment name. At go-live the default path calls
#: ``sentry_sdk.init`` directly; tests inject a spy instead.
SentryInitializer = Callable[[str, Optional[str]], None]


@dataclass(frozen=True)
class SentryInitResult:
    """Outcome of an :func:`init_sentry` call.

    ``enabled`` is True only when Sentry was actually initialized.
    ``reason`` is a stable machine-readable token describing why it was
    skipped (or ``"initialized"`` on success) — handy for a one-line
    structured log at boot.
    """

    enabled: bool
    reason: str


def init_sentry(
    dsn: Optional[str] = None,
    *,
    environment: Optional[str] = None,
    initializer: Optional[SentryInitializer] = None,
    env: Optional[Mapping[str, str]] = None,
) -> SentryInitResult:
    """Initialize Sentry if (and only if) it is configured.

    Resolution order for the DSN: the explicit ``dsn`` argument, then
    ``env[SENTRY_DSN_ENV]`` (defaults to ``os.environ``). When no DSN is
    found this returns ``SentryInitResult(False, "no_dsn")`` and does
    nothing.

    When a DSN is present:

    - If ``initializer`` is supplied, it is invoked (used by tests and
      as the go-live extension point) → ``"initialized"``.
    - Otherwise we lazily ``import sentry_sdk`` and call
      ``sentry_sdk.init(dsn=..., environment=...)``. If the package is
      not installed we return ``"sdk_missing"`` without raising, so a
      misconfigured-but-not-yet-provisioned environment degrades to a
      no-op rather than crashing the process.
    """

    source = os.environ if env is None else env
    resolved = dsn if _non_empty(dsn) else source.get(SENTRY_DSN_ENV)
    if not _non_empty(resolved):
        return SentryInitResult(enabled=False, reason="no_dsn")

    assert resolved is not None  # narrowed by _non_empty above

    if initializer is not None:
        initializer(resolved, environment)
        return SentryInitResult(enabled=True, reason="initialized")

    try:
        import sentry_sdk  # noqa: PLC0415 (lazy: optional dep, only at go-live)
    except ImportError:
        return SentryInitResult(enabled=False, reason="sdk_missing")

    sentry_sdk.init(dsn=resolved, environment=environment)
    return SentryInitResult(enabled=True, reason="initialized")


def _non_empty(value: Optional[str]) -> bool:
    return isinstance(value, str) and len(value) > 0
