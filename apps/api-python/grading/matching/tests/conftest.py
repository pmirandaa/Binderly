"""Shared fixtures for printing-match tests."""

from __future__ import annotations

import pytest

from grading.matching.backfill import load_catalog_fixture
from grading.matching.matcher import PrintingMatcher
from grading.matching.types import CanonicalPrinting


@pytest.fixture
def catalog() -> list[CanonicalPrinting]:
    return load_catalog_fixture()


@pytest.fixture
def matcher(catalog) -> PrintingMatcher:
    return PrintingMatcher(catalog)
