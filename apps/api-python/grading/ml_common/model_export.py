"""ONNX model export and inference session loader.

Two paths:

1. **Numpy linear model** (CI / smoke test): builds a minimal ``Gemm`` ONNX
   graph directly using the ``onnx`` package.  No torch required.

2. **Torch CNN** (production, ``CORNERS_USE_TORCH=1``): calls
   ``torch.onnx.export(model, ...)`` — MobileNetV3-small + regression head.

Inference uses ``onnxruntime`` regardless of which path produced the model.

Usage::

    from grading.ml_common.model_export import export_to_onnx, load_onnx_session

    # Export a numpy linear model
    export_to_onnx(linear_model, "corners.onnx", input_dim=768)

    # Load + run
    session = load_onnx_session("corners.onnx")
    output = session.run(None, {"input": X_batch})[0]
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import numpy as np


def export_to_onnx(
    model: Any,
    output_path: str | Path,
    input_dim: int,
    output_dim: int = 1,
    opset_version: int = 17,
) -> Path:
    """Export a model to ONNX.

    If ``model`` is a numpy linear model (has ``W`` and ``b`` attributes) it
    builds the ONNX graph directly.  If ``CORNERS_USE_TORCH=1``, delegates to
    ``torch.onnx.export``.

    Args:
        model: Trained model.  Numpy linear model for CI; torch module for prod.
        output_path: Destination ``.onnx`` file path.
        input_dim: Number of input features.
        output_dim: Number of output neurons (1 for regression).
        opset_version: ONNX opset (17 = current stable).

    Returns:
        Resolved ``Path`` of the written file.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    use_torch = os.environ.get("CORNERS_USE_TORCH", "0") == "1"
    if use_torch:
        return _export_torch(model, output_path, input_dim, output_dim, opset_version)
    return _export_numpy_linear(model, output_path, input_dim, output_dim, opset_version)


def _export_numpy_linear(
    model: Any,
    output_path: Path,
    input_dim: int,
    output_dim: int,
    opset_version: int,
) -> Path:
    """Build a Gemm ONNX graph from a numpy linear model's W / b parameters."""
    try:
        import onnx
        from onnx import TensorProto, helper, numpy_helper
    except ImportError as exc:
        raise ImportError(
            "ONNX export requires 'onnx'. Add it to the 'dev' extras: "
            "pip install onnx"
        ) from exc

    params = model.get_parameters()
    # W has shape (output_dim, input_dim) in the numpy model.
    # ONNX Gemm computes: output = input @ W_gemm + b
    # where input is (batch, input_dim) and W_gemm must be (input_dim, output_dim).
    # So we store W.T as the ONNX initializer.
    W: np.ndarray = params["W"].astype(np.float32)
    W_onnx = W.T  # shape: (input_dim, output_dim)
    b: np.ndarray = params["b"].astype(np.float32)

    X_input = helper.make_tensor_value_info("input", TensorProto.FLOAT, [None, input_dim])
    output_info = helper.make_tensor_value_info("output", TensorProto.FLOAT, [None, output_dim])

    W_init = numpy_helper.from_array(W_onnx, name="W")
    b_init = numpy_helper.from_array(b, name="b")

    gemm_node = helper.make_node(
        "Gemm",
        inputs=["input", "W", "b"],
        outputs=["gemm_out"],
        transB=0,
    )

    # Clip output to [1.0, 10.0] to match the numpy model's forward() clamp.
    clip_min = numpy_helper.from_array(np.array(1.0, dtype=np.float32), name="clip_min")
    clip_max = numpy_helper.from_array(np.array(10.0, dtype=np.float32), name="clip_max")
    clip_node = helper.make_node(
        "Clip",
        inputs=["gemm_out", "clip_min", "clip_max"],
        outputs=["output"],
    )

    graph = helper.make_graph(
        [gemm_node, clip_node],
        "linear_grading_model",
        [X_input],
        [output_info],
        initializer=[W_init, b_init, clip_min, clip_max],
    )

    model_proto = helper.make_model(graph, opset_imports=[helper.make_opsetid("", opset_version)])
    model_proto.ir_version = 8
    onnx.checker.check_model(model_proto)
    onnx.save(model_proto, str(output_path))
    return output_path


def _export_torch(
    model: Any,
    output_path: Path,
    input_dim: int,
    output_dim: int,
    opset_version: int,
) -> Path:
    """Delegate to torch.onnx.export for a proper CNN model."""
    try:
        import torch
    except ImportError as exc:
        raise ImportError(
            "CORNERS_USE_TORCH=1 requires 'torch'. Install the 'ml' optional deps."
        ) from exc

    dummy_input = torch.zeros(1, input_dim)
    model.eval()
    torch.onnx.export(
        model,
        dummy_input,
        str(output_path),
        opset_version=opset_version,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
    )
    return output_path


def load_onnx_session(model_path: str | Path) -> Any:
    """Load an ONNX model into an onnxruntime InferenceSession.

    Args:
        model_path: Path to the ``.onnx`` file.

    Returns:
        ``onnxruntime.InferenceSession`` object.

    Raises:
        ImportError: If ``onnxruntime`` is not installed.
        FileNotFoundError: If ``model_path`` does not exist.
    """
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise ImportError(
            "Inference requires 'onnxruntime'. Add it to dev extras: "
            "pip install onnxruntime"
        ) from exc

    model_path = Path(model_path)
    if not model_path.exists():
        raise FileNotFoundError(f"ONNX model not found: {model_path}")

    return ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])


def run_onnx_inference(
    session: Any,
    X: np.ndarray,
) -> np.ndarray:
    """Run inference on a loaded ONNX session.

    Args:
        session: ``onnxruntime.InferenceSession``.
        X: Input array matching the model's input shape.

    Returns:
        Output array from the first output node.
    """
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: X.astype(np.float32)})
    return outputs[0]
