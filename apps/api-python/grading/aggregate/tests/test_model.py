"""Tests for ``grading.aggregate.model``."""

from __future__ import annotations

import numpy as np
import pytest

from grading.aggregate.model import LinearWeightedAggregator, round_to_psa_tick
from grading.aggregate.types import (
    DEFAULT_WEIGHTS,
    SUBGRADE_NAMES,
    AggregateWeights,
    SubGradeInputs,
)


class TestRoundToPsaTick:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (1.0, 1.0),
            (1.24, 1.0),
            (1.26, 1.5),
            (5.5, 5.5),
            (5.49, 5.5),
            (5.51, 5.5),
            (8.74, 8.5),
            (8.76, 9.0),
            (9.99, 10.0),
            (10.0, 10.0),
            (-1.0, 1.0),     # clamp below floor
            (11.0, 10.0),    # clamp above cap
        ],
    )
    def test_psa_tick_boundaries(self, raw, expected):
        assert round_to_psa_tick(raw) == pytest.approx(expected)

    def test_rounds_to_05_grid(self):
        # Every output must be a multiple of 0.5 in [1.0, 10.0]
        for v in np.linspace(0.0, 12.0, 200):
            out = round_to_psa_tick(float(v))
            assert 1.0 <= out <= 10.0
            assert abs(out * 2 - round(out * 2)) < 1e-9

    def test_banker_rounding_at_half_tick(self):
        # 8.25 → 8.0 (banker: round-half-to-even on the 0.5 tick)
        # 8.75 → 9.0 (banker: round-half-to-even on the 0.5 tick)
        assert round_to_psa_tick(8.25) == pytest.approx(8.0)
        assert round_to_psa_tick(8.75) == pytest.approx(9.0)


class TestLinearWeightedAggregator:
    def test_constructed_with_default_weights(self):
        agg = LinearWeightedAggregator()
        assert agg.weights == DEFAULT_WEIGHTS

    def test_constructed_with_custom_weights(self):
        w = AggregateWeights(centering=0.4, corners=0.4, edges=0.1, surface=0.1)
        agg = LinearWeightedAggregator(weights=w)
        assert agg.weights == w

    def test_W_shape(self):
        agg = LinearWeightedAggregator()
        assert agg.W.shape == (1, len(SUBGRADE_NAMES))

    def test_b_shape(self):
        agg = LinearWeightedAggregator()
        assert agg.b.shape == (1,)

    def test_input_dim_matches_subgrade_count(self):
        agg = LinearWeightedAggregator()
        assert agg.input_dim == len(SUBGRADE_NAMES)

    def test_forward_all_perfect_input(self):
        agg = LinearWeightedAggregator()
        X = np.full((1, 4), 10.0, dtype=np.float32)
        out = agg.forward(X)
        assert out.shape == (1,)
        assert out[0] == pytest.approx(10.0)

    def test_forward_floor_input(self):
        agg = LinearWeightedAggregator()
        X = np.full((1, 4), 1.0, dtype=np.float32)
        out = agg.forward(X)
        assert out[0] == pytest.approx(1.0)

    def test_forward_uniform_8(self):
        agg = LinearWeightedAggregator()
        X = np.full((3, 4), 8.0, dtype=np.float32)
        out = agg.forward(X)
        assert out.shape == (3,)
        for v in out:
            assert v == pytest.approx(8.0)

    def test_forward_matches_weighted_sum_default_priors(self):
        agg = LinearWeightedAggregator()
        # [centering, corners, edges, surface] = [9, 8, 7, 6]
        # weighted-sum = 0.25*9 + 0.35*8 + 0.25*7 + 0.15*6 = 2.25 + 2.8 + 1.75 + 0.9 = 7.7
        X = np.array([[9.0, 8.0, 7.0, 6.0]], dtype=np.float32)
        out = agg.forward(X)
        assert out[0] == pytest.approx(7.7, abs=1e-4)

    def test_predict_single_matches_forward(self):
        agg = LinearWeightedAggregator()
        inputs = SubGradeInputs(
            scores={"centering": 9.0, "corners": 8.0, "edges": 7.0, "surface": 6.0},
            confidences={name: 0.8 for name in SUBGRADE_NAMES},
        )
        raw = agg.predict_single(inputs)
        assert raw == pytest.approx(7.7, abs=1e-4)

    def test_forward_clamps_above_cap(self):
        # Inputs are constrained to [1.0, 10.0]; verify the clamp still triggers
        # when W is exotic (e.g. all corners weight on a 10).
        w = AggregateWeights(centering=0.0, corners=1.0, edges=0.0, surface=0.0)
        agg = LinearWeightedAggregator(weights=w)
        X = np.array([[10.0, 10.0, 10.0, 10.0]], dtype=np.float32)
        out = agg.forward(X)
        assert 1.0 <= out[0] <= 10.0

    def test_forward_clamps_below_floor(self):
        # Inputs of 1.0 produce 1.0 — clamp tested via predict path.
        agg = LinearWeightedAggregator()
        X = np.array([[1.0, 1.0, 1.0, 1.0]], dtype=np.float32)
        out = agg.forward(X)
        assert out[0] >= 1.0

    def test_get_set_parameters_roundtrip(self):
        agg = LinearWeightedAggregator()
        params = agg.get_parameters()
        params["W"][0, 0] = 0.5
        params["W"][0, 1] = 0.2
        params["W"][0, 2] = 0.2
        params["W"][0, 3] = 0.1
        agg.set_parameters(params)
        assert agg.weights.centering == pytest.approx(0.5)
        assert agg.weights.corners == pytest.approx(0.2)

    def test_set_parameters_normalises_weights(self):
        agg = LinearWeightedAggregator()
        params = agg.get_parameters()
        params["W"][0, 0] = 2.0
        params["W"][0, 1] = 2.0
        params["W"][0, 2] = 2.0
        params["W"][0, 3] = 2.0
        agg.set_parameters(params)
        total = (
            agg.weights.centering
            + agg.weights.corners
            + agg.weights.edges
            + agg.weights.surface
        )
        assert total == pytest.approx(1.0, abs=1e-6)

    def test_alternate_priors(self):
        # Equal weights → simple average.
        w = AggregateWeights(centering=0.25, corners=0.25, edges=0.25, surface=0.25)
        agg = LinearWeightedAggregator(weights=w)
        X = np.array([[10.0, 8.0, 6.0, 4.0]], dtype=np.float32)
        out = agg.forward(X)
        assert out[0] == pytest.approx(7.0, abs=1e-4)
