"""Types specific to the edges sub-grade module.

``EdgesRequest``: input to the inference engine — four edge-strip URIs.
``EdgesSubgrade``: one strip's predicted score + confidence band.
``EdgesPrediction``: full prediction with four per-strip bands + aggregate.

The edges training row is the shared ``grading.ml_common.LabelledGradingSample``
(loaded via ``MergedDataLoader(..., subgrade_key='edges')``); the previously
edges-specific ``EdgesLabelledSample`` was removed by #FU-44 (Q-017).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from grading.ml_common.types import ConfidenceBand


NUM_STRIPS = 4
"""Number of edge strips per card (top, bottom, left, right)."""

STRIP_LABELS = ("top", "bottom", "left", "right")
"""Canonical strip label order — matches ``EdgesRequest.strip_uris`` index."""

STRIP_THICKNESS_PX = 32
"""Strip thickness in pixels at the 256 px normalised image resolution.
Represents ~2.5 mm of real card material on a standard 63 × 88 mm card.
Top/bottom strips: 256 × 32 px.  Left/right strips: 32 × 256 px."""


# ---------------------------------------------------------------------------
# Inference input / output
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EdgesRequest:
    """Input to the edges inference engine.

    ``session_id`` links back to the ``grading_submission`` row.
    ``strip_uris`` is a list of exactly 4 image URIs (local file paths or URLs)
    in canonical order: [top, bottom, left, right].
    """

    session_id: str
    strip_uris: list[str]

    def __post_init__(self) -> None:
        if len(self.strip_uris) != NUM_STRIPS:
            raise ValueError(
                f"EdgesRequest requires exactly {NUM_STRIPS} strip URIs, "
                f"got {len(self.strip_uris)}"
            )


@dataclass(frozen=True)
class EdgesSubgrade:
    """Prediction for one edge strip of the card."""

    label: str
    band: ConfidenceBand


@dataclass(frozen=True)
class EdgesPrediction:
    """Full edges prediction result.

    ``session_id`` links back to the originating capture session.
    ``per_edge`` contains one ``EdgesSubgrade`` per strip.
    ``aggregate`` is the aggregate band for the edges sub-grade as a whole.
    The aggregate follows the weakest-edge rule: the edge with the lowest
    score dominates (consistent with PSA grader convention for corners/edges).
    ``model_version`` is the ONNX artifact version tag.
    """

    session_id: str
    per_edge: list[EdgesSubgrade]
    aggregate: ConfidenceBand
    model_version: str = "v0-placeholder"

    def __post_init__(self) -> None:
        if len(self.per_edge) != NUM_STRIPS:
            raise ValueError(
                f"EdgesPrediction requires exactly {NUM_STRIPS} per-edge entries"
            )
