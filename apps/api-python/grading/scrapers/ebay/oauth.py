"""eBay Finding API credentials wrapper.

The Legacy Finding API authenticates via a plain ``SECURITY-APPNAME`` query
parameter (the eBay App ID / Client ID).  No OAuth token exchange is required,
unlike the Browse API.

Mock-by-default: when ``EBAY_GRADING_LIVE`` is unset or falsy, the App ID
falls back to the ``EBAY_APP_ID`` env var if set, otherwise to the static
fixture string ``"TEST-APP-ID"``.  No HTTP calls are made.
"""

from __future__ import annotations

import os


# Static fixture App ID used in test / mock mode.
FIXTURE_APP_ID: str = "TEST-APP-ID"

# Env-var name that gates live mode.
LIVE_MODE_ENV_VAR: str = "EBAY_GRADING_LIVE"

# Env-var for the real eBay App ID (Client ID).
APP_ID_ENV_VAR: str = "EBAY_APP_ID"


def get_app_id() -> str:
    """Return the eBay App ID to use for Finding API calls.

    In live mode (``EBAY_GRADING_LIVE=1``), reads ``EBAY_APP_ID`` from the
    environment and raises :class:`RuntimeError` when it's absent.

    In mock/test mode, returns ``FIXTURE_APP_ID`` (``"TEST-APP-ID"``) without
    touching the environment.
    """
    if _is_live():
        app_id = os.environ.get(APP_ID_ENV_VAR, "")
        if not app_id:
            raise RuntimeError(
                f"EBAY_GRADING_LIVE=1 is set but {APP_ID_ENV_VAR!r} is empty. "
                "Set your eBay App ID (Client ID) in the environment."
            )
        return app_id
    return FIXTURE_APP_ID


def is_live_mode() -> bool:
    """Return True when live eBay API calls are enabled."""
    return _is_live()


def _is_live() -> bool:
    return os.environ.get(LIVE_MODE_ENV_VAR, "").strip() == "1"
