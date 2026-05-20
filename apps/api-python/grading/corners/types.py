"""Types specific to the corners sub-grade module.

``CornersRequest``: input to the inference engine — four corner crops.
``CornersSubgrade``: one corner's predicted score + confidence.
``CornersPrediction``: full prediction with four per-corner bands + aggregate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from grading.ml_common.types import ConfidenceBand


NUM_CORNERS = 4
"""Number of corners per card (top-left, top-right, bottom-left, bottom-right)."""

CORNER_LABELS = ("top_left", "top_right", "bottom_left", "bottom_right")


@dataclass(frozen=True)
class CornersRequest:
    """Input to the corners inference engine.

    ``session_id`` links back to the ``grading_submission`` row.
    ``corner_uris`` is a list of exactly 4 image URIs (local file paths or URLs)
    in canonical order: [top_left, top_right, bottom_left, bottom_right].
    """

    session_id: str
    corner_uris: list[str]

    def __post_init__(self) -> None:
        if len(self.corner_uris) != NUM_CORNERS:
            raise ValueError(
                f"CornersRequest requires exactly {NUM_CORNERS} corner URIs, "
                f"got {len(self.corner_uris)}"
            )


@dataclass(frozen=True)
class CornersSubgrade:
    """Prediction for one corner of the card."""

    label: str
    band: ConfidenceBand


@dataclass(frozen=True)
class CornersPrediction:
    """Full corners prediction result.

    ``session_id`` links back to the originating capture session.
    ``per_corner`` contains one ``CornersSubgrade`` per corner.
    ``aggregate`` is the aggregate band for the corners sub-grade as a whole.
    The aggregate follows the weakest-corner rule: the corner with the lowest
    score dominates (consistent with PSA grader convention).
    ``model_version`` is the ONNX artifact version tag.
    """

    session_id: str
    per_corner: list[CornersSubgrade]
    aggregate: ConfidenceBand
    model_version: str = "v0-placeholder"

    def __post_init__(self) -> None:
        if len(self.per_corner) != NUM_CORNERS:
            raise ValueError(
                f"CornersPrediction requires exactly {NUM_CORNERS} per-corner entries"
            )
