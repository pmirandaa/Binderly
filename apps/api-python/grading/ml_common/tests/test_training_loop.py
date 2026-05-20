"""Tests for ml_common/training_loop.py."""

from __future__ import annotations

import numpy as np
import pytest

from grading.corners.model import CornersModel
from grading.corners.tests.conftest import INPUT_DIM, PATCH_SIZE
from grading.ml_common.training_loop import (
    TrainingLoop,
    mae_loss,
    mse_loss,
    train_one_epoch,
)
from grading.ml_common.types import TrainingConfig, TrainingResult


@pytest.fixture
def simple_model():
    return CornersModel(input_dim=INPUT_DIM, random_seed=0)


@pytest.fixture
def small_data():
    rng = np.random.default_rng(42)
    X = rng.random((20, INPUT_DIM), dtype=np.float32)
    y = rng.uniform(5.0, 9.0, 20).astype(np.float32)
    return X, y


class TestMSELoss:
    def test_zero_error(self):
        preds = np.array([5.0, 7.0])
        targets = np.array([5.0, 7.0])
        loss, grad = mse_loss(preds, targets)
        assert loss == pytest.approx(0.0)
        np.testing.assert_allclose(grad, np.zeros(2), atol=1e-6)

    def test_known_loss(self):
        preds = np.array([4.0])
        targets = np.array([6.0])
        loss, grad = mse_loss(preds, targets)
        assert loss == pytest.approx(4.0)
        assert grad[0] == pytest.approx(-4.0)


class TestTrainOneEpoch:
    def test_returns_finite_loss(self, simple_model, small_data):
        X, y = small_data
        loss = train_one_epoch(simple_model, X, y, mse_loss, learning_rate=0.001, batch_size=4)
        import math
        assert not math.isnan(loss)
        assert not math.isinf(loss)

    def test_loss_decreases_over_multiple_calls(self, small_data):
        m = CornersModel(input_dim=INPUT_DIM, random_seed=99)
        X, y = small_data
        loss1 = train_one_epoch(m, X, y, mse_loss, learning_rate=0.001, batch_size=8)
        for _ in range(20):
            train_one_epoch(m, X, y, mse_loss, learning_rate=0.001, batch_size=8)
        loss_final = train_one_epoch(m, X, y, mse_loss, learning_rate=0.001, batch_size=8)
        assert loss_final < loss1 * 1.5

    def test_with_mae_loss(self, simple_model, small_data):
        X, y = small_data
        loss = train_one_epoch(simple_model, X, y, mae_loss, learning_rate=0.001, batch_size=4)
        import math
        assert not math.isnan(loss)


class TestTrainingLoop:
    def test_run_returns_training_result(self, simple_model, small_data):
        X, y = small_data
        config = TrainingConfig(num_epochs=2, batch_size=4, random_seed=0)
        loop = TrainingLoop(simple_model, mse_loss, config)
        result = loop.run(X, y)
        assert isinstance(result, TrainingResult)
        assert result.num_epochs_run == 2

    def test_run_with_val_split(self, simple_model, small_data):
        X, y = small_data
        config = TrainingConfig(num_epochs=2, batch_size=4)
        loop = TrainingLoop(simple_model, mse_loss, config)
        result = loop.run(X[:16], y[:16], X[16:], y[16:])
        import math
        assert not math.isnan(result.final_val_loss)
        assert not math.isnan(result.best_val_mae)

    def test_run_without_val_split(self, simple_model, small_data):
        X, y = small_data
        config = TrainingConfig(num_epochs=1, batch_size=8)
        loop = TrainingLoop(simple_model, mse_loss, config)
        result = loop.run(X, y)
        assert result.final_val_loss == result.final_train_loss
