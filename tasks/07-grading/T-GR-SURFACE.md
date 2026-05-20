# T-GR-SURFACE — Surface subgrade model (training + inference)

**Stage:** 07-grading
**Agent role:** ml
**Effort:** L
**Status:** in_progress

## Hard dependencies

- T-GR-DATA-PSA (must be merged — PSA cert scraper + `grading_training_sample` rows)
- T-GR-DATA-EBAY (must be merged — eBay sold-listing rows)
- T-GR-DATA-AUCTIONS (must be merged — auction lot rows)

## Soft dependencies

- T-GR-CORNERS (can race; identical module layout, ml_common consumer pattern, and
  TS factory contract — used as the direct implementation template)
- T-GR-EDGES (parallel-safe; disjoint owns_paths)
- T-GR-CENTERING (parallel-safe; disjoint owns_paths)

## Required reading

- `PROJECT.md` § 12 (Grading Pipeline) — Surface = ML model on raking-light shot + flat
  front shot.  Raking light captures whitening, scratches, indentations, print defects.
- `rules/07-grading.md` — Stage conventions; confidence-band contract; model size
  constraints.
- `apps/api-python/grading/corners/` — direct implementation template (copy pattern).
- `apps/api-python/grading/ml_common/` — shared infra (do NOT modify).
- `apps/mobile/src/grading/corners/` — TS factory template.
- `apps/mobile/src/grading/capture/types.ts` — v1 session ships `frontFull` + `backFull`
  only (4-shot session); raking-light shot absent until #FU-31 lands.

## Goal

Ship the Surface sub-grade model — the trickiest of the four because it covers
the widest range of defects (scratches, indentations, whitening, print defects) and
its gold-standard input (a raking-light shot that reveals surface topology) was not
shipped by T-GR-CAPTURE-UX v1 (see #FU-31 / T-GR-CAPTURE-FULL-SCHEMA).

v1 ships using the two full-face shots already in the capture session (`frontFull` +
`backFull`).  The `SurfaceRequest` is designed to be raking-light-optional so that
when #FU-31 lands the inference engine silently upgrades to the 3-shot path with no
breaking contract change.  The seam is documented throughout the code.

The Python module follows the T-GR-CORNERS pattern exactly: same module layout,
same `ml_common/` consumer pattern, same training / eval / export pipeline.  The
TypeScript factory mirrors `CornersService` exactly.

## Deliverables

### Python — `apps/api-python/grading/surface/`

| File | Description |
|---|---|
| `__init__.py` | Public barrel: re-exports `SurfaceInferenceEngine`, `SurfaceModel`, `SurfacePrediction`, `SurfaceRequest`, `SurfaceShotPrediction` |
| `py.typed` | PEP 561 marker |
| `types.py` | `SurfaceRequest` (frontFullUri + backFullUri + optional rakingLightUri) · `SurfaceShotPrediction` · `SurfacePrediction` · `NUM_SURFACE_SHOTS_V1 = 2` · `NUM_SURFACE_SHOTS_WITH_RAKING = 3` · `SURFACE_SHOT_LABELS` |
| `dataset.py` | `SurfaceMergedDataLoader` (reads `surface` key from subgrades; stores into `corners_score` field) · `SurfaceDataset` (2-shot feature vector; raking-light-aware) |
| `model.py` | `SurfaceModel` numpy linear regression placeholder; torch MobileNetV3 arch documented behind `SURFACE_USE_TORCH=1` |
| `train.py` | `train_surface_model()` entry point |
| `eval.py` | `eval_surface_model()` entry point |
| `export.py` | `export_surface_model()` wraps `ml_common.model_export.export_to_onnx` |
| `infer.py` | `SurfaceInferenceEngine` wraps ONNX session; raking-light-optional predict path |
| `Makefile` | `train` · `eval` · `export` · `test` · `clean` |
| `tests/__init__.py` | Empty |
| `tests/conftest.py` | Shared fixtures + synthetic row builders |
| `tests/test_dataset.py` | ≥10 tests |
| `tests/test_model.py` | ≥10 tests |
| `tests/test_train.py` | ≥8 tests |
| `tests/test_eval.py` | ≥7 tests |
| `tests/test_export.py` | ≥7 tests |
| `tests/test_infer.py` | ≥8 tests |

### TypeScript — `apps/mobile/src/grading/surface/`

| File | Description |
|---|---|
| `types.ts` | `SurfaceRequest` · `SurfaceResult` · `SurfaceShotBand` · `SurfaceService` · `SurfaceServiceError` · `SurfaceServiceErrorReason` · `isSurfaceError` type guard |
| `surface-service.ts` | `createSurfaceService(impl?)` factory · `defaultSurfaceService` singleton (not_implemented) |
| `index.ts` | Public barrel |
| `__tests__/surface-service.test.ts` | ≥15 vitest tests |

## Acceptance criteria

1. `pytest -q apps/api-python/grading/surface/tests/` passes with ≥ 50 collected tests,
   zero failures, zero errors.
2. `pnpm vitest run apps/mobile/src/grading/surface/` passes with ≥ 15 tests, zero
   failures.
3. `pnpm build` and `pnpm typecheck` produce zero errors.
4. `SurfaceRequest` has `front_full_uri: str`, `back_full_uri: str`, and
   `raking_light_uri: Optional[str] = None` — raking-light is optional, not required.
5. `SurfacePrediction` has `per_shot: list[SurfaceShotPrediction]`, `aggregate:
   ConfidenceBand`, `model_version: str`.
6. `SurfaceInferenceEngine.predict_from_request` produces a `SurfacePrediction` with
   `len(per_shot) == 2` for a v1 request (no raking light) and 3 for a raking-light
   request.
7. `SurfaceDataset.build_arrays()` returns `X.shape == (N, input_dim)` where
   `input_dim == NUM_SURFACE_SHOTS_V1 * patch_size * patch_size * 3` for v1.
8. `export_surface_model` writes a valid ONNX file (checked via `onnx.checker`).
9. TS `createSurfaceService()` with no args returns a service whose `grade()` returns
   `isSurfaceError(result) == true` with `reason == 'not_implemented'`.
10. TS `createSurfaceService(mockImpl)` uses the injected implementation.
11. `SurfaceRequest` TS type has `frontFullUri`, `backFullUri`, and optional
    `rakingLightUri?: string` — the raking-light seam is documented in a JSDoc comment
    referencing #FU-31.
12. `defaultSurfaceService` singleton is exported from `index.ts`.

## Design decisions & seam documentation

### Input shots

- **v1 (ships now):** `frontFull` + `backFull` from the 4-shot capture session.
  Feature vector: `NUM_SURFACE_SHOTS_V1 * patch_size * patch_size * 3` (= 384 for
  CI smoke test with patch_size=8).
- **#FU-31 (T-GR-CAPTURE-FULL-SCHEMA):** Adds `rakingLight` as a 5th capture step.
  When present, `SurfaceInferenceEngine` switches to the 3-shot path transparently.
  The ONNX model would need to be retrained; `export_surface_model` accepts `num_shots`
  to allow this.  The current numpy placeholder always exports with `NUM_SURFACE_SHOTS_V1`.

### Why surface is trickier than corners/edges

Corners and edges have crisp geometric signals (wear lines, fraying).  Surface defects
span a wider range — whitening, scratches, print indentations, foil dimpling — and
their visibility depends heavily on lighting angle.  The raking-light shot was
specifically called out in PROJECT.md § 12 as the gold-standard input for surface.
Until #FU-31 ships, v1 accuracy for surface will be lower than for corners/edges;
the confidence band communicates this uncertainty.

### Aggregate rule

Surface aggregate = average of per-shot predictions (unlike corners which uses the
weakest-corner rule).  Rationale: surface defects visible in one shot may not be
visible in another (back may be clean while front has whitening); averaging gives a
holistic view.  This is consistent with how PSA graders assess surface.

### Data loader

`SurfaceMergedDataLoader` in `surface/dataset.py` reads `subgrades->>'surface'` (PSA)
and `parsed_sub_grades->>'surface'` (eBay + auction) from raw rows.  It populates
`LabelledGradingSample.corners_score` with the surface score — this is the "training
label" field.  The naming mismatch is a known ml_common limitation documented in
#FU-44 (Rename `corners_score` to `subgrade_score` in `LabelledGradingSample`).

### Production CNN architecture (SURFACE_USE_TORCH=1)

Two full-card images (frontFull + backFull) each through MobileNetV3-small backbone
(ImageNet pre-trained).  Each image: 224×224 RGB.  Logits from both streams are
average-pooled → linear(last_channel, 64) → Hardswish → linear(64, 1) → clamp
[1.0, 10.0].  When raking-light (#FU-31) is present, a third stream is added and
the pool covers all three.

## New follow-up tasks

- **#FU-44** — Rename `corners_score` to `subgrade_score` in `LabelledGradingSample`
  (ml_common). All three sub-grade modules (corners/edges/surface) re-use the corners
  field as a generic label slot; this is confusing.  Blocked on T-GR-CORNERS + T-GR-EDGES
  + T-GR-SURFACE all merged (coordinated rename).
- **#FU-45** — Train surface model on real scraped data once T-GR-DATA-PSA ingestion is
  complete and image ingest (#FU-39) has landed.
- **#FU-46** — Wire SurfaceService to the deployed Python gRPC/REST endpoint once
  T-GR-SERVING lands. Currently returns `not_implemented`.

## Open questions

- None requiring escalation. The raking-light limitation is a known design seam
  (#FU-31) and is handled gracefully in the contract.

## Branch & PR

- Branch: `agent/T-GR-SURFACE`
- PR title: `feat(grading): T-GR-SURFACE — surface subgrade model (training + inference)`

## Notes from execution

Elaborated and implemented by sub-agent T-GR-SURFACE in worktree
`binderly-wt-T-GR-SURFACE`. Template: T-GR-CORNERS (direct copy of module layout).
Key surface-specific deltas: 2-shot input (frontFull + backFull), raking-light-optional
third input slot, average-pool aggregate (vs. weakest-corner), `SurfaceMergedDataLoader`
reading `surface` key from subgrades.
