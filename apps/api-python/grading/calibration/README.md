# `grading.calibration` — Cross-company grade calibration (scaffold, #FU-56)

Different grading companies grade on different, differently-strict scales. To
compare or aggregate graded outcomes from PSA / BGS / CGC / SGC in one corpus
(the community flywheel, cross-company pricing), each company+grade is mapped
onto a single **normalised internal scale**.

| | |
|---|---|
| **Module path** | `apps/api-python/grading/calibration/` |
| **Internal scale** | PSA-equivalent `[1.0, 10.0]` (PSA is the anchor) |
| **Status** | **Scaffold** — placeholder linear map, not a trained calibration |
| **Source of truth** | This Python module |
| **Follow-up** | #FU-59 (learned calibration); see Q-023 |

## Placeholder mapping table

The v0 map is a per-company affine transform
`normalized = clamp(slope · raw + intercept, 1, 10)`, applied via numpy
(`calibration.py`). Constants are **heuristic placeholders** from rough market
cross-grade lore, NOT a data fit:

| Company | slope | intercept | confidence | rationale |
|---------|-------|-----------|------------|-----------|
| PSA  | 1.0 | 0.0 | 1.0 | Anchor — defines the scale (identity). |
| BGS  | 1.0 | +0.3 | 0.5 | Stricter at the top (BGS 9.5 ≈ PSA 10). |
| CGC  | 1.0 | +0.1 | 0.5 | Tracks PSA with a small upward nudge. |
| SGC  | 1.0 | +0.2 | 0.5 | Slightly stricter than PSA mid-scale. |
| OTHER| 1.0 | 0.0 | 0.2 | Unknown house — identity, low confidence. |

## Replacing the placeholder (#FU-59)

The affine map is expressed as a dot product so a learned weight vector drops in
without changing call sites. Once the flywheel accumulates labelled
cross-company pairs — the same physical card graded by ≥2 companies, or strong
card-identity matches via #FU-40's printing match — fit per-company (or
per-company-per-grade-tier) constants by regressing realised market value /
agreed identity, inject the fitted table into `GradeCalibrator`, and bump
`CALIBRATION_VERSION`. Open question tracked as **Q-023**.
