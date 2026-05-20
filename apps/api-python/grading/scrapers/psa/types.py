"""Data types for PSA cert scraper output.

``PsaCertRecord`` is the parsed representation of a single PSA cert page.
It maps directly to a ``grading_training_sample`` row (source='psa_cert').

Design notes:
- ``grade`` is ``None`` for non-numeric PSA outcomes ("Authentic",
  "Authentic Altered"). ``grade_label`` preserves the original string.
- ``subgrades`` fields are ``None`` when PSA does not expose them (many
  older slabs show only the overall grade).
- ``qualifiers`` is an ordered list of PSA qualifier codes
  (OC, PD, ST, MC, etc.) as they appear on the cert page.
- ``raw_html_sha256`` is the hex SHA-256 of the raw HTML bytes; used for
  change-detection on re-fetch (same hash → skip upsert).
- ``image_url`` is the front-of-slab image URL if PSA embeds one; ``None``
  if absent.  We store the URL only — download / R2 transcode is a
  separate pipeline step.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Optional


@dataclass(frozen=True)
class PsaCertRecord:
    """Structured output of one parsed PSA cert page.

    All grade fields use ``Decimal`` to avoid float imprecision on half-grades
    (e.g. 8.5).  Values that cannot be expressed numerically (Authentic,
    Authentic Altered) leave ``grade`` as ``None`` and preserve the raw
    string in ``grade_label``.
    """

    cert_number: str
    """PSA's globally unique cert identifier string."""

    cert_url: str
    """The URL this page was fetched from."""

    card_name: Optional[str]
    """Card name as it appears on the cert page (may be None on error pages)."""

    set_name: Optional[str]
    """Set / series name from the cert page."""

    year: Optional[str]
    """Year printed on the cert page (string; may be a range like '1999-2000')."""

    card_number: Optional[str]
    """Card number / set fraction (e.g. '4/102')."""

    grade: Optional[Decimal]
    """Overall PSA grade as a Decimal, or None for non-numeric outcomes."""

    grade_label: str
    """Original grade string exactly as it appears ('PSA 10', 'Authentic', etc.)."""

    centering_subgrade: Optional[Decimal] = None
    """PSA Centering sub-grade; None when not exposed by PSA."""

    corners_subgrade: Optional[Decimal] = None
    """PSA Corners sub-grade; None when not exposed by PSA."""

    edges_subgrade: Optional[Decimal] = None
    """PSA Edges sub-grade; None when not exposed by PSA."""

    surface_subgrade: Optional[Decimal] = None
    """PSA Surface sub-grade; None when not exposed by PSA."""

    qualifiers: list[str] = field(default_factory=list)
    """PSA qualifier codes (OC, PD, ST, MC …) as short uppercase strings."""

    image_url: Optional[str] = None
    """Front-of-slab image URL if present on the cert page."""

    raw_html_sha256: str = ""
    """Hex SHA-256 of the raw HTML bytes for change detection."""

    fetched_at: Optional[datetime] = None
    """UTC timestamp when the page was fetched."""

    source_version: str = "psa_scraper_v1"
    """Scraper version tag for provenance."""

    def has_subgrades(self) -> bool:
        """Return True if at least one subgrade was parsed."""
        return any(
            v is not None
            for v in (
                self.centering_subgrade,
                self.corners_subgrade,
                self.edges_subgrade,
                self.surface_subgrade,
            )
        )

    def to_training_sample_row(self) -> dict:
        """Serialize to a dict matching ``grading_training_sample`` columns.

        The caller is responsible for the DB upsert; this method only builds
        the column mapping.
        """
        subgrades = None
        if self.has_subgrades():
            subgrades = {
                k: float(v)
                for k, v in {
                    "centering": self.centering_subgrade,
                    "corners": self.corners_subgrade,
                    "edges": self.edges_subgrade,
                    "surface": self.surface_subgrade,
                }.items()
                if v is not None
            }

        raw_metadata: dict = {
            "cert_number": self.cert_number,
            "cert_url": self.cert_url,
            "qualifiers": self.qualifiers,
            "raw_html_sha256": self.raw_html_sha256,
            "fetched_at": self.fetched_at.isoformat() if self.fetched_at else None,
            "source_version": self.source_version,
            "grade_label": self.grade_label,
        }
        for optional_key, value in {
            "card_name": self.card_name,
            "set_name": self.set_name,
            "year": self.year,
            "card_number": self.card_number,
        }.items():
            if value is not None:
                raw_metadata[optional_key] = value

        images: dict = {}
        if self.image_url:
            images["front"] = self.image_url

        return {
            "source": "psa_cert",
            "source_id": self.cert_number,
            "source_url": self.cert_url,
            "printing_id": None,
            "grade_company": "PSA",
            "grade": float(self.grade) if self.grade is not None else None,
            "subgrades": subgrades,
            "images": images,
            "parse_confidence": 1.0,
            "raw_metadata": raw_metadata,
        }
