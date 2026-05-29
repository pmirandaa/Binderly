"""Shared fixtures for the community flywheel tests.

Everything here is in-memory: no DB, no network, no storage. Mirrors the
scrapers' fixture posture (``db_upsert_fn`` is a list-appending stub).
"""

from __future__ import annotations

from typing import Any, Callable

import pytest

from grading.flywheel.types import CommunitySubmission


def _base_images() -> dict[str, Any]:
    return {
        "front": "https://cdn.binderly.test/u/1/front.jpg",
        "back": "https://cdn.binderly.test/u/1/back.jpg",
        "corners": [
            "https://cdn.binderly.test/u/1/corner-fl.jpg",
            "https://cdn.binderly.test/u/1/corner-br.jpg",
        ],
        "surface": "https://cdn.binderly.test/u/1/surface.jpg",
        "slab": "https://cdn.binderly.test/u/1/slab.jpg",
    }


@pytest.fixture
def make_submission() -> Callable[..., CommunitySubmission]:
    """Factory for a valid ``CommunitySubmission`` with overridable fields."""

    def _make(**overrides: Any) -> CommunitySubmission:
        defaults: dict[str, Any] = {
            "grade_company": "PSA",
            "cert_number": "12345678",
            "overall_grade": 9.0,
            "subgrades": None,
            "image_urls": _base_images(),
            "user_id": "00000000-0000-0000-0000-000000000001",
            "consent": True,
            "black_label": False,
            "raw_grade_label": "PSA 9",
        }
        defaults.update(overrides)
        return CommunitySubmission(**defaults)

    return _make


@pytest.fixture
def valid_submission(make_submission: Callable[..., CommunitySubmission]) -> CommunitySubmission:
    return make_submission()


@pytest.fixture
def upsert_store() -> list[dict[str, Any]]:
    return []


@pytest.fixture
def upsert_fn(upsert_store: list[dict[str, Any]]) -> Callable[[dict[str, Any]], None]:
    def _upsert(row: dict[str, Any]) -> None:
        upsert_store.append(row)

    return _upsert
