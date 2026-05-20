"""Public barrel for the aggregate stage of the grading pipeline.

The aggregator collapses the four sub-grade predictions (centering / corners /
edges / surface) into a single PSA-calibrated overall grade (0.5 ticks in
[1.0, 10.0]) plus a categorical confidence band (``'low' | 'medium' | 'high'``).

See ``apps/api-python/grading/aggregate/README.md`` for the priors source,
calibration rationale, and ``AGGREGATE_USE_TORCH=1`` upgrade path.
"""

from grading.aggregate.eval import eval_aggregator, eval_aggregator_against_rows
from grading.aggregate.export import export_aggregate_model
from grading.aggregate.model import (
    LinearWeightedAggregator,
    round_to_psa_tick,
)
from grading.aggregate.service import (
    HIGH_CONFIDENCE_THRESHOLD,
    HIGH_SPREAD_LIMIT,
    LOW_CONFIDENCE_THRESHOLD,
    LOW_SPREAD_TRIGGER,
    aggregate_subgrades,
    compute_aggregate_confidence_band,
    compute_confidence_band_label,
    infer,
)
from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregatedGrade,
    AggregateWeights,
    ConfidenceBandLabel,
    SubGradeInputs,
)


__all__ = [
    "AggregatedGrade",
    "AggregateWeights",
    "ConfidenceBandLabel",
    "DEFAULT_WEIGHTS",
    "HIGH_CONFIDENCE_THRESHOLD",
    "HIGH_SPREAD_LIMIT",
    "LinearWeightedAggregator",
    "LOW_CONFIDENCE_THRESHOLD",
    "LOW_SPREAD_TRIGGER",
    "SUBGRADE_NAMES",
    "SubGradeInputs",
    "aggregate_subgrades",
    "compute_aggregate_confidence_band",
    "compute_confidence_band_label",
    "eval_aggregator",
    "eval_aggregator_against_rows",
    "export_aggregate_model",
    "infer",
    "round_to_psa_tick",
]
