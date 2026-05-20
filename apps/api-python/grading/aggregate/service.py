"""Aggregate service entry points.

Two flavours:

- ``aggregate_subgrades(inputs, weights=None) -> AggregatedGrade`` — the
  pure-function workhorse.  Used by tests and any caller that already has
  the 4 sub-grade scores + confidences as floats.
- ``infer(centering, corners, edges, surface, weights=None) -> AggregatedGrade``
  — adapter taking the 4 upstream prediction dataclasses (``CenteringResult``,
  ``CornersPrediction``, ``EdgesPrediction``, ``SurfacePrediction``).  This
  is what the eventual mobile API surface / Python grading service will call.

Confidence-band logic
---------------------
The aggregator emits a 3-band categorical (``'low' | 'medium' | 'high'``)
mapped from the per-sub-grade float confidences + the score-spread heuristic
documented in T-GR-AGGREGATE.md § "Design decisions".  See ``Q-018`` in
``open-questions.md`` for the rationale and the calibration upgrade path.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from grading.aggregate.model import LinearWeightedAggregator, round_to_psa_tick
from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregatedGrade,
    AggregateWeights,
    ConfidenceBandLabel,
    SubGradeInputs,
)

if TYPE_CHECKING:  # pragma: no cover - import guard avoids cycles at runtime
    from grading.centering.types import CenteringResult
    from grading.corners.types import CornersPrediction
    from grading.edges.types import EdgesPrediction
    from grading.surface.types import SurfacePrediction


# ---------------------------------------------------------------------------
# Constants (see Q-018)
# ---------------------------------------------------------------------------


HIGH_CONFIDENCE_THRESHOLD = 0.66
"""Float confidence at-or-above this maps to categorical ``'high'``.

See ``Q-018`` in ``open-questions.md``.  Chosen as evenly-spaced thirds
for v1 — re-tune once real calibration data lands.
"""

LOW_CONFIDENCE_THRESHOLD = 0.33
"""Float confidence below this maps to categorical ``'low'``."""


HIGH_SPREAD_LIMIT = 1.0
"""Max-min spread (PSA points) at-or-below which the aggregate can be 'high'."""

LOW_SPREAD_TRIGGER = 2.0
"""Max-min spread at-or-above which the aggregate is forced to 'low'."""


# Centering grade_hint → float score lookup (see T-GR-AGGREGATE.md §
# "Centering input adapter" + Q-018 for the rationale).
_CENTERING_HINT_TO_SCORE: dict[str, float] = {
    "10": 10.0,
    "9": 9.0,
    "8": 8.0,
    "7": 7.0,
    "worse": 4.0,
    "unknown": 5.0,
}


# ---------------------------------------------------------------------------
# Categorical confidence helpers
# ---------------------------------------------------------------------------


def compute_confidence_band_label(
    confidence: float,
    high_threshold: float = HIGH_CONFIDENCE_THRESHOLD,
    low_threshold: float = LOW_CONFIDENCE_THRESHOLD,
) -> ConfidenceBandLabel:
    """Map a float confidence in ``[0,1]`` to a 3-band categorical.

    Args:
        confidence: Float in [0.0, 1.0].  Values are clamped before mapping.
        high_threshold: Default 0.66.  ``confidence >= high_threshold`` → 'high'.
        low_threshold: Default 0.33.  ``confidence < low_threshold`` → 'low'.

    Returns:
        One of ``'low'``, ``'medium'``, ``'high'``.

    Examples::

        >>> compute_confidence_band_label(0.9)
        'high'
        >>> compute_confidence_band_label(0.5)
        'medium'
        >>> compute_confidence_band_label(0.1)
        'low'
    """
    c = max(0.0, min(1.0, float(confidence)))
    if c >= high_threshold:
        return "high"
    if c >= low_threshold:
        return "medium"
    return "low"


def compute_aggregate_confidence_band(
    per_subgrade_labels: dict[str, ConfidenceBandLabel],
    spread: float,
    high_spread_limit: float = HIGH_SPREAD_LIMIT,
    low_spread_trigger: float = LOW_SPREAD_TRIGGER,
) -> ConfidenceBandLabel:
    """Derive the aggregate confidence band from the 4 per-sub-grade bands.

    Args:
        per_subgrade_labels: Dict mapping each sub-grade name in
            ``SUBGRADE_NAMES`` to its categorical confidence.
        spread: Max-min spread across the 4 sub-grade scores (PSA points).
        high_spread_limit: ``spread < high_spread_limit`` is required for
            aggregate 'high'.  Default 1.0.
        low_spread_trigger: ``spread >= low_spread_trigger`` forces 'low'
            regardless of per-sub-grade confidences.  Default 2.0.

    Returns:
        One of ``'low'``, ``'medium'``, ``'high'``.

    Logic:
        - ``'high'``  iff ALL 4 sub-grade labels are 'high' AND
                       ``spread < high_spread_limit``.
        - ``'low'``   if ANY sub-grade label is 'low' OR
                       ``spread >= low_spread_trigger``.
        - ``'medium'`` otherwise.
    """
    labels = [per_subgrade_labels[name] for name in SUBGRADE_NAMES]
    if any(label == "low" for label in labels):
        return "low"
    if spread >= low_spread_trigger:
        return "low"
    if all(label == "high" for label in labels) and spread < high_spread_limit:
        return "high"
    return "medium"


# ---------------------------------------------------------------------------
# Pure workhorse
# ---------------------------------------------------------------------------


def aggregate_subgrades(
    inputs: SubGradeInputs,
    weights: Optional[AggregateWeights] = None,
) -> AggregatedGrade:
    """Aggregate 4 sub-grade scalars into a single ``AggregatedGrade``.

    Pure function — given the same ``inputs`` and ``weights``, always returns
    the same ``AggregatedGrade`` (no I/O, no randomness, no globals).

    Args:
        inputs: Per-sub-grade scores + confidences.
        weights: Optional weight override.  Defaults to ``DEFAULT_WEIGHTS``.

    Returns:
        ``AggregatedGrade`` carrying both the raw ``overall_grade`` and the
        PSA-rounded ``psa_grade``, the aggregate confidence band, a mirror
        of the sub-grade scores, and a ``calibration_notes`` debug string.
    """
    used_weights = weights if weights is not None else DEFAULT_WEIGHTS
    aggregator = LinearWeightedAggregator(weights=used_weights)
    raw = aggregator.predict_single(inputs)

    per_subgrade_labels: dict[str, ConfidenceBandLabel] = {
        name: compute_confidence_band_label(inputs.confidences[name])
        for name in SUBGRADE_NAMES
    }
    spread = inputs.spread()
    band = compute_aggregate_confidence_band(per_subgrade_labels, spread)

    psa = round_to_psa_tick(raw)

    notes = _format_calibration_notes(
        per_subgrade_labels=per_subgrade_labels,
        confidences=inputs.confidences,
        spread=spread,
        raw_score=raw,
        psa_score=psa,
        weights=used_weights,
    )

    return AggregatedGrade(
        overall_grade=float(raw),
        psa_grade=float(psa),
        confidence_band=band,
        sub_grades=dict(inputs.scores),
        calibration_notes=notes,
    )


# ---------------------------------------------------------------------------
# Adapter — upstream prediction dataclasses → SubGradeInputs
# ---------------------------------------------------------------------------


def _centering_to_score_and_confidence(
    centering: "CenteringResult",
) -> tuple[float, float]:
    """Map a ``CenteringResult`` to (score, confidence).

    See ``T-GR-AGGREGATE.md`` § "Centering input adapter" + Q-018.
    """
    score = _CENTERING_HINT_TO_SCORE.get(centering.grade_hint)
    if score is None:
        # Unknown enum value (defensive — keeps the aggregator from crashing
        # if T-GR-CENTERING adds a new hint and forgets to update this map).
        score = 5.0
    if centering.grade_hint == "unknown":
        confidence = 0.0
    elif centering.low_confidence:
        confidence = 0.3  # below LOW_CONFIDENCE_THRESHOLD → 'low'
    else:
        confidence = 1.0  # geometric / deterministic — 'high'
    return float(score), float(confidence)


def infer(
    centering: "CenteringResult",
    corners: "CornersPrediction",
    edges: "EdgesPrediction",
    surface: "SurfacePrediction",
    weights: Optional[AggregateWeights] = None,
) -> AggregatedGrade:
    """Adapter — build ``SubGradeInputs`` from the 4 upstream predictions.

    Args:
        centering: ``grading.centering.types.CenteringResult``.
        corners: ``grading.corners.types.CornersPrediction``.
        edges: ``grading.edges.types.EdgesPrediction``.
        surface: ``grading.surface.types.SurfacePrediction``.
        weights: Optional weight override.  Defaults to ``DEFAULT_WEIGHTS``.

    Returns:
        ``AggregatedGrade`` — same shape as ``aggregate_subgrades()``.
    """
    centering_score, centering_confidence = _centering_to_score_and_confidence(centering)

    inputs = SubGradeInputs(
        scores={
            "centering": centering_score,
            "corners": float(corners.aggregate.value),
            "edges": float(edges.aggregate.value),
            "surface": float(surface.aggregate.value),
        },
        confidences={
            "centering": centering_confidence,
            "corners": float(corners.aggregate.confidence),
            "edges": float(edges.aggregate.confidence),
            "surface": float(surface.aggregate.confidence),
        },
    )
    return aggregate_subgrades(inputs, weights=weights)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _format_calibration_notes(
    per_subgrade_labels: dict[str, ConfidenceBandLabel],
    confidences: dict[str, float],
    spread: float,
    raw_score: float,
    psa_score: float,
    weights: AggregateWeights,
) -> str:
    """Build the per-grade debug string surfaced in ``calibration_notes``.

    Format intentionally human-readable so test failures + eval CLI output
    are diagnostic without needing to break out a debugger.
    """
    per_label_str = ", ".join(
        f"{name}={per_subgrade_labels[name]}({confidences[name]:.2f})"
        for name in SUBGRADE_NAMES
    )
    weights_str = ", ".join(
        f"{name}={w:.2f}" for name, w in weights.as_dict().items()
    )
    return (
        f"raw={raw_score:.3f} psa={psa_score:.1f} spread={spread:.2f} "
        f"weights=[{weights_str}] "
        f"per_subgrade=[{per_label_str}]"
    )
