# Stage 07 — Grading rules

Multi-shot capture → centering (geometric) + corners/edges/surface (ML)
→ aggregate → confidence band. Calibrated to PSA outcomes.

## Required reading

- `PROJECT.md` § 12 (Grading Pipeline)
- `context/data-model.md` (`grading_submission`)
- `context/legal-and-brand.md` (PSA scraping ToS guardrails)

## Hard rules

- **Predictions are confidence bands, not single numbers.** UI surface
  is "Looks like a PSA 8.5–9 candidate, ~72% confidence", never "9.0".
- **Centering is geometric, deterministic.** No ML for centering. The
  measurement uses the front+back captures and standard PSA tolerance
  ratios. Test against known examples.
- **Models are small and on-device where possible.** Per-subgrade CNNs
  exported to TFLite. Inference ≤ 200ms per subgrade on a mid-range
  phone.
- **Training data hygiene.** Every training image has provenance
  metadata (source URL or community submission user_id, capture
  conditions). Stored in `apps/api-python/grading/data/` with manifest
  files, never raw blobs.
- **PSA scraper guardrails.** Rate limit ≤1 req/sec, contactable
  User-Agent, exponential backoff on 4xx/5xx, immediate halt on
  ToS-style block (cloudflare challenge, 403 with text "scraping").
- **Calibration target enforced.** ±1 of PSA actual ≥80% on held-out
  set. The aggregate task fails if it doesn't hit.
- **Community flywheel is paid-only.** Free users can predict but
  can't contribute training data via slab uploads. T-PB-ENTITLEMENTS
  enforces.

## Conventions specific to this stage

- Subgrade models are independent — no shared backbone in v1. Easier
  to iterate per subgrade.
- Each subgrade module exposes `train.py`, `eval.py`, `export.py`. The
  `Makefile` orchestrates.
- Model artifacts versioned in R2 (`models/grading/{subgrade}/{version}/`).
  Mobile fetches via metadata endpoint.
- Capture flow rejects blurry frames using a Laplacian variance
  threshold; the value is tuned per device class if needed.

## Common pitfalls

- "Centering" by source: many listings have only a front photo, so
  back-based centering may not be available — handle gracefully.
- Surface raking light is hard for users to capture; the UX guides them
  with a phone-tilt indicator.
- Mixing PSA and BGS slabs in training: BGS sub-grades aren't directly
  comparable to PSA's holistic grade. Keep separate label streams; for
  v1 we calibrate to PSA.

## Done when

- A user can complete the multi-shot capture flow on iOS and Android.
- Each subgrade model is trained, validated, exported, and runs
  on-device.
- Aggregate calibration meets the ±1/80% target on the held-out set.
- A grading submission saves to the DB with predicted JSON.
- Paid users can later upload an actual slab photo, which lands in
  `actual` and unlocks training-data credit.
