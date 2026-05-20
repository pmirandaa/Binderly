"""PSA cert-lookup scraper.

Public surface:

    from grading.scrapers.psa import PsaCertRecord, PsaParser, PsaClient, run_job

Mock-by-default: live HTTP is gated behind ``PSA_LIVE=1``. All tests run
against checked-in synthetic HTML fixtures in ``tests/fixtures/``.
"""

from .client import PsaClient, TosBlockError
from .job import run_job
from .parser import PsaParser
from .types import PsaCertRecord

__all__ = ["PsaCertRecord", "PsaParser", "PsaClient", "TosBlockError", "run_job"]
