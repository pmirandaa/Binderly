# T-GR-AGGREGATE — Subgrade aggregation + calibration to PSA + confidence band

**Stage:** 07-grading
**Agent role:** ml
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-GR-CENTERING (must be merged — geometric centering with `CenteringResult.grade_hint`)
- T-GR-CORNERS (must be merged — `CornersPrediction.aggregate: ConfidenceBand`)
- T-GR-EDGES (must be merged — `EdgesPrediction.aggregate: ConfidenceBand`)
- T-GR-SURFACE (must be merged — `SurfacePrediction.aggregate: ConfidenceBand`)

## Soft dependencies

- T-GR-CORNERS / T-GR-EDGES / T-GR-SURFACE share the same numpy-linear CI pattern;
  this task copies that pattern for the aggregator (priors-as-weights), then
  documents the learned-weights upgrade path behind `AGGREGATE_USE_TORCH=1`.
- #FU-44 (ml_common subgrade_score rename) — orthogonal cleanup; this task does
  NOT depend on it. We only consume `ConfidenceBand` from `ml_common`, which is
  stable.

## Required reading

- `PROJECT.md` § 12 (Grading Pipeline) — overall grade aggregation + ±1/80% PSA
  calibration target + confidence-band UX surface.
- `rules/07-grading.md` — confidence-band contract; calibration target enforced.
- `apps/api-python/grading/corners/` — direct implementation template.
- `apps/api-python/grading/ml_common/` — shared `ConfidenceBand`, `eval_metrics`,
  `data_loader.MergedDataLoader`. Read-only.
- `apps/api-python/grading/centering/` — `CenteringResult.grade_hint` string output
  (NOT a `ConfidenceBand` — needs a mapper).
- `apps/mobile/src/grading/corners/` — TS factory + service-error template.

## Goal

Build the final stage of the grading pipeline: fuse the four sub-grade outputs
into a single PSA-calibrated overall grade (1.0–10.0 in 0.5 ticks) and a
discrete confidence band (`'low' | 'medium' | 'high'`) so the UI can render
"Looks like a PSA 8.5–9 candidate" per `rules/07-grading.md`. The Python module
is authoritative; the TypeScript module ships a typed contract + `not_implemented`
default service mirroring the pattern established by T-GR-CORNERS / T-GR-EDGES /
T-GR-SURFACE.

PSA grades on 0.5 ticks (PROJECT.md § 12); the aggregator rounds the weighted
sum to the nearest 0.5 in `[1.0, 10.0]`. The default weights are priors grounded
in PSA's documented criteria (corners 0.35, centering 0.25, edges 0.25, surface
0.15); they are constructor-configurable so a learned-weights upgrade path is
already wired (see "Production upgrade path").

## Deliverables

### Python — `apps/api-python/grading/aggregate/`

| File | Description |
|---|---|
| `__init__.py` | Public barrel: re-exports `AggregatedGrade`, `AggregateWeights`, `SubGradeInputs`, `aggregate_subgrades`, `infer`, `compute_confidence_band_label`, default-weights constant. |
| `py.typed` | PEP 561 marker. |
| `types.py` | `SubGradeInputs` (centering / corners / edges / surface as floats + per-sub-grade confidence floats) · `AggregatedGrade` (overall_grade, psa_grade, confidence_band, sub_grades, calibration_notes) · `ConfidenceBandLabel = Literal['low','medium','high']` · `AggregateWeights` (4 floats, sum-to-1 validation, configurable). |
| `model.py` | `LinearWeightedAggregator` (numpy linear-weighted-sum aggregator). `priors` constant. Constructor takes `AggregateWeights`. `forward` returns the weighted raw score; `aggregate` applies PSA rounding. Documents the `AGGREGATE_USE_TORCH=1` learned-calibration upgrade path. |
| `service.py` | `aggregate_subgrades(inputs, weights=None) -> AggregatedGrade` (pure workhorse) · `infer(centering, corners, edges, surface, weights=None) -> AggregatedGrade` (adapter taking the 4 upstream prediction dataclasses) · `compute_confidence_band_label(...)` (3-band classifier). |
| `eval.py` | `eval_aggregate_model(...)` → MAE / RMSE / ±1-grade-accuracy against PSA-graded ground truth via `ml_common.data_loader.MergedDataLoader`. Reuses `ml_common.eval_metrics`. CLI entry point. |
| `export.py` | `export_aggregate_model(...)` writes a Gemm ONNX for the linear weights. Documents the torch upgrade path that exports a small dense regression head. |
| `Makefile` | `train` · `eval` · `export` · `test` · `clean` mirroring `corners/Makefile`. |
| `README.md` | Priors source citation · calibration rationale (0.5 ticks) · 3-band classifier heuristic · `AGGREGATE_USE_TORCH=1` learned-weights upgrade path · synthetic-data eval entry point. |
| `tests/__init__.py` | Empty. |
| `tests/conftest.py` | Shared fixtures: synthetic 10-sample fixture, default-weights, prediction-builder helpers. |
| `tests/test_types.py` | `SubGradeInputs`, `AggregatedGrade`, `AggregateWeights` invariants (≥6 tests). |
| `tests/test_model.py` | Linear weighted sum math, weights normalisation, default priors (≥7 tests). |
| `tests/test_service.py` | `aggregate_subgrades` + `infer` adapter + confidence-band classifier (≥15 tests including boundary cases). |
| `tests/test_export.py` | ONNX export round-trip via `onnx.checker` + `onnxruntime` inference parity (≥6 tests). |
| `tests/test_eval.py` | MAE / RMSE / ±1 accuracy against synthetic PSA-labelled rows (≥6 tests). |

### TypeScript — `apps/mobile/src/grading/aggregate/`

| File | Description |
|---|---|
| `types.ts` | `AggregateRequest` (4 upstream prediction objects) · `AggregateResult` (overallGrade, psaGrade, confidenceBand, subGrades, calibrationNotes) · `AggregateService` interface · `AggregateServiceError` · `AggregateServiceErrorReason` · `isAggregateError` type guard · `ConfidenceBandLabel`. |
| `errors.ts` | Re-exports `AggregateServiceError` + `isAggregateError` for the explicit-import callsite. |
| `service.ts` | `createAggregateService(impl?)` factory · `defaultAggregateService` singleton (`not_implemented`). |
| `index.ts` | Public barrel. |
| `__tests__/aggregate-service.test.ts` | ≥20 vitest tests (factory, mock injection, error guard, shape invariants, confidence-band literal pinning). |

## Acceptance criteria

1. `pytest -q apps/api-python/grading/aggregate/tests/` passes with ≥ 40
   collected tests, zero failures, zero errors, **without `torch` installed**.
2. `pnpm vitest run apps/mobile/src/grading/aggregate/` passes with ≥ 20 tests.
3. `pnpm lint`, `pnpm typecheck`, `pnpm build` all green locally.
4. `AggregatedGrade.psa_grade` is always one of
   `{1.0, 1.5, 2.0, …, 9.5, 10.0}` for any valid input; capped at 10.0; floored
   at 1.0; rounding is to-nearest 0.5 (banker's rounding tie-break).
5. `AggregatedGrade.confidence_band` is one of `{'low','medium','high'}`:
   - `'high'` when all 4 sub-grade confidences map to "high" AND max-min spread
     across sub-grade scores < 1.0 PSA point;
   - `'low'` when any sub-grade confidence maps to "low" OR max-min spread
     >= 2.0 PSA points (significant disagreement);
   - `'medium'` otherwise.
   The float→categorical mapping uses thresholds documented in `service.py`:
   `confidence >= 0.66 → high`, `>= 0.33 → medium`, else `low` (see Q-018 below).
6. `AggregatedGrade.calibration_notes` includes the per-sub-grade categorical
   confidences and the score spread for debugging.
7. Default weights in `AggregateWeights` are
   `{ centering: 0.25, corners: 0.35, edges: 0.25, surface: 0.15 }` (priors,
   documented as such in a docstring) and are constructor-configurable.
8. `AggregateWeights.__post_init__` validates that the four weights sum to
   `1.0 ± 1e-6` and that each is in `[0.0, 1.0]`.
9. `infer(centering_result, corners_pred, edges_pred, surface_pred)` adapts the
   four upstream prediction objects to `SubGradeInputs` correctly. Centering is
   mapped from `CenteringResult.grade_hint` (`'10' → 10.0`, `'9' → 9.0`, …,
   `'worse' → 4.0`, `'unknown' → 5.0`) with `CenteringResult.low_confidence`
   driving the centering confidence categorical (`True → 'low'`, else `'high'`).
   Corners / edges / surface read `prediction.aggregate.value` and
   `prediction.aggregate.confidence`.
10. `export_aggregate_model` produces an ONNX file that passes
    `onnx.checker.check_model` AND that, when loaded via `onnxruntime`, returns
    the same weighted-sum (pre-rounding) as the numpy `forward` to within 1e-5.
11. TS `createAggregateService()` returns a service whose `aggregate()` resolves
    to `isAggregateError(result) == true` with `reason == 'not_implemented'`.
12. TS `createAggregateService(mockImpl)` uses the injected implementation.
13. Q-018 entry appended to `open-questions.md` documenting the centering /
    confidence-band shape decisions and the chosen float→categorical thresholds.

## Design decisions

### Confidence-band categorical mapping (Q-018)

The upstream sub-grade modules emit a float `ConfidenceBand.confidence ∈ [0,1]`,
not a 3-band categorical. The task brief asked for a 3-band classifier; rather
than escalate-and-stop, we document the chosen thresholds (Q-018):

- `confidence >= 0.66 → 'high'`
- `confidence >= 0.33 → 'medium'`
- `else → 'low'`

The thresholds are reproduced from rules/07-grading.md's "Predictions are
confidence bands, not single numbers" requirement. They are configurable via
`compute_confidence_band_label(value, high_threshold=0.66, low_threshold=0.33)`
so a future calibration pass can re-tune them without breaking the contract.

### Centering input adapter

`CenteringResult.grade_hint` is a string enum (`'10'..'7'|'worse'|'unknown'`)
not a `ConfidenceBand`. The adapter maps:

| `grade_hint` | numeric score | confidence |
|---|---|---|
| `'10'` | 10.0 | 1.0 if `low_confidence == False` else 0.3 |
| `'9'`  | 9.0  | same |
| `'8'`  | 8.0  | same |
| `'7'`  | 7.0  | same |
| `'worse'`   | 4.0 | same |
| `'unknown'` | 5.0 | 0.0 (forces categorical 'low') |

The mapping treats centering as a deterministic geometric measurement (high
confidence by default unless flagged) — consistent with PROJECT.md § 12.

### Priors source

Defaults `centering 0.25 / corners 0.35 / edges 0.25 / surface 0.15` reflect
PSA's publicly documented grading criteria where corners + centering are the
most weighted factors. PROJECT.md § 12 does not pin explicit weights, so these
are documented as priors in `model.py` and are constructor-configurable.

### PSA rounding

Weighted raw score → `round(raw * 2) / 2` → clamp to `[1.0, 10.0]`. PSA grades
on 0.5 ticks (PROJECT.md § 12). Half-tick rounding uses Python's banker's
rounding for determinism on `.25` / `.75` boundaries — documented in `model.py`.

### Spread-based confidence override

The confidence band is high only if all 4 sub-grade categorical confidences are
'high' **and** the max-min spread across sub-grade scores is < 1.0 PSA point.
This catches the case where every model is internally confident but they
disagree with each other (e.g. centering says 10, corners says 7 — net result
should communicate uncertainty to the user, not bury it). Spread `>= 2.0`
forces 'low' regardless of the per-sub-grade confidences.

### Production upgrade path (`AGGREGATE_USE_TORCH=1`)

The v1 numpy linear-weighted-sum is a hand-tuned prior. Once PSA-labelled data
lands at scale (post-#FU-40 + community flywheel), a small dense regression
head (4 inputs → 8 hidden → Hardswish → 1 output, clamped to [1.0,10.0]) can
be trained against ground truth. The `AGGREGATE_USE_TORCH=1` env gate mirrors
the `CORNERS_USE_TORCH=1` / `EDGES_USE_TORCH=1` / `SURFACE_USE_TORCH=1` pattern
so the swap is a localised refactor with no API change. Logged as a follow-up
(#FU-48).

### Surface 2-shot vs raking-light input

`SurfacePrediction.aggregate: ConfidenceBand` already collapses the per-shot
predictions into a single value (avg across front+back). Whether the
surface module was given a raking-light shot or not is opaque to the
aggregator — we read `.aggregate` regardless. The future raking-light upgrade
(#FU-31) does not require an aggregator API change.

## Out of scope

- Real PSA-labelled training of the aggregator (blocked on #FU-40 + community
  flywheel; logged as #FU-48).
- Wiring `AggregateService` to a deployed Python endpoint (defers to T-GR-SERVING).
- On-device ONNX inference via `onnxruntime-react-native` (parallel concern;
  defers to T-GR-SERVING / #FU-43 family).
- Touching `ml_common/` (architectural cleanup is #FU-44, parallel iter
  31 work).

## New follow-up tasks

- **#FU-48** — Learned-weights upgrade for `T-GR-AGGREGATE`. Once labelled
  PSA-graded sessions are available, train a small dense regression head
  against the 4-sub-grade input. Constructor-configurable weights mean the
  swap is a localised refactor (see "Production upgrade path" above).

## Open questions

- **Q-018** — Confidence-band categorical thresholds + centering grade-hint
  mapping. Documented assumptions chosen; logged so we can revisit once real
  calibration data lands.

## Branch & PR

- Branch: `agent/T-GR-AGGREGATE`
- PR title: `feat(grading): T-GR-AGGREGATE — overall-grade aggregation + PSA calibration + confidence band`

## Notes from execution

Elaborated and implemented by sub-agent T-GR-AGGREGATE in worktree
`binderly-wt-T-GR-AGGREGATE`. Template: T-GR-SURFACE (closest analogue —
also a pure-prediction module, no training data dependency, numpy-linear CI
path). Key aggregator-specific deltas: 4-input weighted-sum (vs. patch-based
feature vector), PSA 0.5-tick rounding (vs. clamp-only), 3-band categorical
output (vs. float ConfidenceBand), centering adapter mapping string grade_hint
→ float score.
