"""Types for the printing-match backfill (#FU-40)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class MatchStatus(str, Enum):
    """Outcome of attempting to resolve a NULL ``printing_id``.

    Only ``EXACT`` and ``FUZZY`` carry a ``printing_id`` to write back;
    ``AMBIGUOUS`` and ``NO_MATCH`` deliberately leave the row NULL (a wrong FK
    is worse than a missing one — it silently corrupts the catalog join).
    """

    EXACT = "exact"
    FUZZY = "fuzzy"
    AMBIGUOUS = "ambiguous"
    NO_MATCH = "no_match"

    @property
    def is_resolved(self) -> bool:
        return self in (MatchStatus.EXACT, MatchStatus.FUZZY)


@dataclass(frozen=True)
class CanonicalPrinting:
    """A flattened ``printing`` ⋈ ``card`` ⋈ ``set`` catalog row.

    This is the join the matcher scores against.  In production the catalog is
    loaded from the DB (one row per ``printing``); in tests it is built from
    in-memory fixtures, keeping the matcher fully mockable.

    Attributes:
        printing_id: ``printing.id`` (the value backfilled into observations).
        card_name: ``card.name`` (e.g. ``"Charizard"``).
        set_name: ``set.name`` (e.g. ``"Base Set"``).
        set_code: ``set.code`` (e.g. ``"base1"``).
        number: ``card.number`` text (e.g. ``"4"``, ``"SWSH001"``) — leading
            zeros preserved per the catalog contract.
        language: ``card.language`` (e.g. ``"en"``, ``"ja"``).
        variant_code: ``printing.variant_code`` (e.g. ``"1ED-SHADOWLESS"``).
        variant_flags: ``printing.variant_flags`` (e.g. ``("FIRST_EDITION",)``).
    """

    printing_id: str
    card_name: str
    set_name: str
    set_code: str
    number: str
    language: str = "en"
    variant_code: str = ""
    variant_flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class Candidate:
    """A scored catalog candidate produced during matching (debug surface)."""

    printing: CanonicalPrinting
    score: float
    name_score: float
    number_match: Optional[bool]
    set_match: bool
    variant_bonus: float


@dataclass(frozen=True)
class MatchResult:
    """The decision for one observation.

    ``printing_id`` is non-None only when ``status.is_resolved`` is True.
    ``runner_up_score`` + ``margin`` explain ambiguous decisions; ``candidates``
    is the top-N scored slice for debugging / auditing.
    """

    status: MatchStatus
    printing_id: Optional[str]
    score: float
    margin: float
    candidates: tuple[Candidate, ...] = field(default_factory=tuple)

    @property
    def is_resolved(self) -> bool:
        return self.status.is_resolved and self.printing_id is not None
