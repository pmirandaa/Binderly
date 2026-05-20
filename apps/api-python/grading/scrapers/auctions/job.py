"""End-to-end auction archive scraper job runner.

Orchestrates the PWCC and Goldin fetchers and returns a combined result.
In mock mode (default, ``AUCTIONS_LIVE != "1"``), all data comes from
checked-in HTML fixtures and no network requests are made.

Usage::

    from grading.scrapers.auctions.job import run_job

    result = run_job(mock=True)
    print(f"PWCC: {len(result.pwcc_observations)} lots")
    print(f"Goldin: {len(result.goldin_observations)} lots")
    print(f"Skipped raw: {result.skipped_raw_total}")
    print(f"Errors: {result.errors}")

The job does NOT write to the database; callers are responsible for
flushing ``result.pwcc_observations + result.goldin_observations`` into
``auction_lot_observation`` (and optionally ``grading_training_sample``).
This keeps the job runner testable without a DB connection.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .goldin.fetcher import GoldinFetchResult, GoldinFetcher
from .pwcc.fetcher import PwccFetchResult, PwccFetcher
from ._shared.types import AuctionLotObservation


@dataclass
class JobResult:
    """Combined result from running both PWCC and Goldin scrapers."""

    pwcc_observations: list[AuctionLotObservation] = field(default_factory=list)
    goldin_observations: list[AuctionLotObservation] = field(default_factory=list)
    pwcc_skipped_raw: int = 0
    goldin_skipped_raw: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def all_observations(self) -> list[AuctionLotObservation]:
        return self.pwcc_observations + self.goldin_observations

    @property
    def skipped_raw_total(self) -> int:
        return self.pwcc_skipped_raw + self.goldin_skipped_raw

    @property
    def total_observations(self) -> int:
        return len(self.pwcc_observations) + len(self.goldin_observations)


def run_job(*, mock: bool = True) -> JobResult:
    """Run the auction archive scraper job.

    Args:
        mock: When ``True`` (default), use fixture HTML files instead of
            live network requests.  Set ``mock=False`` and ``AUCTIONS_LIVE=1``
            to enable live scraping.

    Returns:
        ``JobResult`` with observations from both PWCC and Goldin.
    """
    pwcc_fetcher = PwccFetcher()
    goldin_fetcher = GoldinFetcher()

    if mock:
        pwcc_result: PwccFetchResult = pwcc_fetcher.fetch_mock()
        goldin_result: GoldinFetchResult = goldin_fetcher.fetch_mock()
    else:
        raise NotImplementedError(
            "Live job mode is not implemented in this version. "
            "Provide auction slugs/IDs via fetcher.fetch_auction() directly, "
            "or set AUCTIONS_LIVE=1 and call each fetcher explicitly."
        )

    errors: list[str] = []
    errors.extend(f"pwcc: {e}" for e in pwcc_result.errors)
    errors.extend(f"goldin: {e}" for e in goldin_result.errors)

    return JobResult(
        pwcc_observations=pwcc_result.observations,
        goldin_observations=goldin_result.observations,
        pwcc_skipped_raw=pwcc_result.skipped_raw,
        goldin_skipped_raw=goldin_result.skipped_raw,
        errors=errors,
    )
