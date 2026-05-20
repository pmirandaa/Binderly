"""EdgesModel — regression model for the edges sub-grade.

CI / smoke-test implementation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
A numpy linear regression model.  Input: flattened feature vector of shape
``(N, input_dim)``; output: predicted sub-grades ``(N, 1)``.

This placeholder exists so the full training / eval / export / inference
pipeline can be exercised in CI without installing PyTorch.

Production architecture (``EDGES_USE_TORCH=1``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Replace this module with a proper CNN:

    backbone = torchvision.models.mobilenet_v3_small(weights='IMAGENET1K_V1')
    backbone.classifier = nn.Sequential(
        nn.Linear(backbone.last_channel, 64),
        nn.Hardswish(),
        nn.Linear(64, 1),
    )

Process 4 edge strips independently through the shared backbone.  Each strip
(top, bottom, left, right) is letterboxed to 224×224 RGB before passing through
the ImageNet-pretrained backbone.  Average the 4 logit outputs, clamp to
[1.0, 10.0].  At 256 px normalisation: top/bottom strips are 256×32 px
(letterboxed), left/right strips are 32×256 px (letterboxed).

The numpy placeholder uses the same ``forward`` / ``_backward`` / ``get_parameters``
/ ``set_parameters`` API so the training loop is framework-agnostic.
"""

from __future__ import annotations

import numpy as np


class EdgesModel:
    """Numpy linear regression placeholder for the edges sub-grade.

    ``input_dim`` should match the flattened feature vector produced by
    ``EdgesDataset``.  In the CI smoke test this is
    ``NUM_STRIPS * patch_size * patch_size * 3``  (e.g. 4*8*8*3 = 768).

    Args:
        input_dim: Number of input features.
        output_dim: Number of output neurons (1 for scalar regression).
        random_seed: Seed for weight initialisation.
    """

    def __init__(
        self,
        input_dim: int,
        output_dim: int = 1,
        random_seed: int = 42,
    ) -> None:
        self.input_dim = input_dim
        self.output_dim = output_dim
        rng = np.random.default_rng(random_seed)
        scale = 0.01 / max(input_dim, 1)
        self.W: np.ndarray = rng.normal(0.0, scale, (output_dim, input_dim)).astype(np.float32)
        self.b: np.ndarray = np.zeros(output_dim, dtype=np.float32)

    # ------------------------------------------------------------------
    # Forward pass
    # ------------------------------------------------------------------

    def forward(self, X: np.ndarray) -> np.ndarray:
        """Compute predictions for a batch of feature vectors.

        Args:
            X: Shape ``(N, input_dim)``, dtype float32.

        Returns:
            Shape ``(N,)`` predictions in [1.0, 10.0].
        """
        raw = X @ self.W.T + self.b
        return np.clip(raw[:, 0], 1.0, 10.0)

    # ------------------------------------------------------------------
    # Backward pass (numpy SGD)
    # ------------------------------------------------------------------

    def _backward(
        self,
        X: np.ndarray,
        grad_output: np.ndarray,
        learning_rate: float,
    ) -> None:
        """Apply one mini-batch gradient step (numpy SGD).

        Args:
            X: Input batch ``(N, input_dim)``.
            grad_output: Gradient w.r.t. the output ``(N,)`` from loss fn.
            learning_rate: SGD step size.
        """
        grad_W = (grad_output[:, None] * X).mean(axis=0, keepdims=True)
        grad_b = grad_output.mean(axis=0, keepdims=True)
        self.W -= learning_rate * grad_W
        self.b -= learning_rate * grad_b[0]

    # ------------------------------------------------------------------
    # Parameter persistence
    # ------------------------------------------------------------------

    def get_parameters(self) -> dict:
        """Return model parameters as numpy arrays."""
        return {"W": self.W.copy(), "b": self.b.copy()}

    def set_parameters(self, params: dict) -> None:
        """Set model parameters from a dict."""
        self.W = np.asarray(params["W"], dtype=np.float32)
        self.b = np.asarray(params["b"], dtype=np.float32)
