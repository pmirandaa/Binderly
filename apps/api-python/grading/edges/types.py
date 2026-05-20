"""Types specific to the edges sub-grade module.

``EdgesLabelledSample``: normalised training row with an ``edges_score`` field.
``EdgesRequest``: input to the inference engine — four edge-strip URIs.
``EdgesSubgrade``: one strip's predicted score + confidence band.
``EdgesPrediction``: full prediction with four per-strip bands + aggregate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
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
# Training data
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EdgesLabelledSample:
    """Normalised training/eval row for the edges sub-grade.

    Mirrors ``ml_common.LabelledGradingSample`` but with ``edges_score``
    instead of ``corners_score``.  Introduced here because ml_common's
    ``LabelledGradingSample`` is hard-coded to the corners sub-grade column
    (see Q-44 in open-questions.md).

    Sources:
    - PSA cert lookup → ``source = 'psa_cert'``
    - eBay sold listing → ``source = 'ebay_sold'``
    - Auction (PWCC / Goldin) → ``source = 'auction_pwcc'`` / ``'auction_goldin'``
    """

    source: str
    source_id: str
    grade_company: str
    overall_grade: Optional[float]
    edges_score: Optional[float]
    image_urls: list[str] = field(default_factory=list)
    printing_id: Optional[str] = None
    raw_metadata: dict = field(default_factory=dict)

    def is_labelled_for_edges(self) -> bool:
        """True when this row can be used as an edges training example."""
        return self.edges_score is not None


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
