"""Binderly Python observability scaffolding (Stage 11, T-DP-MONITORING).

Error tracking via Sentry, wired so it is a no-op until a DSN is
provisioned (and the ``sentry-sdk`` dependency is added at go-live).
Product analytics (PostHog) on the Python side is not in scope today —
the Python service has no HTTP entrypoint to instrument yet (Q-021 /
#FU-53); add it alongside the FastAPI app.

See ``infra/monitoring/README.md`` for the go-live runbook.
"""

from observability.sentry import (
    SENTRY_DSN_ENV,
    SentryInitResult,
    init_sentry,
)

__all__ = [
    "SENTRY_DSN_ENV",
    "SentryInitResult",
    "init_sentry",
]
