"""Tests for image preprocessing + L2 normalisation."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from embeddings.normalize import (
    PREPROCESSING_NAMES,
    l2_normalize,
    preprocess_batch,
    preprocess_image,
)


class TestL2Normalize:
    def test_unit_norm_for_random_2d(self) -> None:
        rng = np.random.default_rng(0)
        vectors = rng.normal(size=(10, 32)).astype(np.float32)
        out = l2_normalize(vectors)
        norms = np.linalg.norm(out, axis=1)
        np.testing.assert_allclose(norms, 1.0, atol=1e-5)

    def test_handles_zero_vector_without_nan(self) -> None:
        vectors = np.zeros((1, 4), dtype=np.float32)
        out = l2_normalize(vectors)
        assert not np.isnan(out).any()
        np.testing.assert_array_equal(out, vectors)

    def test_1d_input_returns_1d(self) -> None:
        out = l2_normalize(np.array([3.0, 4.0], dtype=np.float32))
        assert out.shape == (2,)
        np.testing.assert_allclose(out, [0.6, 0.8], atol=1e-6)

    def test_rejects_3d(self) -> None:
        with pytest.raises(ValueError, match="1-D or 2-D"):
            l2_normalize(np.zeros((2, 3, 4), dtype=np.float32))

    def test_dtype_is_float32(self) -> None:
        out = l2_normalize(np.array([[3.0, 4.0]], dtype=np.float64))
        assert out.dtype == np.float32


class TestPreprocessImage:
    def test_mobilenet_v3_range(self, tmp_path: Path) -> None:
        # All-white image should land at +1 after `/127.5 - 1`.
        img = Image.new("RGB", (16, 16), color=(255, 255, 255))
        path = tmp_path / "white.png"
        img.save(path)
        out = preprocess_image(
            path, target_size=(8, 8), normalization="mobilenet_v3"
        )
        assert out.shape == (8, 8, 3)
        assert out.dtype == np.float32
        np.testing.assert_allclose(out, 1.0, atol=1e-6)

    def test_zero_one_range(self) -> None:
        img = Image.new("RGB", (16, 16), color=(128, 128, 128))
        out = preprocess_image(img, target_size=(4, 4), normalization="zero_one")
        np.testing.assert_allclose(out, 128 / 255.0, atol=1e-6)

    def test_imagenet_normalises(self) -> None:
        # Mid-grey input ⇒ (0.5 − mean) / std.
        img = Image.new("RGB", (16, 16), color=(128, 128, 128))
        out = preprocess_image(img, target_size=(4, 4), normalization="imagenet")
        expected_r = (128 / 255.0 - 0.485) / 0.229
        np.testing.assert_allclose(out[..., 0], expected_r, atol=1e-5)

    def test_resizes_to_target(self) -> None:
        img = Image.new("RGB", (200, 100), color=(0, 0, 0))
        out = preprocess_image(img, target_size=(50, 75), normalization="zero_one")
        # (H, W, C) → height first.
        assert out.shape == (50, 75, 3)

    def test_accepts_numpy_input(self) -> None:
        arr = np.full((32, 32, 3), 255, dtype=np.uint8)
        out = preprocess_image(arr, target_size=(8, 8), normalization="zero_one")
        assert out.shape == (8, 8, 3)
        np.testing.assert_allclose(out, 1.0, atol=1e-6)

    def test_rejects_unknown_normalization(self) -> None:
        img = Image.new("RGB", (8, 8))
        with pytest.raises(ValueError, match="unknown normalization"):
            preprocess_image(img, target_size=(4, 4), normalization="not-real")

    def test_rejects_bad_numpy_shape(self) -> None:
        with pytest.raises(ValueError, match="HWC RGB"):
            preprocess_image(
                np.zeros((4, 4), dtype=np.uint8),
                target_size=(2, 2),
                normalization="zero_one",
            )

    def test_recipe_registry_is_documented(self) -> None:
        # `PREPROCESSING_NAMES` is the contract the TS side mirrors.
        assert set(PREPROCESSING_NAMES) == {"mobilenet_v3", "zero_one", "imagenet"}


class TestPreprocessBatch:
    def test_stacks_correctly(self, tmp_path: Path) -> None:
        imgs = []
        for i, color in enumerate([(255, 0, 0), (0, 255, 0), (0, 0, 255)]):
            p = tmp_path / f"{i}.png"
            Image.new("RGB", (8, 8), color=color).save(p)
            imgs.append(p)

        out = preprocess_batch(imgs, target_size=(4, 4), normalization="zero_one")
        assert out.shape == (3, 4, 4, 3)
        # Channel-0 of the red image is 1; the others have channel-0 of 0.
        np.testing.assert_allclose(out[0, 0, 0, 0], 1.0, atol=1e-6)
        np.testing.assert_allclose(out[1, 0, 0, 0], 0.0, atol=1e-6)

    def test_empty_input(self) -> None:
        out = preprocess_batch([], target_size=(4, 4), normalization="zero_one")
        assert out.shape == (0, 4, 4, 3)
        assert out.dtype == np.float32
