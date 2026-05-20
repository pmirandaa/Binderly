# T-GR-CORNERS — Corners subgrade model (training + inference)

**Stage:** 07-grading
**Agent role:** ml
**Effort:** L
**Status:** in_progress

## Hard dependencies
- T-GR-DATA-PSA (merged)
- T-GR-DATA-EBAY (merged)
- T-GR-DATA-AUCTIONS (merged)

## Soft dependencies
- T-GR-CENTERING (parallel-safe; follow the Python↔TS contract pattern)

## Required reading
- `PROJECT.md` § 12 (Grading Pipeline)
- `rules/07-grading.md`
- `apps/api-python/grading/centering/` — reference Python module
- `apps/mobile/src/grading/centering/` — reference TS module
- `packages/db/src/schema/grading.ts` — `grading_training_sample` + `ebay_graded_listing_observation` tables
- `packages/db/src/schema/auction_lot_observation.ts` — auction lot table

## Goal

Ship the **Corners sub-grade model** for PSA-style BGS grading prediction. Corners
are one of four sub-grades (alongside centering, edges, surface) that feed into
the aggregate grade. This task is the **pattern-establisher** for the grading ML
sub-grade trio: the `ml_common/` shared infrastructure, data loader contracts,
training loop shape, eval methodology, inference contract, and Python↔TypeScript
seam established here become the template consumed by T-GR-EDGES and T-GR-SURFACE
in the next iteration.

The deliverable shape is a working **training pipeline** (end-to-end, runs on
synthetic fixtures without crashing), an **inference contract** (TypeScript side
returns `not_implemented` until a real trained model file exists), the model file
path / cache lookup hook, and a comprehensive test suite covering all layers.

## Architecture decisions

### Model architecture
**MobileNetV3-small backbone + 1-d regression head** (planned for production).

Input: 4 corner-crop patches per card, each 64×64×3 pixels (RGB). The model
processes each patch independently through a shared MobileNetV3-small trunk
(pre-trained on ImageNet for transfer learning), pools to a 1-d feature vector,
aggregates the 4 patch features by averaging, then applies a linear regression
head mapping to a scalar in [1.0, 10.0].

**CI / smoke-test implementation**: A numpy-only linear regression placeholder
replaces the CNN. Produces identical ONNX round-trips. Real training requires
the `ml` optional-dep group (`torch==2.7.0`, `torchvision==0.22.0`); documented
and gated behind the `CORNERS_USE_TORCH=1` env flag.

### Loss function
MSE on the raw PSA score (1.0–10.0). MAE is the primary eval metric (more
interpretable for graders; PSA scores in 0.5 increments). ±1-grade accuracy
(PSA's calibration target: ≥80% of predictions within ±1 of actual grade) is
the pass/fail threshold for real model validation.

### ONNX export
Models are exported to ONNX opset 17. Input shape: `[batch, 4, 64, 64, 3]`
(4 patches per card). Inference via `onnxruntime`. Numpy-only export uses the
`onnx` package to build a minimal `Gemm` graph; production export uses
`torch.onnx.export`.

### Confidence band
Derived from the mean absolute residual on the calibration split: a lightweight
estimate of model uncertainty. Every sub-grade returns `{value: float, confidence: float}`
where `confidence ∈ [0.0, 1.0]`. T-GR-AGGREGATE consumes this uniform shape.

## Cross-package touch authorisation

This task creates `apps/api-python/grading/ml_common/` which is **outside the
literal `owns_paths`** but is explicitly justified:

- `ml_common/` is shared infrastructure consumed by T-GR-EDGES + T-GR-SURFACE
  in the next iteration. Placing it in each sub-grade would duplicate the code.
- No other in-progress task owns or touches `grading/ml_common/`.
- The orchestrator brief authorises this creation and documents it explicitly.

## Deliverables

### `apps/api-python/grading/ml_common/` — shared ML infrastructure

| File | Description |
|------|-------------|
| `__init__.py` | Package entry point; public API surface |
| `types.py` | `LabelledGradingSample`, `SubgradePrediction`, `ConfidenceBand`, `DataLoaderProtocol`, `ModelProtocol`, `TrainingConfig`, `TrainingResult` |
| `data_loader.py` | `PSADataLoader`, `EbayDataLoader`, `AuctionDataLoader`, `MergedDataLoader` (normalises all 3 table shapes into `LabelledGradingSample`) |
| `image_loader.py` | `ImageLoader` — mock-by-default (deterministic 256×256×3 arrays seeded from URL SHA-256); live mode gated behind `CORNERS_LIVE_IMAGES=1` |
| `training_loop.py` | Generic `train_one_epoch` + `TrainingLoop`; parameterised on model + loss + dataset; numpy-based for CI |
| `eval_metrics.py` | `mae`, `rmse`, `grade_accuracy` (±1 PSA tolerance), `confusion_matrix_grades` |
| `model_export.py` | `export_to_onnx`, `load_onnx_session`; numpy-linear path uses `onnx` package directly |
| `confidence.py` | `compute_confidence_band` from residual mean |
| `tests/__init__.py` | empty |
| `tests/test_types.py` | Dataclass + protocol tests |
| `tests/test_data_loader.py` | Per-source + merged loader tests |
| `tests/test_image_loader.py` | Mock + env-gated live tests |
| `tests/test_training_loop.py` | One-epoch smoke test on synthetic set |
| `tests/test_eval_metrics.py` | MAE, RMSE, accuracy, confusion matrix tests |
| `tests/test_model_export.py` | ONNX export round-trip test |
| `tests/test_confidence.py` | Confidence band tests |

### `apps/api-python/grading/corners/` — corners model + pipeline

| File | Description |
|------|-------------|
| `__init__.py` | Package entry point |
| `types.py` | `CornersRequest`, `CornersPrediction`, `CornersSubgrade` |
| `model.py` | `CornersModel` (numpy linear placeholder + torch upgrade path documented) |
| `dataset.py` | `CornersDataset` — builds from `List[LabelledGradingSample]` using `ImageLoader` |
| `train.py` | `train_corners_model(config)` entry point + `__main__` CLI |
| `eval.py` | `eval_corners_model(model_path, dataset)` entry point + `__main__` CLI |
| `export.py` | `export_corners_model(model, output_path)` entry point + `__main__` CLI |
| `infer.py` | `CornersInferenceEngine` — wraps onnxruntime session; `predict(images)` → `CornersPrediction` |
| `Makefile` | `train` / `eval` / `export` targets |
| `tests/__init__.py` | empty |
| `tests/conftest.py` | Shared synthetic fixtures |
| `tests/test_model.py` | Forward pass + gradient tests |
| `tests/test_dataset.py` | Dataset construction + length + item tests |
| `tests/test_train.py` | Training smoke (1 epoch, synthetic set) |
| `tests/test_eval.py` | Eval on held-out synthetic set |
| `tests/test_export.py` | ONNX export + round-trip inference test |
| `tests/test_infer.py` | `CornersInferenceEngine` tests |

### `apps/mobile/src/grading/corners/` — TypeScript contract

| File | Description |
|------|-------------|
| `types.ts` | `CornersRequest`, `CornersResult`, `CornersService`, `CornersServiceError`, `CornersServiceErrorReason`, `isCornerError` type guard |
| `corners-service.ts` | `createCornersService(impl?)` factory + `defaultCornersService` singleton; default returns `not_implemented` |
| `index.ts` | Public barrel export |
| `__tests__/corners-service.test.ts` | ≥15 tests: factory, `not_implemented` contract, injected mock, request shape pinning |

## Acceptance criteria

- [ ] `apps/api-python/grading/ml_common/` exists with all files listed above
- [ ] `apps/api-python/grading/corners/` exists with all files listed above  
- [ ] `apps/mobile/src/grading/corners/` exists with all files listed above
- [ ] `pytest -q apps/api-python/grading/ml_common/tests/ apps/api-python/grading/corners/tests/` passes with ≥30 tests
- [ ] `pnpm test --filter @binderly/mobile` passes with ≥15 new corners tests
- [ ] Training loop smoke (1 epoch on 25 synthetic samples) completes without raising
- [ ] ONNX export round-trip: exported model → onnxruntime inference → output within 1e-5 of direct model output
- [ ] `CornersService` factory matches the `CenteringService` shape exactly (factory + singleton + `not_implemented` default + injectable impl)
- [ ] `LabelledGradingSample` normalises PSA, eBay, and auction rows into a uniform shape
- [ ] `ImageLoader` in mock mode returns deterministic 256×256×3 float32 arrays (same URL → same array, different URL → different array)
- [ ] No live network calls in tests (gated behind `CORNERS_LIVE_IMAGES=1`)
- [ ] `pyproject.toml` updated: `onnx` + `onnxruntime` added to `dev` extras; `torch` + `torchvision` documented in new `ml` extras group
- [ ] `pnpm build` passes before test run

## Out of scope

- Actual CNN training with labelled data (requires more samples + torch install; #FU-41)
- On-device ONNX runtime integration in React Native (depends on onnxruntime-react-native availability; #FU-42)
- Community flywheel training data ingestion (T-GR-COMMUNITY-FLYWHEEL)
- Centering sub-grade (T-GR-CENTERING already shipped)
- T-GR-EDGES and T-GR-SURFACE models (next iteration; consume `ml_common/`)
- T-GR-AGGREGATE (depends on all sub-grades merging)

## Branch & PR

- Branch: `agent/T-GR-CORNERS`
- PR title: `feat(grading): T-GR-CORNERS — Corners subgrade model + ml_common shared ML infrastructure`
- Commit format: Conventional Commits

## New follow-ups

- **#FU-41** — Real CNN training pass: once labelled data grows beyond synthetic fixtures, run `make train` with `torch+torchvision` installed, export artifact to R2, wire model path into `CornersInferenceEngine`. Unblocked by: more labelled PSA cert data.
- **#FU-42** — On-device inference via `onnxruntime-react-native`: evaluate bundle size + perf tradeoffs; replace `not_implemented` stub in `corners-service.ts` with local ONNX runtime call once feasible.

## Escalation triggers

Stop and surface to orchestrator if:
- A required dependency turns out to be wrong/missing.
- A change is needed outside `owns_paths` beyond the authorised `ml_common/` creation.
- An acceptance criterion conflicts with PROJECT.md.
- A product decision is required.

## Notes from execution

**Elaborated and implemented by T-GR-CORNERS sub-agent.**

### Framework choice rationale

PyTorch is the natural choice for MobileNetV3-small + ONNX export, but it is
~2 GB installed and not appropriate as a base CI dep. The existing `pyproject.toml`
already has `tensorflow==2.18.1` in `[build]` extras for the embeddings pipeline.
Decision: for the CI smoke test, use a numpy-only linear model + bare `onnx`
package for ONNX graph construction. Real training uses torch (gated behind
`CORNERS_USE_TORCH=1`). `onnxruntime` is added to `dev` extras (small, ~10 MB)
for the inference round-trip test.

### Image seam

Mock images are deterministic 256×256×3 float32 arrays seeded from `abs(hash(url)) % (2**32)`.
In test mode, no network calls are made. Live mode (`CORNERS_LIVE_IMAGES=1`) fetches
via `httpx` with 30s timeout + local disk cache keyed by SHA-256 of the URL.

### Data loader shape

All three sources (PSA `grading_training_sample`, eBay `ebay_graded_listing_observation`,
auctions `auction_lot_observation`) are normalised into `LabelledGradingSample`:
```
LabelledGradingSample(
  source: str,           # 'psa_cert' | 'ebay_sold' | 'auction_pwcc' | 'auction_goldin'
  source_id: str,        # unique per source
  corners_score: float,  # PSA sub-grade 1.0–10.0
  overall_grade: float | None,
  image_urls: list[str],
  grade_company: str,    # 'PSA' | 'BGS' | ...
)
```
`printing_id` is NULL for all v1 rows (pending #FU-40 image ingest); image URLs
are the input source.
