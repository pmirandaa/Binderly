"""Tests for corners/dataset.py."""

from __future__ import annotations

import numpy as np
import pytest

from grading.corners.dataset import CornersDataset
from grading.corners.tests.conftest import INPUT_DIM, PATCH_SIZE
from grading.corners.types import NUM_CORNERS
from grading.ml_common.types import LabelledGradingSample


class TestCornersDataset:
    def test_length_matches_labelled_samples(self, dataset, labelled_samples):
        assert len(dataset) == len(labelled_samples)

    def test_getitem_returns_feature_and_label(self, dataset):
        feature, label = dataset[0]
        assert feature.shape == (INPUT_DIM,)
        assert isinstance(label, float)
        assert 1.0 <= label <= 10.0

    def test_feature_dtype_is_float32(self, dataset):
        feature, _ = dataset[0]
        assert feature.dtype == np.float32

    def test_build_arrays_shape(self, dataset):
        X, y = dataset.build_arrays()
        assert X.shape == (len(dataset), INPUT_DIM)
        assert y.shape == (len(dataset),)

    def test_empty_dataset_returns_empty_arrays(self, mock_loader):
        ds = CornersDataset([], image_loader=mock_loader, patch_size=PATCH_SIZE)
        X, y = ds.build_arrays()
        assert X.shape == (0, INPUT_DIM)
        assert y.shape == (0,)

    def test_input_dim_matches_constant(self, dataset):
        assert dataset.input_dim == INPUT_DIM

    def test_unlabelled_samples_excluded(self, mock_loader):
        samples = [
            LabelledGradingSample(
                source="psa_cert",
                source_id="1",
                grade_company="PSA",
                overall_grade=9.0,
                subgrade_score=None,
            ),
            LabelledGradingSample(
                source="psa_cert",
                source_id="2",
                grade_company="PSA",
                overall_grade=9.0,
                subgrade_score=8.5,
            ),
        ]
        ds = CornersDataset(samples, image_loader=mock_loader, patch_size=PATCH_SIZE)
        assert len(ds) == 1

    def test_no_image_urls_uses_placeholder(self, mock_loader):
        samples = [
            LabelledGradingSample(
                source="psa_cert",
                source_id="3",
                grade_company="PSA",
                overall_grade=8.0,
                subgrade_score=7.5,
                image_urls=[],
            )
        ]
        ds = CornersDataset(samples, image_loader=mock_loader, patch_size=PATCH_SIZE)
        feature, label = ds[0]
        assert feature.shape == (INPUT_DIM,)
        assert label == pytest.approx(7.5)
