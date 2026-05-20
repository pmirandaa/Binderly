"""Generic training loop for grading sub-grade regression models.

Parameterised on ``model``, ``loss_fn``, ``optimizer_fn``, and ``dataset``
so all three sub-grades (corners, edges, surface) share the same loop.

CI / smoke-test implementation uses numpy only — no torch required.  Real
CNN training swaps in a torch ``DataLoader`` and ``torch.nn.Module`` via the
same interface.

Example::

    from grading.ml_common.training_loop import train_one_epoch, TrainingLoop
    from grading.ml_common.types import TrainingConfig

    config = TrainingConfig(subgrade_column="corners", num_epochs=1)
    loop = TrainingLoop(model, loss_fn=mse_loss, config=config)
    result = loop.run(X_train, y_train, X_val, y_val)
"""

from __future__ import annotations

import math
from typing import Any, Callable, Optional

import numpy as np

from grading.ml_common.types import TrainingConfig, TrainingResult


# ---------------------------------------------------------------------------
# Loss functions
# ---------------------------------------------------------------------------


def mse_loss(predictions: np.ndarray, targets: np.ndarray) -> tuple[float, np.ndarray]:
    """Mean squared error + gradient w.r.t. predictions.

    Returns:
        (loss_value, gradient_wrt_predictions)
    """
    diff = predictions - targets
    loss = float(np.mean(diff**2))
    grad = 2.0 * diff / len(diff)
    return loss, grad


def mae_loss(predictions: np.ndarray, targets: np.ndarray) -> tuple[float, np.ndarray]:
    """Mean absolute error + sub-gradient w.r.t. predictions."""
    diff = predictions - targets
    loss = float(np.mean(np.abs(diff)))
    grad = np.sign(diff) / len(diff)
    return loss, grad


# ---------------------------------------------------------------------------
# Single-epoch runner
# ---------------------------------------------------------------------------


def train_one_epoch(
    model: Any,
    X: np.ndarray,
    y: np.ndarray,
    loss_fn: Callable[[np.ndarray, np.ndarray], tuple[float, np.ndarray]],
    learning_rate: float = 1e-3,
    batch_size: int = 8,
    rng: Optional[np.random.Generator] = None,
) -> float:
    """Run one epoch of mini-batch SGD on a numpy-compatible model.

    Args:
        model: Object with ``forward(X) -> predictions`` and
            ``_backward(X, grad_output)`` methods (numpy linear model).
        X: Feature matrix ``(N, D)``.
        y: Target vector ``(N,)``.
        loss_fn: Returns ``(loss, grad_wrt_predictions)``.
        learning_rate: SGD step size.
        batch_size: Mini-batch size.
        rng: Random generator for shuffling.  Defaults to a new default_rng().

    Returns:
        Mean loss across all mini-batches in the epoch.
    """
    if rng is None:
        rng = np.random.default_rng()

    N = len(X)
    idx = rng.permutation(N)
    X_shuffled = X[idx]
    y_shuffled = y[idx]

    total_loss = 0.0
    num_batches = 0

    for start in range(0, N, batch_size):
        end = min(start + batch_size, N)
        X_batch = X_shuffled[start:end]
        y_batch = y_shuffled[start:end]

        preds = model.forward(X_batch)
        loss, grad_preds = loss_fn(preds, y_batch)
        model._backward(X_batch, grad_preds, learning_rate)

        total_loss += loss
        num_batches += 1

    return total_loss / max(num_batches, 1)


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------


class TrainingLoop:
    """Orchestrate training over multiple epochs with train/val split.

    Args:
        model: Numpy-compatible model (or any object with ``forward`` /
            ``_backward`` methods).
        loss_fn: Loss function returning ``(loss, grad)``.
        config: Hyperparameters.
    """

    def __init__(
        self,
        model: Any,
        loss_fn: Callable[[np.ndarray, np.ndarray], tuple[float, np.ndarray]] = mse_loss,
        config: Optional[TrainingConfig] = None,
    ) -> None:
        self.model = model
        self.loss_fn = loss_fn
        self.config = config or TrainingConfig()
        self._rng = np.random.default_rng(self.config.random_seed)

    def run(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: Optional[np.ndarray] = None,
        y_val: Optional[np.ndarray] = None,
    ) -> TrainingResult:
        """Run the full training schedule.

        Returns:
            ``TrainingResult`` with final train + val losses and best val MAE.
        """
        best_val_mae = math.inf
        final_train_loss = math.inf
        final_val_loss = math.inf

        for epoch in range(self.config.num_epochs):
            train_loss = train_one_epoch(
                model=self.model,
                X=X_train,
                y=y_train,
                loss_fn=self.loss_fn,
                learning_rate=self.config.learning_rate,
                batch_size=self.config.batch_size,
                rng=self._rng,
            )
            final_train_loss = train_loss

            if X_val is not None and y_val is not None and len(X_val) > 0:
                val_preds = self.model.forward(X_val)
                val_loss, _ = self.loss_fn(val_preds, y_val)
                val_mae = float(np.mean(np.abs(val_preds - y_val)))
                final_val_loss = val_loss
                if val_mae < best_val_mae:
                    best_val_mae = val_mae

        return TrainingResult(
            final_train_loss=final_train_loss,
            final_val_loss=final_val_loss if X_val is not None else final_train_loss,
            best_val_mae=best_val_mae if best_val_mae < math.inf else float(np.mean(np.abs(self.model.forward(X_train) - y_train))),
            num_epochs_run=self.config.num_epochs,
            model_version=self.config.model_version,
        )
