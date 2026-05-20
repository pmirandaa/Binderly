"""Tests for ml_common/image_loader.py."""

from __future__ import annotations

import os

import numpy as np
import pytest

from grading.ml_common.image_loader import ImageLoader


URL_A = "https://cdn.example.com/card_A.jpg"
URL_B = "https://cdn.example.com/card_B.jpg"


class TestImageLoaderMockMode:
    def test_returns_correct_shape(self):
        loader = ImageLoader(live=False)
        img = loader.load(URL_A)
        assert img.shape == (256, 256, 3)

    def test_returns_float32(self):
        loader = ImageLoader(live=False)
        img = loader.load(URL_A)
        assert img.dtype == np.float32

    def test_values_in_unit_range(self):
        loader = ImageLoader(live=False)
        img = loader.load(URL_A)
        assert img.min() >= 0.0
        assert img.max() <= 1.0

    def test_deterministic_same_url(self):
        loader = ImageLoader(live=False)
        img1 = loader.load(URL_A)
        img2 = loader.load(URL_A)
        np.testing.assert_array_equal(img1, img2)

    def test_different_urls_produce_different_arrays(self):
        loader = ImageLoader(live=False)
        img_a = loader.load(URL_A)
        img_b = loader.load(URL_B)
        assert not np.array_equal(img_a, img_b)

    def test_custom_size(self):
        loader = ImageLoader(live=False, size=64)
        img = loader.load(URL_A)
        assert img.shape == (64, 64, 3)

    def test_is_live_false(self):
        loader = ImageLoader(live=False)
        assert loader.is_live is False

    def test_batch_returns_stacked(self):
        loader = ImageLoader(live=False)
        batch = loader.load_batch([URL_A, URL_B])
        assert batch.shape == (2, 256, 256, 3)

    def test_empty_batch_returns_empty(self):
        loader = ImageLoader(live=False)
        batch = loader.load_batch([])
        assert batch.shape == (0, 256, 256, 3)

    def test_env_var_controls_mode(self, monkeypatch):
        monkeypatch.delenv("CORNERS_LIVE_IMAGES", raising=False)
        loader = ImageLoader()
        assert loader.is_live is False

    def test_env_var_1_enables_live(self, monkeypatch):
        monkeypatch.setenv("CORNERS_LIVE_IMAGES", "1")
        loader = ImageLoader()
        assert loader.is_live is True

    def test_env_var_0_disables_live(self, monkeypatch):
        monkeypatch.setenv("CORNERS_LIVE_IMAGES", "0")
        loader = ImageLoader()
        assert loader.is_live is False


@pytest.mark.skipif(
    os.environ.get("CORNERS_LIVE_IMAGES") != "1",
    reason="Live image tests require CORNERS_LIVE_IMAGES=1",
)
class TestImageLoaderLiveMode:
    """Live-mode tests — skipped unless CORNERS_LIVE_IMAGES=1."""

    def test_live_loader_returns_array(self):
        loader = ImageLoader(live=True)
        img = loader.load("https://via.placeholder.com/256")
        assert img.shape == (256, 256, 3)
        assert img.dtype == np.float32
