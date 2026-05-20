"""Shared fixtures for corners tests."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from grading.corners.dataset import CornersDataset
from grading.corners.model import CornersModel
from grading.ml_common.data_loader import MergedDataLoader
from grading.ml_common.image_loader import ImageLoader
from grading.ml_common.types import LabelledGradingSample


PATCH_SIZE = 8
INPUT_DIM = 4 * PATCH_SIZE * PATCH_SIZE * 3  # 768


def _make_psa_rows(n: int = 8) -> list[dict[str, Any]]:
    rows = []
    for i in range(n):
        grade = float(5 + (i % 6))
        corners = round(grade - 0.5 + (i % 2) * 0.5, 1)
        rows.append({
            "source_id": f"PSA-{i:05d}",
            "grade_company": "PSA",
            "grade": str(grade),
            "subgrades": {"corners": corners, "centering": grade},
            "images": {"front": f"mock://psa/{i}_front.jpg"},
            "printing_id": None,
            "raw_metadata": {},
        })
    return rows


def _make_ebay_rows(n: int = 7) -> list[dict[str, Any]]:
    rows = []
    for i in range(n):
        grade = float(6 + (i % 5))
        corners = round(grade - 0.5, 1)
        rows.append({
            "listing_id": f"EBAY-{i:04d}",
            "parsed_grading_company": "PSA",
            "parsed_overall_grade": str(grade),
            "parsed_sub_grades": {"corners": corners},
            "thumbnail_url": f"mock://ebay/{i}.jpg",
            "printing_id": None,
            "title": f"PSA {grade} Card {i}",
        })
    return rows


def _make_auction_rows(n: int = 10) -> list[dict[str, Any]]:
    rows = []
    for i in range(n):
        grade = float(7 + (i % 4))
        corners = round(grade - 0.5 + (i % 3) * 0.25, 1)
        rows.append({
            "lot_id": f"PWCC-{i:04d}",
            "auction_house": "pwcc",
            "parsed_grading_company": "PSA",
            "parsed_overall_grade": str(grade),
            "parsed_sub_grades": {"corners": corners},
            "lot_image_urls": [f"mock://pwcc/{i}_a.jpg", f"mock://pwcc/{i}_b.jpg"],
            "printing_id": None,
            "lot_title": f"PSA {grade} Card {i}",
        })
    return rows


@pytest.fixture
def psa_rows():
    return _make_psa_rows()


@pytest.fixture
def ebay_rows():
    return _make_ebay_rows()


@pytest.fixture
def auction_rows():
    return _make_auction_rows()


@pytest.fixture
def labelled_samples(psa_rows, ebay_rows, auction_rows):
    loader = MergedDataLoader(psa_rows, ebay_rows, auction_rows)
    return loader.load_labelled()


@pytest.fixture
def mock_loader():
    return ImageLoader(live=False, size=PATCH_SIZE)


@pytest.fixture
def dataset(labelled_samples, mock_loader):
    return CornersDataset(labelled_samples, image_loader=mock_loader, patch_size=PATCH_SIZE)


@pytest.fixture
def model():
    return CornersModel(input_dim=INPUT_DIM, random_seed=42)


@pytest.fixture
def trained_model(dataset):
    from grading.ml_common.training_loop import TrainingLoop, mse_loss
    from grading.ml_common.types import TrainingConfig

    X, y = dataset.build_arrays()
    m = CornersModel(input_dim=dataset.input_dim, random_seed=42)
    config = TrainingConfig(num_epochs=2, batch_size=4, random_seed=42)
    loop = TrainingLoop(m, mse_loss, config)
    loop.run(X, y)
    return m


@pytest.fixture
def tmp_onnx_path(tmp_path):
    return tmp_path / "corners_test.onnx"
