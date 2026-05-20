"""Edges sub-grade model ONNX export entry point.

Usage::

    python -m grading.edges.export --params edges_params.npz --input-dim 768 --output edges_v0.onnx

Or from train.py which calls ``export_edges_model`` directly.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from grading.edges.model import EdgesModel
from grading.ml_common.model_export import export_to_onnx


def export_edges_model(
    model: EdgesModel,
    output_path: str | Path,
    input_dim: int | None = None,
    opset_version: int = 17,
) -> Path:
    """Export a trained ``EdgesModel`` to ONNX.

    Args:
        model: Trained ``EdgesModel``.
        output_path: Destination ``.onnx`` file path.
        input_dim: Override input dimension.  Defaults to ``model.input_dim``.
        opset_version: ONNX opset version.

    Returns:
        Resolved ``Path`` of the exported file.
    """
    if input_dim is None:
        input_dim = model.input_dim
    return export_to_onnx(
        model=model,
        output_path=output_path,
        input_dim=input_dim,
        output_dim=model.output_dim,
        opset_version=opset_version,
    )


def _main() -> None:
    parser = argparse.ArgumentParser(description="Export edges ONNX model")
    parser.add_argument("--params", type=str, required=True, help="Path to saved .npz parameter file")
    parser.add_argument("--input-dim", type=int, required=True)
    parser.add_argument("--output", type=str, default="edges_v0.onnx")
    args = parser.parse_args()

    params = np.load(args.params)
    model = EdgesModel(input_dim=args.input_dim)
    model.set_parameters({"W": params["W"], "b": params["b"]})
    out = export_edges_model(model, args.output, input_dim=args.input_dim)
    print(f"Exported ONNX model to: {out}")


if __name__ == "__main__":
    _main()
