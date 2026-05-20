"""Aggregate model ONNX export entry point.

Usage::

    python -m grading.aggregate.export --output aggregate_v0.onnx

CI path: builds a 4-input → 1-output Gemm graph from the
``LinearWeightedAggregator`` weights via the shared
``ml_common.model_export.export_to_onnx`` helper.

Production path (``AGGREGATE_USE_TORCH=1``): delegates to
``torch.onnx.export`` for a learned dense regression head (see
``model.py`` for the upgrade-path docstring + ``#FU-48`` in ``status.md``).
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from grading.aggregate.model import LinearWeightedAggregator
from grading.aggregate.types import SUBGRADE_NAMES, AggregateWeights
from grading.ml_common.model_export import export_to_onnx


def export_aggregate_model(
    aggregator: LinearWeightedAggregator,
    output_path: str | Path,
    opset_version: int = 17,
) -> Path:
    """Export a trained ``LinearWeightedAggregator`` to ONNX.

    Args:
        aggregator: Trained (or default-weights) ``LinearWeightedAggregator``.
        output_path: Destination ``.onnx`` file path.
        opset_version: ONNX opset version.

    Returns:
        Resolved ``Path`` of the exported file.
    """
    return export_to_onnx(
        model=aggregator,
        output_path=output_path,
        input_dim=aggregator.input_dim,
        output_dim=aggregator.output_dim,
        opset_version=opset_version,
    )


def _main() -> None:
    parser = argparse.ArgumentParser(description="Export aggregate ONNX model")
    parser.add_argument(
        "--params",
        type=str,
        default=None,
        help="Optional path to a saved .npz parameter file.",
    )
    parser.add_argument(
        "--output", type=str, default="aggregate_v0.onnx",
    )
    args = parser.parse_args()

    aggregator = LinearWeightedAggregator(weights=AggregateWeights())
    if args.params:
        params = np.load(args.params)
        aggregator.set_parameters({"W": params["W"], "b": params["b"]})
    out = export_aggregate_model(aggregator, args.output)
    print(f"Exported ONNX model to: {out} (input_dim={len(SUBGRADE_NAMES)})")


if __name__ == "__main__":  # pragma: no cover - CLI smoke entry
    _main()
