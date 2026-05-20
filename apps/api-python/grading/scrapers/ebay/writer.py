"""Observation writer — stdout JSONL or Supabase PostgREST upsert.

Two modes
---------
``stdout`` (default):
    Each observation is serialised to a JSON object and printed to stdout,
    one per line (JSONL).  Suitable for piping to a downstream consumer or
    for inspection during development.

``supabase``:
    Upserts rows into ``ebay_graded_listing_observation`` (and, optionally,
    ``grading_training_sample``) via the Supabase PostgREST REST API using
    httpx.  Activated when *both* ``SUPABASE_URL`` and
    ``SUPABASE_SERVICE_ROLE_KEY`` are set in the environment.

The writer never downloads or proxies ``thumbnail_url`` — that is deferred
to follow-up #FU-37.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime
from decimal import Decimal
from typing import Any, Iterable

from .types import EbayGradedListingObservation

log = logging.getLogger(__name__)

_SUPABASE_URL_ENV = "SUPABASE_URL"
_SERVICE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"

# PostgREST table names.
_TABLE_OBSERVATION = "ebay_graded_listing_observation"
_TABLE_TRAINING = "grading_training_sample"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def write_observations(
    observations: Iterable[EbayGradedListingObservation],
    *,
    mode: str | None = None,
    write_training_sample: bool = True,
) -> int:
    """Write all observations and return the count written.

    Parameters
    ----------
    observations:
        Iterable of :class:`~types.EbayGradedListingObservation`.
    mode:
        ``'stdout'`` or ``'supabase'``.  When ``None``, auto-detected: uses
        ``supabase`` if both env vars are present, else ``stdout``.
    write_training_sample:
        When ``True`` (default) and mode is ``supabase``, also upsert into
        ``grading_training_sample``.

    Returns
    -------
    int
        Number of observations written.
    """
    resolved_mode = mode or _detect_mode()
    count = 0
    for obs in observations:
        if resolved_mode == "supabase":
            _upsert_supabase(obs, write_training_sample=write_training_sample)
        else:
            _write_stdout(obs)
        count += 1
    return count


# ---------------------------------------------------------------------------
# Stdout writer
# ---------------------------------------------------------------------------


def _write_stdout(obs: EbayGradedListingObservation) -> None:
    sys.stdout.write(json.dumps(_to_json_dict(obs), default=_json_default) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Supabase writer
# ---------------------------------------------------------------------------


def _upsert_supabase(
    obs: EbayGradedListingObservation,
    *,
    write_training_sample: bool,
) -> None:
    import httpx  # imported lazily — not needed in stdout mode

    url = os.environ[_SUPABASE_URL_ENV].rstrip("/")
    key = os.environ[_SERVICE_KEY_ENV]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    # --- ebay_graded_listing_observation ---
    obs_payload = _to_json_dict(obs)
    resp = httpx.post(
        f"{url}/rest/v1/{_TABLE_OBSERVATION}",
        headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
        content=json.dumps([obs_payload], default=_json_default),
    )
    if resp.status_code not in (200, 201):
        log.error(
            "supabase upsert failed for listing %s: %s %s",
            obs.listing_id,
            resp.status_code,
            resp.text[:200],
        )
        return

    if not write_training_sample:
        return

    # --- grading_training_sample (secondary, best-effort) ---
    training_payload = _to_training_dict(obs)
    resp2 = httpx.post(
        f"{url}/rest/v1/{_TABLE_TRAINING}",
        headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
        content=json.dumps([training_payload], default=_json_default),
    )
    if resp2.status_code not in (200, 201):
        log.warning(
            "grading_training_sample upsert failed for listing %s: %s",
            obs.listing_id,
            resp2.status_code,
        )


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def _to_json_dict(obs: EbayGradedListingObservation) -> dict[str, Any]:
    return {
        "listing_id": obs.listing_id,
        "title": obs.title,
        "parsed_grading_company": obs.parsed_grading_company,
        "parsed_overall_grade": str(obs.parsed_overall_grade) if obs.parsed_overall_grade is not None else None,
        "parsed_sub_grades": obs.parsed_sub_grades,
        "final_price_cents": obs.final_price_cents,
        "currency_code": obs.currency_code,
        "sold_at": obs.sold_at.isoformat() if obs.sold_at else None,
        "thumbnail_url": obs.thumbnail_url,
        "raw_blob_json": obs.raw_blob_json,
        "parser_version": obs.parser_version,
        "fetched_at": obs.fetched_at.isoformat(),
    }


def _to_training_dict(obs: EbayGradedListingObservation) -> dict[str, Any]:
    """Map an observation to the ``grading_training_sample`` upsert payload."""
    return {
        "source": "ebay_sold",
        "source_id": obs.listing_id,
        "source_url": f"https://www.ebay.com/itm/{obs.listing_id}",
        "grade_company": obs.parsed_grading_company if obs.parsed_grading_company != "OTHER" else "OTHER",
        "grade": str(obs.parsed_overall_grade) if obs.parsed_overall_grade is not None else None,
        "subgrades": obs.parsed_sub_grades,
        "images": {"thumbnail": obs.thumbnail_url} if obs.thumbnail_url else {},
        "parse_confidence": str(obs.parse_confidence),
        "raw_metadata": {
            "title": obs.title,
            "final_price_cents": obs.final_price_cents,
            "currency_code": obs.currency_code,
            "sold_at": obs.sold_at.isoformat() if obs.sold_at else None,
            "parser_version": obs.parser_version,
        },
    }


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _detect_mode() -> str:
    if os.environ.get(_SUPABASE_URL_ENV) and os.environ.get(_SERVICE_KEY_ENV):
        return "supabase"
    return "stdout"
