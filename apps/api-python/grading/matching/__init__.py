"""Printing-match backfill (T-GR-DATA-PRINTING-MATCH / #FU-40).

Many scraped grading / price observation rows land with ``printing_id`` NULL
because the FK could not be resolved at ingest time (the scrapers deliberately
leave it null rather than corrupt the catalog join — see the schema comments on
``ebay_graded_listing_observation`` / ``auction_lot_observation`` /
``grading_training_sample``).

This package resolves those NULLs *after the fact* by fuzzy-matching the
observation's free-text card/set/number/variant description against the
canonical ``printing`` / ``card`` / ``set`` catalog, then backfilling the
matched rows with an ``UPDATE`` (NOT a migration — this is a pure data backfill,
consistent with #FU-38 / #FU-39).

Mock-by-default / dry-run-by-default
------------------------------------
``PrintingMatcher`` is pure (catalog + text in, ``MatchResult`` out) so it runs
with no DB connection.  ``backfill`` is dry-run by default and only issues live
``UPDATE``\\s when ``SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY`` are present
*and* dry-run is explicitly disabled — the same env-gated pattern the scrapers'
writers use.

Public surface::

    from grading.matching import (
        CanonicalPrinting,
        MatchResult,
        MatchStatus,
        PrintingMatcher,
        parse_observation,
        run_backfill,
        BackfillReport,
    )
"""

from grading.matching.backfill import (
    BackfillReport,
    PlannedUpdate,
    run_backfill,
)
from grading.matching.matcher import PrintingMatcher
from grading.matching.text import ObservationQuery, normalize, parse_observation
from grading.matching.types import CanonicalPrinting, MatchResult, MatchStatus

__all__ = [
    "CanonicalPrinting",
    "MatchResult",
    "MatchStatus",
    "PrintingMatcher",
    "ObservationQuery",
    "parse_observation",
    "normalize",
    "run_backfill",
    "BackfillReport",
    "PlannedUpdate",
]
