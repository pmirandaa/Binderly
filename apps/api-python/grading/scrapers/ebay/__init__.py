"""eBay sold-listings scraper for graded Pokémon card slabs.

Fetches completed eBay listings via the Legacy Finding API
``findCompletedItems`` and stores structured observations in
``ebay_graded_listing_observation`` + ``grading_training_sample``.

Mock-by-default: no live HTTP calls unless ``EBAY_GRADING_LIVE=1``.
"""

from .parser import parse_title
from .scraper import EbayScraper, ScrapeConfig
from .types import EbayGradedListingObservation, PARSER_VERSION

__all__ = [
    "EbayGradedListingObservation",
    "EbayScraper",
    "PARSER_VERSION",
    "ScrapeConfig",
    "parse_title",
]
