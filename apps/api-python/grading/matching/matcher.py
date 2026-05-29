"""``PrintingMatcher`` — resolve a NULL ``printing_id`` from observation text.

Scoring (all pure-stdlib, no fuzzy-match dependency):

    composite = 0.75 * name_score + 0.25 * set_score
              + (number bonus / penalty)
              + variant bonus

where ``name_score`` / ``set_score`` are the mean best per-token
``difflib.SequenceMatcher`` ratio of the card-name / set-name tokens against the
observation-title tokens.

The card *number* is the strongest discriminator: an exact number match adds a
bonus, a number mismatch subtracts a larger penalty (a wrong number almost
always means a different card).  Variant hints (1st edition / shadowless / …)
break ties between otherwise-identical printings.

Decision:
    * ``best.composite < NO_MATCH_FLOOR``           → ``NO_MATCH``  (leave NULL)
    * top-two within ``AMBIGUOUS_MARGIN``           → ``AMBIGUOUS`` (leave NULL)
    * exact number + near-perfect name + set match  → ``EXACT``
    * otherwise (still confident + unique)           → ``FUZZY``

``AMBIGUOUS`` / ``NO_MATCH`` intentionally return ``printing_id=None``: a wrong
FK silently corrupts the catalog join, so we only write when confident.
"""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Iterable, Optional

from grading.matching.text import ObservationQuery, normalize, parse_observation
from grading.matching.types import (
    Candidate,
    CanonicalPrinting,
    MatchResult,
    MatchStatus,
)

# Tuning constants — conservative by design (favour leaving NULL over a wrong FK).
NAME_WEIGHT = 0.75
SET_WEIGHT = 0.25
NUMBER_BONUS = 0.15
NUMBER_PENALTY = 0.30
VARIANT_BONUS = 0.10
NO_MATCH_FLOOR = 0.55
AMBIGUOUS_MARGIN = 0.06
EXACT_NAME_THRESHOLD = 0.97
SET_MATCH_THRESHOLD = 0.60
TOP_N_CANDIDATES = 5


def _token_score(needle_tokens: list[str], haystack_tokens: list[str]) -> float:
    """Mean of the best per-needle-token fuzzy ratio against the haystack."""
    if not needle_tokens or not haystack_tokens:
        return 0.0
    total = 0.0
    for needle in needle_tokens:
        total += max(
            SequenceMatcher(None, needle, hay).ratio() for hay in haystack_tokens
        )
    return total / len(needle_tokens)


class PrintingMatcher:
    """Match observation text against a fixed catalog of canonical printings.

    Args:
        catalog: The flattened ``printing ⋈ card ⋈ set`` rows to match against.
            Supply DB-loaded rows in production, fixtures in tests.
    """

    def __init__(self, catalog: Iterable[CanonicalPrinting]) -> None:
        self._catalog = list(catalog)

    def __len__(self) -> int:
        return len(self._catalog)

    def match_text(self, title: str) -> MatchResult:
        """Convenience: parse a raw title then match."""
        return self.match(parse_observation(title))

    def match(self, query: ObservationQuery) -> MatchResult:
        haystack = normalize(query.raw).split()
        q_number = query.normalized_number
        q_flags = set(query.variant_flags)

        candidates: list[Candidate] = []
        for printing in self._catalog:
            name_score = _token_score(
                normalize(printing.card_name).split(), haystack
            )
            set_score = _token_score(normalize(printing.set_name).split(), haystack)
            set_match = set_score >= SET_MATCH_THRESHOLD

            number_match: Optional[bool]
            if q_number is None:
                number_match = None
            else:
                from grading.matching.text import normalize_number

                number_match = normalize_number(printing.number) == q_number

            variant_bonus = (
                VARIANT_BONUS if (q_flags & set(printing.variant_flags)) else 0.0
            )

            composite = NAME_WEIGHT * name_score + SET_WEIGHT * set_score
            if number_match is True:
                composite += NUMBER_BONUS
            elif number_match is False:
                composite -= NUMBER_PENALTY
            composite += variant_bonus

            candidates.append(
                Candidate(
                    printing=printing,
                    score=composite,
                    name_score=name_score,
                    number_match=number_match,
                    set_match=set_match,
                    variant_bonus=variant_bonus,
                )
            )

        candidates.sort(key=lambda c: c.score, reverse=True)
        top = tuple(candidates[:TOP_N_CANDIDATES])

        if not candidates:
            return MatchResult(MatchStatus.NO_MATCH, None, 0.0, 0.0, top)

        best = candidates[0]
        second_score = candidates[1].score if len(candidates) > 1 else 0.0
        margin = best.score - second_score

        if best.score < NO_MATCH_FLOOR:
            return MatchResult(MatchStatus.NO_MATCH, None, best.score, margin, top)
        if margin < AMBIGUOUS_MARGIN:
            return MatchResult(MatchStatus.AMBIGUOUS, None, best.score, margin, top)
        if (
            best.number_match is True
            and best.name_score >= EXACT_NAME_THRESHOLD
            and best.set_match
        ):
            status = MatchStatus.EXACT
        else:
            status = MatchStatus.FUZZY
        return MatchResult(status, best.printing.printing_id, best.score, margin, top)
