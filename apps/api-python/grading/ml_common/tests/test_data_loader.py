"""Tests for ml_common/data_loader.py."""

from __future__ import annotations

import pytest

from grading.ml_common.data_loader import (
    AuctionDataLoader,
    EbayDataLoader,
    MergedDataLoader,
    PSADataLoader,
)
from grading.ml_common.types import LabelledGradingSample


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _psa_rows():
    return [
        {
            "source_id": "00000001",
            "grade_company": "PSA",
            "grade": "9.0",
            "subgrades": {"centering": 9.0, "corners": 8.5, "edges": 9.0, "surface": 8.5},
            "images": {"front": "https://psa.com/img/1_front.jpg"},
            "printing_id": None,
            "raw_metadata": {},
        },
        {
            "source_id": "00000002",
            "grade_company": "PSA",
            "grade": "10.0",
            "subgrades": {"centering": 10.0, "corners": 9.5},
            "images": {"front": "https://psa.com/img/2_front.jpg"},
            "printing_id": None,
            "raw_metadata": {},
        },
        {
            "source_id": "00000003",
            "grade_company": "BGS",
            "grade": "9.5",
            "subgrades": {"corners": 9.0},
            "images": {},
            "printing_id": None,
            "raw_metadata": {},
        },
    ]


def _ebay_rows():
    return [
        {
            "listing_id": "eb-001",
            "parsed_grading_company": "PSA",
            "parsed_overall_grade": "8.0",
            "parsed_sub_grades": {"corners": 7.5},
            "thumbnail_url": "https://ebay.com/thumb/001.jpg",
            "printing_id": None,
            "title": "PSA 8 Charizard",
        },
        {
            "listing_id": "eb-002",
            "parsed_grading_company": "BGS",
            "parsed_overall_grade": "9.5",
            "parsed_sub_grades": None,
            "thumbnail_url": None,
            "printing_id": None,
            "title": "BGS 9.5 Pikachu",
        },
    ]


def _auction_rows():
    return [
        {
            "lot_id": "pwcc-100",
            "auction_house": "pwcc",
            "parsed_grading_company": "PSA",
            "parsed_overall_grade": "10.0",
            "parsed_sub_grades": {"corners": 10.0, "edges": 9.5},
            "lot_image_urls": [
                "https://pwcc.com/img/100_1.jpg",
                "https://pwcc.com/img/100_2.jpg",
            ],
            "printing_id": None,
            "lot_title": "PSA 10 Shadowless Charizard",
        },
        {
            "lot_id": "goldin-55",
            "auction_house": "goldin",
            "parsed_grading_company": "PSA",
            "parsed_overall_grade": "9.0",
            "parsed_sub_grades": {},
            "lot_image_urls": [],
            "printing_id": None,
            "lot_title": "PSA 9 Blastoise",
        },
    ]


# ---------------------------------------------------------------------------
# PSADataLoader
# ---------------------------------------------------------------------------


class TestPSADataLoader:
    def test_loads_psa_rows_only(self):
        loader = PSADataLoader(_psa_rows())
        samples = loader.load()
        assert all(s.source == "psa_cert" for s in samples)
        assert len(samples) == 2

    def test_corners_score_parsed(self):
        loader = PSADataLoader(_psa_rows())
        samples = loader.load()
        assert samples[0].corners_score == 8.5
        assert samples[1].corners_score == 9.5

    def test_image_urls_extracted(self):
        loader = PSADataLoader(_psa_rows())
        samples = loader.load()
        assert "https://psa.com/img/1_front.jpg" in samples[0].image_urls

    def test_overall_grade_parsed(self):
        loader = PSADataLoader(_psa_rows())
        samples = loader.load()
        assert samples[0].overall_grade == 9.0

    def test_len_counts_psa_only(self):
        loader = PSADataLoader(_psa_rows())
        assert len(loader) == 2

    def test_missing_corners_score_is_none(self):
        rows = [{"source_id": "x", "grade_company": "PSA", "grade": "8.0", "subgrades": {}, "images": {}, "printing_id": None, "raw_metadata": {}}]
        samples = PSADataLoader(rows).load()
        assert samples[0].corners_score is None


# ---------------------------------------------------------------------------
# EbayDataLoader
# ---------------------------------------------------------------------------


class TestEbayDataLoader:
    def test_loads_all_rows(self):
        loader = EbayDataLoader(_ebay_rows())
        samples = loader.load()
        assert len(samples) == 2

    def test_source_is_ebay_sold(self):
        samples = EbayDataLoader(_ebay_rows()).load()
        assert all(s.source == "ebay_sold" for s in samples)

    def test_corners_score(self):
        samples = EbayDataLoader(_ebay_rows()).load()
        assert samples[0].corners_score == 7.5
        assert samples[1].corners_score is None

    def test_null_thumbnail_produces_empty_urls(self):
        samples = EbayDataLoader(_ebay_rows()).load()
        assert samples[1].image_urls == []


# ---------------------------------------------------------------------------
# AuctionDataLoader
# ---------------------------------------------------------------------------


class TestAuctionDataLoader:
    def test_source_reflects_auction_house(self):
        samples = AuctionDataLoader(_auction_rows()).load()
        assert samples[0].source == "auction_pwcc"
        assert samples[1].source == "auction_goldin"

    def test_image_urls_from_array(self):
        samples = AuctionDataLoader(_auction_rows()).load()
        assert len(samples[0].image_urls) == 2

    def test_empty_sub_grades_gives_none_corners(self):
        samples = AuctionDataLoader(_auction_rows()).load()
        assert samples[1].corners_score is None


# ---------------------------------------------------------------------------
# MergedDataLoader
# ---------------------------------------------------------------------------


class TestMergedDataLoader:
    def test_all_returns_union(self):
        loader = MergedDataLoader(_psa_rows(), _ebay_rows(), _auction_rows())
        all_samples = loader.load_all()
        assert len(all_samples) == 6

    def test_labelled_filters_to_corners(self):
        loader = MergedDataLoader(_psa_rows(), _ebay_rows(), _auction_rows())
        labelled = loader.load_labelled()
        assert all(s.corners_score is not None for s in labelled)

    def test_len_matches_labelled_count(self):
        loader = MergedDataLoader(_psa_rows(), _ebay_rows(), _auction_rows())
        assert len(loader) == len(loader.load_labelled())

    def test_empty_sources(self):
        loader = MergedDataLoader([], [], [])
        assert loader.load_labelled() == []
        assert len(loader) == 0
