"""Tests for edges/dataset.py.

Edges training data flows through the shared
``grading.ml_common.MergedDataLoader`` keyed to ``subgrade_key='edges'``
(see #FU-44 / Q-017); these tests exercise the edges keying + ``EdgesDataset``.
"""

from __future__ import annotations

import numpy as np
import pytest

from grading.edges.dataset import EdgesDataset
from grading.edges.tests.conftest import INPUT_DIM, PATCH_SIZE, _make_psa_rows
from grading.edges.types import NUM_STRIPS
from grading.ml_common.data_loader import MergedDataLoader
from grading.ml_common.types import LabelledGradingSample


class TestEdgesDataset:
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
        ds = EdgesDataset([], image_loader=mock_loader, patch_size=PATCH_SIZE)
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
        ds = EdgesDataset(samples, image_loader=mock_loader, patch_size=PATCH_SIZE)
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
        ds = EdgesDataset(samples, image_loader=mock_loader, patch_size=PATCH_SIZE)
        feature, label = ds[0]
        assert feature.shape == (INPUT_DIM,)
        assert label == pytest.approx(7.5)

    def test_input_dim_is_four_strips(self, dataset):
        expected = NUM_STRIPS * PATCH_SIZE * PATCH_SIZE * 3
        assert dataset.input_dim == expected

    def test_all_labels_in_valid_range(self, dataset):
        _, y = dataset.build_arrays()
        assert np.all(y >= 1.0)
        assert np.all(y <= 10.0)


class TestEdgesMergedDataLoader:
    """The edges loader is now ``MergedDataLoader(subgrade_key='edges')``."""

    def test_load_labelled_filters_unlabelled(self, psa_rows, ebay_rows, auction_rows):
        loader = MergedDataLoader(psa_rows, ebay_rows, auction_rows, subgrade_key="edges")
        labelled = loader.load_labelled()
        assert all(s.subgrade_score is not None for s in labelled)

    def test_load_all_includes_unlabelled(self):
        psa_rows = [
            {
                "source_id": "X1",
                "grade_company": "PSA",
                "grade": "9",
                "subgrades": {},
                "images": {"front": "mock://x1.jpg"},
                "printing_id": None,
                "raw_metadata": {},
            }
        ]
        loader = MergedDataLoader(psa_rows, [], [], subgrade_key="edges")
        all_samples = loader.load_all()
        labelled = loader.load_labelled()
        assert len(all_samples) >= len(labelled)
        assert len(all_samples) > 0
        assert len(labelled) == 0

    def test_len_counts_labelled_only(self, psa_rows, ebay_rows, auction_rows):
        loader = MergedDataLoader(psa_rows, ebay_rows, auction_rows, subgrade_key="edges")
        assert len(loader) == len(loader.load_labelled())

    def test_merges_all_three_sources(self, psa_rows, ebay_rows, auction_rows):
        loader = MergedDataLoader(psa_rows, ebay_rows, auction_rows, subgrade_key="edges")
        labelled = loader.load_labelled()
        sources = {s.source for s in labelled}
        assert "psa_cert" in sources
        assert "ebay_sold" in sources
        assert any("auction" in src for src in sources)

    def test_psa_only_works(self):
        psa_rows = _make_psa_rows(5)
        loader = MergedDataLoader(psa_rows, [], [], subgrade_key="edges")
        labelled = loader.load_labelled()
        assert len(labelled) == 5
        assert all(s.source == "psa_cert" for s in labelled)

    def test_empty_all_sources(self):
        loader = MergedDataLoader([], [], [], subgrade_key="edges")
        assert loader.load_labelled() == []

    def test_non_psa_rows_excluded_from_psa_loader(self):
        rows = [
            {
                "source_id": "BGS1",
                "grade_company": "BGS",
                "grade": "9",
                "subgrades": {"edges": 8.5},
                "images": {},
                "printing_id": None,
                "raw_metadata": {},
            }
        ]
        loader = MergedDataLoader(rows, [], [], subgrade_key="edges")
        labelled = loader.load_labelled()
        assert len(labelled) == 0
