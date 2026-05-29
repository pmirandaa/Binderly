"""Edges sub-grade model evaluation entry point.

Usage::

    python -m grading.edges.eval --model edges_v0.onnx

Loads the ONNX model, runs inference on the provided dataset, prints
all eval metrics (MAE, RMSE, ±1-grade accuracy, confusion matrix).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from grading.edges.dataset import EdgesDataset
from grading.ml_common.data_loader import MergedDataLoader
from grading.ml_common.eval_metrics import summarise_metrics
from grading.ml_common.model_export import load_onnx_session, run_onnx_inference


def eval_edges_model(
    model_path: str | Path,
    psa_rows: list[dict[str, Any]],
    ebay_rows: list[dict[str, Any]],
    auction_rows: list[dict[str, Any]],
    patch_size: int = 8,
) -> dict[str, float]:
    """Evaluate a trained ONNX edges model on labelled data.

    Args:
        model_path: Path to the ``.onnx`` model file.
        psa_rows: PSA training sample rows.
        ebay_rows: eBay observation rows.
        auction_rows: Auction lot rows.
        patch_size: Patch size (must match training configuration).

    Returns:
        Dict of eval metrics (see ``summarise_metrics``).
    """
    loader = MergedDataLoader(psa_rows, ebay_rows, auction_rows, subgrade_key="edges")
    labelled = loader.load_labelled()
    if not labelled:
        raise ValueError("No labelled edges samples found.")

    dataset = EdgesDataset(labelled, patch_size=patch_size)
    X, y = dataset.build_arrays()

    session = load_onnx_session(model_path)
    predictions = run_onnx_inference(session, X).flatten()

    metrics = summarise_metrics(predictions, y)
    metrics["n_samples"] = float(len(y))
    return metrics


def _main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate edges sub-grade model")
    parser.add_argument("--model", type=str, required=True)
    parser.add_argument("--patch-size", type=int, default=64)
    args = parser.parse_args()

    print("edges/eval.py: Evaluating with synthetic data (no live DB in v0).")
    metrics = eval_edges_model(
        model_path=args.model,
        psa_rows=[],
        ebay_rows=[],
        auction_rows=[],
        patch_size=args.patch_size,
    )
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    _main()
