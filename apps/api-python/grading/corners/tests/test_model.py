"""Tests for corners/model.py."""

from __future__ import annotations

import numpy as np
import pytest

from grading.corners.model import CornersModel
from grading.corners.tests.conftest import INPUT_DIM, PATCH_SIZE


class TestCornersModel:
    def test_forward_output_shape(self, model):
        X = np.random.default_rng(0).random((5, INPUT_DIM), dtype=np.float32)
        out = model.forward(X)
        assert out.shape == (5,)

    def test_forward_clamped_to_range(self, model):
        X = np.ones((3, INPUT_DIM), dtype=np.float32) * 1000.0
        out = model.forward(X)
        assert out.max() <= 10.0
        assert out.min() >= 1.0

    def test_backward_changes_weights(self, model):
        W_before = model.W.copy()
        X = np.random.default_rng(1).random((4, INPUT_DIM), dtype=np.float32)
        preds = model.forward(X)
        grad = np.ones_like(preds) * 0.1
        model._backward(X, grad, learning_rate=0.01)
        assert not np.array_equal(model.W, W_before)

    def test_get_set_parameters_round_trip(self, model):
        params = model.get_parameters()
        original_W = params["W"].copy()
        model.W[:] = 0.0
        model.set_parameters({"W": original_W, "b": params["b"]})
        np.testing.assert_array_equal(model.W, original_W)

    def test_deterministic_init(self):
        m1 = CornersModel(input_dim=INPUT_DIM, random_seed=7)
        m2 = CornersModel(input_dim=INPUT_DIM, random_seed=7)
        np.testing.assert_array_equal(m1.W, m2.W)

    def test_different_seeds_different_weights(self):
        m1 = CornersModel(input_dim=INPUT_DIM, random_seed=1)
        m2 = CornersModel(input_dim=INPUT_DIM, random_seed=2)
        assert not np.array_equal(m1.W, m2.W)

    def test_output_dim_attribute(self):
        m = CornersModel(input_dim=INPUT_DIM, output_dim=1)
        assert m.output_dim == 1

    def test_single_sample_forward(self, model):
        X = np.zeros((1, INPUT_DIM), dtype=np.float32)
        out = model.forward(X)
        assert out.shape == (1,)
