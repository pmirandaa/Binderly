"""Tests for matching/matcher.py — the four match outcomes.

Catalog (see fixtures/catalog.json):
    P1 Charizard / Base Set / #4 / Unlimited
    P2 Charizard / Base Set / #4 / Shadowless+1st Edition
    P3 Blastoise / Base Set / #2 / Unlimited
    P4 Venusaur  / Base Set / #15 / Unlimited
    P5 Dark Charizard / Team Rocket / #4 / Holo
"""

from __future__ import annotations

from grading.matching.matcher import PrintingMatcher
from grading.matching.types import MatchStatus

P1 = "11111111-1111-1111-1111-111111111111"
P2 = "22222222-2222-2222-2222-222222222222"
P3 = "33333333-3333-3333-3333-333333333333"
P4 = "44444444-4444-4444-4444-444444444444"


class TestExactMatch:
    def test_exact_unique_card(self, matcher):
        # Unique name + exact number + set → EXACT, writes P3.
        res = matcher.match_text("1999 Pokemon Base Set Blastoise #2 Unlimited Holo")
        assert res.status is MatchStatus.EXACT
        assert res.printing_id == P3
        assert res.is_resolved

    def test_variant_breaks_tie_to_exact(self, matcher):
        # Two Charizard #4 printings exist; the SHADOWLESS hint disambiguates.
        res = matcher.match_text("BGS 9.5 Charizard Base Set #4 Shadowless 1st Edition")
        assert res.printing_id == P2
        assert res.is_resolved


class TestFuzzyMatch:
    def test_name_typo_is_fuzzy(self, matcher):
        # "Venusar" is a typo of Venusaur → high but not perfect name score.
        res = matcher.match_text("PSA 9 Venusar Base Set #15 Holo")
        assert res.status is MatchStatus.FUZZY
        assert res.printing_id == P4
        assert res.is_resolved

    def test_fuzzy_score_below_exact_name_threshold(self, matcher):
        res = matcher.match_text("PSA 9 Venusar Base Set #15 Holo")
        # The winning candidate's name score is high but imperfect.
        assert 0.8 <= res.candidates[0].name_score < 0.97


class TestAmbiguous:
    def test_two_equal_printings_left_null(self, matcher):
        # Charizard #4 with no variant hint → P1 vs P2 tie → leave NULL.
        res = matcher.match_text("PSA 10 GEM MT Pokemon Base Set Charizard #4")
        assert res.status is MatchStatus.AMBIGUOUS
        assert res.printing_id is None
        assert not res.is_resolved

    def test_ambiguous_margin_is_tiny(self, matcher):
        res = matcher.match_text("PSA 10 Pokemon Base Set Charizard #4")
        assert res.margin < 0.06


class TestNoMatch:
    def test_card_not_in_catalog(self, matcher):
        res = matcher.match_text("PSA 10 Mewtwo Neo Genesis #10 Holo")
        assert res.status is MatchStatus.NO_MATCH
        assert res.printing_id is None

    def test_wrong_number_penalised(self, matcher):
        # Right card name but a number that matches nothing → not resolved.
        res = matcher.match_text("Charizard Base Set #999")
        assert res.printing_id is None
        assert res.status in (MatchStatus.NO_MATCH, MatchStatus.AMBIGUOUS)


class TestMatcherBasics:
    def test_len_reflects_catalog(self, matcher):
        assert len(matcher) == 5

    def test_empty_catalog_is_no_match(self):
        m = PrintingMatcher([])
        res = m.match_text("Charizard Base Set #4")
        assert res.status is MatchStatus.NO_MATCH
        assert res.printing_id is None

    def test_candidates_sorted_descending(self, matcher):
        res = matcher.match_text("Blastoise Base Set #2")
        scores = [c.score for c in res.candidates]
        assert scores == sorted(scores, reverse=True)
