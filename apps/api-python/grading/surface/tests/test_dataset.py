"""Tests for surface/dataset.py — SurfaceDataset + SurfaceMergedDataLoader."""

from __future__ import annotations

import numpy as np
import pytest

from grading.ml_common.types import LabelledGradingSample
from grading.surface.dataset import SurfaceDataset, SurfaceMergedDataLoader
from grading.surface.tests.conftest import (
    INPUT_DIM,
    PATCH_SIZE,
    _make_auction_rows,
    _make_ebay_rows,
    _make_psa_rows,
    _make_rows_without_surface,
)
from grading.surface.types import NUM_SURFACE_SHOTS_V1, NUM_SURFACE_SHOTS_WITH_RAKING


# ---------------------------------------------------------------------------
# SurfaceDataset
# ---------------------------------------------------------------------------


class TestSurfaceDataset:
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
        ds = SurfaceDataset([], image_loader=mock_loader, patch_size=PATCH_SIZE)
        X, y = ds.build_arrays()
        assert X.shape == (0, INPUT_DIM)
        assert y.shape == (0,)

    def test_input_dim_matches_constant(self, dataset):
        assert dataset.input_dim == INPUT_DIM

    def test_num_shots_attribute(self, dataset):
        assert dataset.num_shots == NUM_SURFACE_SHOTS_V1

    def test_unlabelled_samples_excluded(self, mock_loader):
        samples = [
            LabelledGradingSample(
                source="psa_cert",
                source_id="1",
                grade_company="PSA",
                overall_grade=9.0,
                corners_score=None,
            ),
            LabelledGradingSample(
                source="psa_cert",
                source_id="2",
                grade_company="PSA",
                overall_grade=9.0,
                corners_score=8.5,
            ),
        ]
        ds = SurfaceDataset(samples, image_loader=mock_loader, patch_size=PATCH_SIZE)
        assert len(ds) == 1

    def test_no_image_urls_uses_placeholder(self, mock_loader):
        samples = [
            LabelledGradingSample(
                source="psa_cert",
                source_id="3",
                grade_company="PSA",
                overall_grade=8.0,
                corners_score=7.5,
                image_urls=[],
            )
        ]
        ds = SurfaceDataset(samples, image_loader=mock_loader, patch_size=PATCH_SIZE)
        feature, label = ds[0]
        assert feature.shape == (INPUT_DIM,)
        assert label == pytest.approx(7.5)

    def test_raking_light_dim(self, mock_loader):
        samples = [
            LabelledGradingSample(
                source="psa_cert",
                source_id="4",
                grade_company="PSA",
                overall_grade=9.0,
                corners_score=9.0,
                image_urls=["mock://a.jpg", "mock://b.jpg", "mock://c.jpg"],
            )
        ]
        raking_dim = NUM_SURFACE_SHOTS_WITH_RAKING * PATCH_SIZE * PATCH_SIZE * 3
        ds = SurfaceDataset(
            samples,
            image_loader=mock_loader,
            patch_size=PATCH_SIZE,
            num_shots=NUM_SURFACE_SHOTS_WITH_RAKING,
        )
        assert ds.input_dim == raking_dim
        feature, _ = ds[0]
        assert feature.shape == (raking_dim,)

    def test_invalid_num_shots_raises(self, mock_loader):
        with pytest.raises(ValueError, match="num_shots must be"):
            SurfaceDataset([], image_loader=mock_loader, patch_size=PATCH_SIZE, num_shots=5)

    def test_single_image_url_padded_to_num_shots(self, mock_loader):
        samples = [
            LabelledGradingSample(
                source="psa_cert",
                source_id="5",
                grade_company="PSA",
                overall_grade=8.0,
                corners_score=8.0,
                image_urls=["mock://single.jpg"],
            )
        ]
        ds = SurfaceDataset(samples, image_loader=mock_loader, patch_size=PATCH_SIZE)
        feature, _ = ds[0]
        assert feature.shape == (INPUT_DIM,)


# ---------------------------------------------------------------------------
# SurfaceMergedDataLoader
# ---------------------------------------------------------------------------


class TestSurfaceMergedDataLoader:
    def test_load_labelled_psa_only(self):
        loader = SurfaceMergedDataLoader(_make_psa_rows(5), [], [])
        labelled = loader.load_labelled()
        assert len(labelled) == 5

    def test_load_labelled_ebay_only(self):
        loader = SurfaceMergedDataLoader([], _make_ebay_rows(6), [])
        labelled = loader.load_labelled()
        assert len(labelled) == 6

    def test_load_labelled_auction_only(self):
        loader = SurfaceMergedDataLoader([], [], _make_auction_rows(7))
        labelled = loader.load_labelled()
        assert len(labelled) == 7

    def test_load_labelled_merges_all_sources(self):
        loader = SurfaceMergedDataLoader(
            _make_psa_rows(4), _make_ebay_rows(3), _make_auction_rows(5)
        )
        labelled = loader.load_labelled()
        assert len(labelled) == 12

    def test_rows_without_surface_excluded(self):
        loader = SurfaceMergedDataLoader(_make_rows_without_surface(5), [], [])
        labelled = loader.load_labelled()
        assert len(labelled) == 0

    def test_load_all_includes_unlabelled(self):
        loader = SurfaceMergedDataLoader(_make_rows_without_surface(3), _make_ebay_rows(2), [])
        all_samples = loader.load_all()
        labelled = loader.load_labelled()
        assert len(all_samples) == 5
        assert len(labelled) == 2

    def test_len_matches_labelled(self):
        loader = SurfaceMergedDataLoader(_make_psa_rows(4), _make_ebay_rows(3), [])
        assert len(loader) == 7

    def test_load_and_load_labelled_equivalent(self):
        loader = SurfaceMergedDataLoader(_make_psa_rows(5), [], [])
        assert loader.load() == loader.load_labelled()

    def test_surface_score_stored_in_corners_score_field(self):
        psa_rows = [
            {
                "source_id": "PSA-SURF-001",
                "grade_company": "PSA",
                "grade": "9",
                "subgrades": {"surface": 8.5},
                "images": {"front": "mock://front.jpg"},
                "printing_id": None,
                "raw_metadata": {},
            }
        ]
        loader = SurfaceMergedDataLoader(psa_rows, [], [])
        labelled = loader.load_labelled()
        assert len(labelled) == 1
        assert labelled[0].corners_score == pytest.approx(8.5)

    def test_ebay_surface_score_stored_correctly(self):
        ebay_rows = [
            {
                "listing_id": "EBAY-SURF-001",
                "parsed_grading_company": "PSA",
                "parsed_overall_grade": "8",
                "parsed_sub_grades": {"surface": 7.5},
                "thumbnail_url": "mock://ebay.jpg",
                "printing_id": None,
                "title": "test",
            }
        ]
        loader = SurfaceMergedDataLoader([], ebay_rows, [])
        labelled = loader.load_labelled()
        assert len(labelled) == 1
        assert labelled[0].corners_score == pytest.approx(7.5)

    def test_empty_all_sources_returns_empty(self):
        loader = SurfaceMergedDataLoader([], [], [])
        assert len(loader.load_labelled()) == 0
