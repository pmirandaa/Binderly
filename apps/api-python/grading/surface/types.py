"""Types specific to the surface sub-grade module.

``SurfaceRequest``: input to the inference engine — full-face shots.
``SurfaceShotPrediction``: one shot's predicted score + confidence band.
``SurfacePrediction``: full prediction with per-shot bands + aggregate.

Raking-light seam
-----------------
The PROJECT.md § 12 spec calls for a raking-light shot as the primary surface
input, but T-GR-CAPTURE-UX v1 ships only a 4-shot session (frontFull, backFull,
frontCorner, backCorner).  The raking-light capture step is deferred to #FU-31
(T-GR-CAPTURE-FULL-SCHEMA).

``SurfaceRequest.raking_light_uri`` is therefore **optional** (``None`` until #FU-31
lands).  When present, the inference engine switches to the 3-shot path
transparently with no breaking contract change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from grading.ml_common.types import ConfidenceBand


# ---------------------------------------------------------------------------
# Shot-count constants
# ---------------------------------------------------------------------------

NUM_SURFACE_SHOTS_V1 = 2
"""Number of surface input shots in v1: frontFull + backFull."""

NUM_SURFACE_SHOTS_WITH_RAKING = 3
"""Number of surface input shots once #FU-31 lands: + rakingLight."""

SURFACE_SHOT_LABELS_V1 = ("front_full", "back_full")
"""Canonical shot labels for the v1 2-shot surface model."""

SURFACE_SHOT_LABELS_WITH_RAKING = ("front_full", "back_full", "raking_light")
"""Canonical shot labels once the raking-light step ships (#FU-31)."""


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SurfaceRequest:
    """Input to the surface inference engine.

    ``session_id`` links back to the ``grading_submission`` row.

    ``front_full_uri`` and ``back_full_uri`` are local file paths or URLs for
    the full-face shots captured in every v1 grading session.

    ``raking_light_uri`` is optional — absent until the raking-light capture
    step ships in #FU-31 (T-GR-CAPTURE-FULL-SCHEMA).  When present, the
    inference engine uses the 3-shot path for higher surface accuracy.

    Design intent: the raking-light slot is additive, not required.  Callers
    that cannot supply it (pre-#FU-31 sessions) omit it; the model degrades
    gracefully to the 2-shot v1 path.
    """

    session_id: str
    front_full_uri: str
    back_full_uri: str
    raking_light_uri: Optional[str] = None

    @property
    def shot_uris(self) -> list[str]:
        """Ordered list of shot URIs for the active path.

        Returns 2 URIs (frontFull + backFull) for v1 sessions.
        Returns 3 URIs (+ rakingLight) when #FU-31 is present.
        """
        uris = [self.front_full_uri, self.back_full_uri]
        if self.raking_light_uri is not None:
            uris.append(self.raking_light_uri)
        return uris

    @property
    def num_shots(self) -> int:
        """Number of active input shots (2 for v1, 3 with raking light)."""
        return len(self.shot_uris)

    @property
    def shot_labels(self) -> tuple[str, ...]:
        """Canonical label tuple for the active shot count."""
        if self.raking_light_uri is not None:
            return SURFACE_SHOT_LABELS_WITH_RAKING
        return SURFACE_SHOT_LABELS_V1


# ---------------------------------------------------------------------------
# Prediction output
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SurfaceShotPrediction:
    """Prediction for one input shot (front_full, back_full, or raking_light)."""

    label: str
    band: ConfidenceBand


@dataclass(frozen=True)
class SurfacePrediction:
    """Full surface prediction result.

    ``session_id`` links back to the originating capture session.
    ``per_shot`` contains one ``SurfaceShotPrediction`` per active shot.
    ``aggregate`` is the average of per-shot scores (unlike corners which uses
    the weakest-corner rule — surface defects may appear on only one face, so
    an average gives a more holistic view consistent with PSA grader practice).
    ``model_version`` is the ONNX artifact version tag.
    """

    session_id: str
    per_shot: list[SurfaceShotPrediction]
    aggregate: ConfidenceBand
    model_version: str = "v0-placeholder"

    def __post_init__(self) -> None:
        if len(self.per_shot) not in (NUM_SURFACE_SHOTS_V1, NUM_SURFACE_SHOTS_WITH_RAKING):
            raise ValueError(
                f"SurfacePrediction requires {NUM_SURFACE_SHOTS_V1} or "
                f"{NUM_SURFACE_SHOTS_WITH_RAKING} per-shot entries, "
                f"got {len(self.per_shot)}"
            )
