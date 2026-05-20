"""Types specific to the aggregate stage of the grading pipeline.

The aggregator collapses the four sub-grade outputs (centering / corners /
edges / surface) into a single PSA-calibrated overall grade plus a categorical
confidence band.

Inputs
------
- Three of the four sub-grade modules (corners / edges / surface) emit a
  ``grading.ml_common.types.ConfidenceBand`` with ``value: float`` and
  ``confidence: float in [0,1]``.
- Centering emits a ``CenteringResult.grade_hint`` string (``'10'..'7'|'worse'|
  'unknown'``) plus a ``low_confidence`` bool — NOT a ``ConfidenceBand``.
- The ``infer()`` adapter in ``service.py`` is responsible for normalising
  both shapes into ``SubGradeInputs``.

Outputs
-------
- ``AggregatedGrade`` carries both the un-rounded ``overall_grade`` (useful
  for downstream metrics) and the PSA-rounded ``psa_grade`` (the user-facing
  number).  ``calibration_notes`` is a free-form string used by the eval CLI
  for debugging.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


# ---------------------------------------------------------------------------
# Categorical confidence band — derived from float ConfidenceBand.confidence
# ---------------------------------------------------------------------------


ConfidenceBandLabel = Literal["low", "medium", "high"]
"""3-band categorical mapped from float ``ConfidenceBand.confidence`` via
``service.compute_confidence_band_label()``.

Threshold defaults: ``>= 0.66 → 'high'``, ``>= 0.33 → 'medium'``, else ``'low'``.
See Q-018 in ``open-questions.md`` for the rationale and the calibration
upgrade path.
"""


SUBGRADE_NAMES: tuple[str, ...] = ("centering", "corners", "edges", "surface")
"""Canonical sub-grade key order.  Used for dict-key consistency in
``SubGradeInputs.confidences`` and ``AggregatedGrade.sub_grades``."""


# ---------------------------------------------------------------------------
# Weight priors
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AggregateWeights:
    """Linear-weighted-sum weights for the four sub-grades.

    Defaults are priors grounded in PSA's publicly documented criteria:
    corners + centering dominate, edges follow, surface trails (the surface
    sub-grade is the least reliable v1 input until #FU-31 ships the
    raking-light shot — see ``apps/api-python/grading/surface/types.py``).

    Sum-to-1 and per-weight-in-[0,1] are enforced at construction.  The
    weights are constructor-configurable so a future learned-calibration
    pass (#FU-48 — AGGREGATE_USE_TORCH=1) can swap in trained values
    without breaking the public API.
    """

    centering: float = 0.25
    corners: float = 0.35
    edges: float = 0.25
    surface: float = 0.15

    def __post_init__(self) -> None:
        for name, w in (
            ("centering", self.centering),
            ("corners", self.corners),
            ("edges", self.edges),
            ("surface", self.surface),
        ):
            if not (0.0 <= w <= 1.0):
                raise ValueError(
                    f"AggregateWeights.{name} must be in [0.0, 1.0], got {w!r}"
                )
        total = self.centering + self.corners + self.edges + self.surface
        if abs(total - 1.0) > 1e-6:
            raise ValueError(
                f"AggregateWeights must sum to 1.0 ± 1e-6, got {total!r}"
            )

    def as_dict(self) -> dict[str, float]:
        """Return weights keyed by sub-grade name."""
        return {
            "centering": self.centering,
            "corners": self.corners,
            "edges": self.edges,
            "surface": self.surface,
        }

    def as_vector(self) -> tuple[float, float, float, float]:
        """Return weights in canonical ``SUBGRADE_NAMES`` order."""
        return (self.centering, self.corners, self.edges, self.surface)


DEFAULT_WEIGHTS = AggregateWeights()
"""Module-level default-weight singleton.  See class docstring for priors."""


# ---------------------------------------------------------------------------
# Input dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SubGradeInputs:
    """The 4 sub-grade scalars + per-sub-grade float confidences.

    Both the ``scores`` and ``confidences`` dicts are required to carry exactly
    the 4 keys in ``SUBGRADE_NAMES``.

    Args:
        scores: Per-sub-grade predicted PSA score (float in [1.0, 10.0]).
        confidences: Per-sub-grade float confidence (in [0.0, 1.0]).  Mapped
            to categorical via ``service.compute_confidence_band_label()``.

    The ``infer()`` adapter in ``service.py`` builds ``SubGradeInputs`` from
    the upstream prediction objects.  Direct callers (e.g. unit tests) can
    construct ``SubGradeInputs`` by hand.
    """

    scores: dict[str, float] = field(default_factory=dict)
    confidences: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        score_keys = set(self.scores.keys())
        conf_keys = set(self.confidences.keys())
        expected = set(SUBGRADE_NAMES)
        if score_keys != expected:
            raise ValueError(
                f"SubGradeInputs.scores must contain exactly {sorted(expected)} "
                f"keys, got {sorted(score_keys)}"
            )
        if conf_keys != expected:
            raise ValueError(
                f"SubGradeInputs.confidences must contain exactly {sorted(expected)} "
                f"keys, got {sorted(conf_keys)}"
            )
        for name, value in self.scores.items():
            if not (1.0 <= value <= 10.0):
                raise ValueError(
                    f"SubGradeInputs.scores[{name!r}] must be in [1.0, 10.0], "
                    f"got {value!r}"
                )
        for name, value in self.confidences.items():
            if not (0.0 <= value <= 1.0):
                raise ValueError(
                    f"SubGradeInputs.confidences[{name!r}] must be in [0.0, 1.0], "
                    f"got {value!r}"
                )

    def score_vector(self) -> tuple[float, float, float, float]:
        """Return scores in canonical ``SUBGRADE_NAMES`` order."""
        return (
            self.scores["centering"],
            self.scores["corners"],
            self.scores["edges"],
            self.scores["surface"],
        )

    def spread(self) -> float:
        """Return the max-min spread across the 4 sub-grade scores."""
        v = self.score_vector()
        return float(max(v) - min(v))


# ---------------------------------------------------------------------------
# Output dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AggregatedGrade:
    """Final aggregator output.

    Args:
        overall_grade: Raw weighted-sum prediction (un-rounded, clamped to
            [1.0, 10.0]).  Useful for downstream metrics like MAE / RMSE
            against ground truth.
        psa_grade: User-facing PSA grade.  Rounded to the nearest 0.5 in
            [1.0, 10.0].  PSA grades on 0.5 ticks (PROJECT.md § 12).
        confidence_band: Categorical 3-band aggregate confidence.  See
            ``service.compute_aggregate_confidence_band()`` for the rules.
        sub_grades: Mirror of ``SubGradeInputs.scores`` for downstream
            consumers that need the per-sub-grade contributions.
        calibration_notes: Free-form debug string listing the per-sub-grade
            categorical confidences and the score spread.  Surfaced in the
            eval CLI and in test failures for fast diagnosis.
    """

    overall_grade: float
    psa_grade: float
    confidence_band: ConfidenceBandLabel
    sub_grades: dict[str, float] = field(default_factory=dict)
    calibration_notes: str = ""

    def __post_init__(self) -> None:
        if not (1.0 <= self.overall_grade <= 10.0):
            raise ValueError(
                f"AggregatedGrade.overall_grade must be in [1.0, 10.0], "
                f"got {self.overall_grade!r}"
            )
        if not (1.0 <= self.psa_grade <= 10.0):
            raise ValueError(
                f"AggregatedGrade.psa_grade must be in [1.0, 10.0], "
                f"got {self.psa_grade!r}"
            )
        # psa_grade must be a 0.5 tick.
        ticks = self.psa_grade * 2.0
        if abs(ticks - round(ticks)) > 1e-6:
            raise ValueError(
                f"AggregatedGrade.psa_grade must be a 0.5 tick, "
                f"got {self.psa_grade!r}"
            )
        if self.confidence_band not in ("low", "medium", "high"):
            raise ValueError(
                f"AggregatedGrade.confidence_band must be 'low'|'medium'|'high', "
                f"got {self.confidence_band!r}"
            )
