"""LinearWeightedAggregator — numpy linear-weighted-sum aggregator.

CI / smoke-test implementation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
A pure numpy linear-weighted-sum following the corners / edges / surface
``*Model`` placeholder pattern.  No ``torch`` required — the CI smoke test
exercises the full eval / export / inference pipeline against this path.

Production architecture (``AGGREGATE_USE_TORCH=1``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Replace this module with a small dense regression head trained against
PSA-graded ground truth::

    backbone = nn.Sequential(
        nn.Linear(4, 8),
        nn.Hardswish(),
        nn.Linear(8, 1),
    )

Inputs: ``(N, 4)`` — the four sub-grade predicted scores.
Outputs: ``(N, 1)`` — overall PSA grade (clamped to [1.0, 10.0]).

The numpy placeholder uses the same ``forward`` / ``get_parameters`` /
``set_parameters`` API so the export + eval pipeline is framework-agnostic.
The learned-weights upgrade path is logged as ``#FU-48`` in ``status.md``.

PSA rounding
~~~~~~~~~~~~
PSA grades on 0.5 ticks (PROJECT.md § 12).  ``round_to_psa_tick()`` rounds
the weighted-sum to the nearest 0.5 and clamps to ``[1.0, 10.0]``.  We use
``round-half-to-even`` (Python's default banker's rounding) so the rounding
is deterministic at ``.25`` / ``.75`` boundaries — important for test
reproducibility.
"""

from __future__ import annotations

import numpy as np

from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregateWeights,
    SubGradeInputs,
)


# ---------------------------------------------------------------------------
# Calibration: round weighted sum → nearest 0.5 in [1.0, 10.0]
# ---------------------------------------------------------------------------


def round_to_psa_tick(value: float) -> float:
    """Round ``value`` to the nearest 0.5 in ``[1.0, 10.0]``.

    PSA grades on 0.5 ticks (PROJECT.md § 12).  This function:
    1. Clamps to ``[1.0, 10.0]``.
    2. Rounds to nearest 0.5 using Python's round-half-to-even (banker's
       rounding) — deterministic at ``.25`` and ``.75`` boundaries.

    Args:
        value: Raw weighted-sum prediction.

    Returns:
        Float in ``{1.0, 1.5, 2.0, …, 9.5, 10.0}``.

    Examples::

        >>> round_to_psa_tick(8.74)
        8.5
        >>> round_to_psa_tick(8.76)
        9.0
        >>> round_to_psa_tick(0.5)   # below floor
        1.0
        >>> round_to_psa_tick(11.0)  # above cap
        10.0
    """
    clamped = max(1.0, min(10.0, float(value)))
    return round(clamped * 2.0) / 2.0


# ---------------------------------------------------------------------------
# Linear-weighted-sum aggregator
# ---------------------------------------------------------------------------


class LinearWeightedAggregator:
    """Numpy linear-weighted-sum aggregator for the 4 sub-grades.

    Args:
        weights: ``AggregateWeights`` instance.  Defaults to the priors in
            ``DEFAULT_WEIGHTS`` (centering 0.25 / corners 0.35 / edges 0.25 /
            surface 0.15).
        random_seed: Unused for the linear aggregator (no random init), kept
            in the signature to mirror the sibling ``*Model`` classes.

    The constructor stores weights in canonical ``SUBGRADE_NAMES`` order so
    the ``forward`` pass is a simple ``X @ w``.
    """

    def __init__(
        self,
        weights: AggregateWeights | None = None,
        random_seed: int = 42,
    ) -> None:
        self.weights = weights if weights is not None else DEFAULT_WEIGHTS
        # ONNX export expects W shape (output_dim, input_dim) — mirroring
        # CornersModel.W shape for the shared export_to_onnx helper.
        self.input_dim = len(SUBGRADE_NAMES)
        self.output_dim = 1
        w = np.asarray(self.weights.as_vector(), dtype=np.float32)
        self.W: np.ndarray = w[np.newaxis, :]  # (1, 4)
        self.b: np.ndarray = np.zeros(self.output_dim, dtype=np.float32)
        self._random_seed = random_seed

    # ------------------------------------------------------------------
    # Forward pass
    # ------------------------------------------------------------------

    def forward(self, X: np.ndarray) -> np.ndarray:
        """Compute weighted-sum predictions for a batch of 4-dim inputs.

        Args:
            X: Shape ``(N, 4)``, dtype float32.  Each row is the 4 sub-grade
                scores in ``SUBGRADE_NAMES`` order:
                ``[centering, corners, edges, surface]``.

        Returns:
            Shape ``(N,)`` raw weighted-sum predictions, clamped to
            ``[1.0, 10.0]``.  Use ``round_to_psa_tick()`` to discretise.
        """
        raw = X @ self.W.T + self.b
        return np.clip(raw[:, 0], 1.0, 10.0)

    def predict_single(self, inputs: SubGradeInputs) -> float:
        """Convenience wrapper — return raw weighted-sum for one input.

        Args:
            inputs: ``SubGradeInputs`` instance.

        Returns:
            Raw weighted-sum (un-rounded, clamped to [1.0, 10.0]).  The
            caller is responsible for ``round_to_psa_tick()``.
        """
        x = np.asarray(inputs.score_vector(), dtype=np.float32)[np.newaxis, :]
        return float(self.forward(x)[0])

    # ------------------------------------------------------------------
    # Parameter persistence (mirrors CornersModel API for ONNX export)
    # ------------------------------------------------------------------

    def get_parameters(self) -> dict:
        """Return model parameters as numpy arrays."""
        return {"W": self.W.copy(), "b": self.b.copy()}

    def set_parameters(self, params: dict) -> None:
        """Set model parameters from a dict.

        After calling, ``self.weights`` is rebuilt from ``W`` so downstream
        consumers reading ``aggregator.weights`` see the updated priors.
        """
        self.W = np.asarray(params["W"], dtype=np.float32)
        self.b = np.asarray(params["b"], dtype=np.float32)
        # Rebuild AggregateWeights from W; normalise so sum-to-1 invariant
        # holds even if downstream re-trained weights aren't exactly normalised.
        flat = self.W.flatten()
        total = float(np.sum(flat))
        if total > 0:
            flat = flat / total
        self.weights = AggregateWeights(
            centering=float(flat[0]),
            corners=float(flat[1]),
            edges=float(flat[2]),
            surface=float(flat[3]),
        )
