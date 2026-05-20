"""Shared pytest fixtures for the PSA scraper test suite.

All HTML fixtures are loaded from ``tests/fixtures/`` — checked-in synthetic
HTML files that represent real PSA cert page variants.  No live network calls
are made; ``PSA_LIVE`` must never be ``'1'`` during the test run.

Fixture inventory:
  cert_psa10_with_subgrades.html   — PSA 10, all 4 subgrades, front image URL
  cert_psa9_with_subgrades.html    — PSA 9, all 4 subgrades, mixed half-grades
  cert_psa8_no_subgrades.html      — PSA 8, no subgrades (older slab)
  cert_psa1_low_grade.html         — PSA 1
  cert_authentic.html              — Authentic (non-numeric grade)
  cert_authentic_altered.html      — Authentic Altered (non-numeric grade)
  cert_with_qualifier_oc.html      — PSA 9 [OC] qualifier + subgrades
  cloudflare_block.html            — Cloudflare challenge page (ToS block)
"""

from __future__ import annotations

from pathlib import Path

import pytest


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _load(name: str) -> bytes:
    return (FIXTURES_DIR / name).read_bytes()


@pytest.fixture(scope="session")
def fixture_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture(scope="session")
def html_psa10() -> bytes:
    return _load("cert_psa10_with_subgrades.html")


@pytest.fixture(scope="session")
def html_psa9() -> bytes:
    return _load("cert_psa9_with_subgrades.html")


@pytest.fixture(scope="session")
def html_psa8_no_subgrades() -> bytes:
    return _load("cert_psa8_no_subgrades.html")


@pytest.fixture(scope="session")
def html_psa1() -> bytes:
    return _load("cert_psa1_low_grade.html")


@pytest.fixture(scope="session")
def html_authentic() -> bytes:
    return _load("cert_authentic.html")


@pytest.fixture(scope="session")
def html_authentic_altered() -> bytes:
    return _load("cert_authentic_altered.html")


@pytest.fixture(scope="session")
def html_qualifier_oc() -> bytes:
    return _load("cert_with_qualifier_oc.html")


@pytest.fixture(scope="session")
def html_cloudflare_block() -> bytes:
    return _load("cloudflare_block.html")
