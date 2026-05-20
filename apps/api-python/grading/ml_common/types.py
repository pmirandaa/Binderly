"""Shared types for grading ML sub-grade models.

``LabelledGradingSample`` is the canonical normalised training row, produced by
``MergedDataLoader`` from any of the three scraper table shapes (PSA cert,
eBay observation, auction lot).

``SubgradePrediction`` and ``ConfidenceBand`` are the output contract shared by
all sub-grade models.  T-GR-AGGREGATE reads these uniformly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Training data
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LabelledGradingSample:
    """Normalised training/eval row.

    Sources:
    - PSA cert lookup  → ``source = 'psa_cert'``
    - eBay sold listing → ``source = 'ebay_sold'``
    - Auction PWCC      → ``source = 'auction_pwcc'``
    - Auction Goldin    → ``source = 'auction_goldin'``

    ``corners_score`` is the PSA sub-grade label this row contributes.
    Rows where ``corners_score is None`` are filtered out before training
    (they may still be useful for other sub-grades).

    ``printing_id`` is NULL for all v1 rows (pending #FU-40 image ingest).
    ``image_urls`` are the raw URLs; ``ImageLoader`` handles fetching / mocking.
    """

    source: str
    source_id: str
    grade_company: str
    overall_grade: Optional[float]
    corners_score: Optional[float]
    image_urls: list[str] = field(default_factory=list)
    printing_id: Optional[str] = None
    raw_metadata: dict = field(default_factory=dict)

    def is_labelled_for_corners(self) -> bool:
        """True when this row can be used as a corners training example."""
        return self.corners_score is not None


# ---------------------------------------------------------------------------
# Model output
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConfidenceBand:
    """Uniform prediction wrapper returned by every sub-grade model.

    ``value`` is the predicted PSA sub-grade (float in [1.0, 10.0]).
    ``confidence`` is a [0.0, 1.0] estimate of model certainty.
    T-GR-AGGREGATE reads all sub-grades in this shape.
    """

    value: float
    confidence: float

    def __post_init__(self) -> None:
        if not (1.0 <= self.value <= 10.0):
            raise ValueError(f"value must be in [1.0, 10.0], got {self.value!r}")
        if not (0.0 <= self.confidence <= 1.0):
            raise ValueError(
                f"confidence must be in [0.0, 1.0], got {self.confidence!r}"
            )


@dataclass(frozen=True)
class SubgradePrediction:
    """One sub-grade output produced by an inference engine."""

    subgrade: str
    band: ConfidenceBand
    model_version: str = "v0-placeholder"


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


@dataclass
class TrainingConfig:
    """Generic training hyperparameters shared by all sub-grade trainers.

    ``subgrade_column`` selects which label column to train on
    (``'corners'``, ``'edges'``, or ``'surface'``).
    """

    subgrade_column: str = "corners"
    learning_rate: float = 1e-3
    num_epochs: int = 10
    batch_size: int = 8
    patch_size: int = 64
    random_seed: int = 42
    model_version: str = "v0-placeholder"


@dataclass
class TrainingResult:
    """Summary returned by a completed training run."""

    final_train_loss: float
    final_val_loss: float
    best_val_mae: float
    num_epochs_run: int
    model_version: str


# ---------------------------------------------------------------------------
# Protocols — used for type-checking + mocking in tests
# ---------------------------------------------------------------------------


@runtime_checkable
class ModelProtocol(Protocol):
    """Minimum interface any sub-grade model must satisfy."""

    def forward(self, x: "import numpy as np; np.ndarray") -> "np.ndarray":  # type: ignore[name-defined]
        ...

    def get_parameters(self) -> dict:
        ...

    def set_parameters(self, params: dict) -> None:
        ...


@runtime_checkable
class DataLoaderProtocol(Protocol):
    """Minimum interface any data loader must satisfy."""

    def load(self) -> list[LabelledGradingSample]:
        ...

    def __len__(self) -> int:
        ...
