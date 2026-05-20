"""Shared types for the auction archive scrapers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


VALID_AUCTION_HOUSES = frozenset({"pwcc", "goldin"})
VALID_GRADING_COMPANIES = frozenset({"PSA", "BGS", "CGC", "SGC", "unknown"})

PARSER_VERSION = "1.0.0"


@dataclass
class AuctionLotObservation:
    """One realised auction lot observation from PWCC or Goldin.

    This is the canonical in-memory shape before writing to either
    `auction_lot_observation` or `grading_training_sample`.

    ``lot_id`` is the auction-house-scoped identifier; combined with
    ``auction_house`` it forms the dedup key ``(auction_house, lot_id)``.

    Graded-lot fields (``parsed_grading_company``, ``parsed_overall_grade``,
    ``parsed_sub_grades``) are populated by ``grade_parser.parse_lot_title()``;
    they are all ``None`` / ``"unknown"`` for raw/ungraded lots.

    ``realised_price_cents`` is stored in the smallest currency unit (US cents,
    pence, etc.) to avoid floating-point rounding.
    """

    lot_id: str
    auction_house: str
    lot_title: str
    parser_version: str = PARSER_VERSION

    auction_id: Optional[str] = None
    auction_name: Optional[str] = None

    parsed_grading_company: Optional[str] = None
    parsed_overall_grade: Optional[float] = None
    parsed_sub_grades: Optional[dict] = None

    realised_price_cents: Optional[int] = None
    currency_code: Optional[str] = None
    realised_premium_cents: Optional[int] = None

    closed_at: Optional[datetime] = None
    printing_id: Optional[str] = None

    lot_image_urls: list[str] = field(default_factory=list)
    raw_html_sha256: Optional[str] = None
    fetched_at: Optional[datetime] = None

    def __post_init__(self) -> None:
        if self.auction_house not in VALID_AUCTION_HOUSES:
            raise ValueError(
                f"auction_house must be one of {sorted(VALID_AUCTION_HOUSES)!r}, "
                f"got {self.auction_house!r}"
            )
        if not self.lot_id:
            raise ValueError("lot_id must be a non-empty string")
        if not self.lot_title:
            raise ValueError("lot_title must be a non-empty string")
        if self.parsed_grading_company is not None:
            if self.parsed_grading_company not in VALID_GRADING_COMPANIES:
                raise ValueError(
                    f"parsed_grading_company must be one of "
                    f"{sorted(VALID_GRADING_COMPANIES)!r}, "
                    f"got {self.parsed_grading_company!r}"
                )

    @property
    def is_graded(self) -> bool:
        """Return True if the lot was identified as a graded slab."""
        return (
            self.parsed_grading_company is not None
            and self.parsed_grading_company != "unknown"
        )
