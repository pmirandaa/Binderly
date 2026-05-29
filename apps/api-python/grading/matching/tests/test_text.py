"""Tests for matching/text.py — normalisation + observation parsing."""

from __future__ import annotations

import pytest

from grading.matching.text import (
    normalize,
    normalize_number,
    parse_observation,
)


class TestNormalize:
    def test_lowercases_and_strips_punctuation(self):
        assert normalize("PSA 10 — Charizard!!") == "psa 10 charizard"

    def test_collapses_whitespace(self):
        assert normalize("  Base   Set  ") == "base set"


class TestNormalizeNumber:
    def test_strips_leading_zeros(self):
        assert normalize_number("004") == "4"

    def test_strips_hash(self):
        assert normalize_number("#15") == "15"

    def test_alpha_prefix_preserved(self):
        assert normalize_number("SWSH001") == "swsh1"

    def test_alpha_suffix_preserved(self):
        assert normalize_number("001a") == "1a"

    def test_plain_passthrough(self):
        assert normalize_number("TG01") == "tg1"


class TestParseObservation:
    def test_extracts_hash_number(self):
        q = parse_observation("PSA 10 Charizard Base Set #4 1st Edition")
        assert q.number == "4"

    def test_extracts_fraction_number(self):
        q = parse_observation("Charizard 4/102 Base Set Holo")
        assert q.number == "4"

    def test_strips_grade_prefix_from_name(self):
        q = parse_observation("PSA 10 GEM MT Charizard Base Set #4")
        # 'psa', '10', 'gem', 'mt' must not leak into name tokens.
        assert "psa" not in q.name_tokens
        assert "10" not in q.name_tokens
        assert "charizard" in q.name_tokens

    def test_extracts_variant_flags(self):
        q = parse_observation("Charizard Base Set #4 Shadowless 1st Edition")
        assert "SHADOWLESS" in q.variant_flags
        assert "FIRST_EDITION" in q.variant_flags

    def test_drops_year_and_brand(self):
        q = parse_observation("1999 Pokemon Base Set Blastoise #2")
        assert "1999" not in q.name_tokens
        assert "pokemon" not in q.name_tokens
        assert "blastoise" in q.name_tokens

    def test_no_number_returns_none(self):
        q = parse_observation("Charizard Base Set Holo")
        assert q.number is None

    def test_empty_title_is_safe(self):
        q = parse_observation("")
        assert q.name_tokens == ()
        assert q.number is None

    def test_normalized_number_property(self):
        q = parse_observation("Charizard Base Set #004")
        assert q.normalized_number == "4"
