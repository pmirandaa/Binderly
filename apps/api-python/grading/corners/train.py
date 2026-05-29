"""Corners sub-grade model training entry point.

Usage::

    python -m grading.corners.train --epochs 10 --lr 0.001 --output corners_v0.onnx

Or via Make::

    make train  # in apps/api-python/grading/corners/

The training pipeline:
1. Load labelled samples via ``MergedDataLoader``.
2. Build feature arrays via ``CornersDataset``.
3. Split 80/20 train/val.
4. Run ``TrainingLoop`` for ``num_epochs``.
5. Evaluate on val set.
6. Export to ONNX via ``export_corners_model``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

from grading.corners.dataset import CornersDataset
from grading.corners.export import export_corners_model
from grading.corners.model import CornersModel
from grading.ml_common.data_loader import MergedDataLoader
from grading.ml_common.eval_metrics import summarise_metrics
from grading.ml_common.training_loop import TrainingLoop, mse_loss
from grading.ml_common.types import TrainingConfig, TrainingResult


def train_corners_model(
    psa_rows: list[dict[str, Any]],
    ebay_rows: list[dict[str, Any]],
    auction_rows: list[dict[str, Any]],
    config: Optional[TrainingConfig] = None,
    output_path: Optional[Path] = None,
    patch_size: int = 8,
    val_fraction: float = 0.2,
) -> TrainingResult:
    """Train the corners model on labelled data from the three sources.

    Args:
        psa_rows: ``grading_training_sample`` rows (source='psa_cert').
        ebay_rows: ``ebay_graded_listing_observation`` rows.
        auction_rows: ``auction_lot_observation`` rows.
        config: Training hyperparameters.
        output_path: If provided, exports the ONNX model to this path.
        patch_size: Corner-patch side length in pixels (8 for CI smoke test).
        val_fraction: Fraction of data held out for validation.

    Returns:
        ``TrainingResult`` with final losses and best val MAE.
    """
    if config is None:
        config = TrainingConfig(subgrade_column="corners", patch_size=patch_size)

    loader = MergedDataLoader(psa_rows, ebay_rows, auction_rows, subgrade_key="corners")
    labelled = loader.load_labelled()

    if not labelled:
        raise ValueError("No labelled corners samples found in the provided data.")

    dataset = CornersDataset(labelled, patch_size=patch_size)
    X, y = dataset.build_arrays()

    rng = np.random.default_rng(config.random_seed)
    N = len(X)
    n_val = max(1, int(N * val_fraction))
    idx = rng.permutation(N)
    val_idx, train_idx = idx[:n_val], idx[n_val:]
    X_train, y_train = X[train_idx], y[train_idx]
    X_val, y_val = X[val_idx], y[val_idx]

    model = CornersModel(input_dim=dataset.input_dim, random_seed=config.random_seed)
    loop = TrainingLoop(model=model, loss_fn=mse_loss, config=config)
    result = loop.run(X_train, y_train, X_val, y_val)

    if output_path is not None:
        export_corners_model(model, output_path, input_dim=dataset.input_dim)

    return result


def _main() -> None:
    parser = argparse.ArgumentParser(description="Train corners sub-grade model")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--patch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=str, default="corners_v0.onnx")
    args = parser.parse_args()

    print("corners/train.py: No live DB connection in this v0 — run with synthetic data.")
    print("Set CORNERS_LIVE_IMAGES=1 and provide DB_URL for real training.")
    config = TrainingConfig(
        subgrade_column="corners",
        num_epochs=args.epochs,
        learning_rate=args.lr,
        batch_size=args.batch_size,
        patch_size=args.patch_size,
        random_seed=args.seed,
    )
    result = train_corners_model(
        psa_rows=[],
        ebay_rows=[],
        auction_rows=[],
        config=config,
        output_path=Path(args.output),
        patch_size=args.patch_size,
    )
    print(json.dumps({
        "final_train_loss": result.final_train_loss,
        "final_val_loss": result.final_val_loss,
        "best_val_mae": result.best_val_mae,
        "num_epochs_run": result.num_epochs_run,
    }, indent=2))


if __name__ == "__main__":
    _main()
