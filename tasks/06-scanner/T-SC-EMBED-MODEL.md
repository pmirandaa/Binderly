# T-SC-EMBED-MODEL — Choose + bundle embedding model (TFLite)

**Stage:** 06-scanner
**Agent role:** ml
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-DL-IMAGE-PIPELINE — needs the catalog image URLs / R2 layout to be
  available so the offline embedding builder has something to consume.

## Soft dependencies

- T-SC-CAMERA — defines the `Frame` shape the mobile `embed(frame)` API
  accepts. Until T-SC-CAMERA lands we accept the worklet's well-known
  `vision-camera` `Frame` type as the contract.
- T-SC-ANN-INDEX — consumes the `(printing_id, embedding)` output of this
  task. We pin the embedding dim + dtype + manifest format so the
  follow-up task can build the HNSW index without round-tripping.

## Required reading

- `PROJECT.md` § 11 (Scanner Pipeline)
- `rules/06-scanner.md` (on-device only; CPU fallback; per-language
  variants; ANN R2 layout)
- `context/tech-stack.md` (Python 3.12, `react-native-fast-tflite`,
  `react-native-vision-camera`)
- `packages/db/src/schema/printings.ts` (printing identity = `id` UUID,
  variant_key, image_*_url — the ANN index keys to `printing.id`)

## Goal

Pick exactly one card-image embedding model, ship a reproducible
offline pipeline that converts it to TFLite and emits per-printing
embedding vectors, and ship the on-device TypeScript module that loads
the TFLite file, validates its manifest, runs frame-level inference
through a GPU delegate (with a CPU fallback), and returns an
L2-normalised `Float32Array` to the rest of the scanner pipeline. Both
sides are infrastructure for T-SC-ANN-INDEX and T-SC-MATCH; this task
does not own the index format or the match thresholds.

## Decision — model choice

**MobileNetV3-Small** (Keras Applications, ImageNet weights, average
pooling head, no classifier).

- Penultimate-layer feature dim: **576** (L2-normalised).
- TFLite size after dynamic-range int8 quantisation: **~5–6 MB**
  (target ≤ 25 MB).
- Input: `224 × 224 × 3` RGB, `tf.keras.applications.mobilenet_v3.preprocess_input`
  (scales to `[-1, 1]`).
- Why MobileNetV3-Small over alternatives:
  - **vs EfficientNet-B0:** B0 is ~22 MB and ~3× the inference cost
    for a marginal accuracy lift on natural images — not worth it for
    v1.
  - **vs CLIP ViT-B/32 image encoder:** ~88 MB even quantised, ViT
    ops have patchy TFLite + GPU-delegate support, and the embedding
    is much larger (512-D) which pushes the ANN budget. Revisit if
    real-world accuracy of MobileNetV3 underperforms.
  - **vs custom contrastive training:** out of scope for v1; needs
    labelled card-scan data we don't have yet.
  - **In short:** MobileNetV3-Small is the v1 sweet spot per
    `PROJECT.md` § 11 (≤ 25 MB, ≤ 100 ms per inference, ≥ 95 % top-1
    target). Revisit if real-world top-1 < 90 % on phone scans.

Single English variant ships for v1; per-language variants (JP) are a
follow-up under `rules/06-scanner.md` (English features generalise
well enough for v1; revisit if JP scans underperform).

## Deliverables

### Surface 1 — offline / build-time half (Python)

- `apps/api-python/pyproject.toml` — PEP 621 metadata,
  `[project.optional-dependencies]` split into `runtime` (numpy,
  Pillow, ai-edge-litert, pydantic) and `build` (tensorflow,
  tensorflow-hub) plus `dev` (pytest).
- `apps/api-python/README.md` — package overview + how to run.
- `apps/api-python/embeddings/MODEL.md` — chosen model + version + URL
  + rationale (this file is the contract referenced from the PR body).
- `apps/api-python/embeddings/__init__.py`
- `apps/api-python/embeddings/manifest.py` — `EmbeddingManifest`
  pydantic model + `load_manifest(path)`.
- `apps/api-python/embeddings/normalize.py` — image preprocessing
  (resize + dtype + normalisation) and `l2_normalize(vec)`.
- `apps/api-python/embeddings/runner.py` — thin `EmbeddingRunner`
  wrapper around `ai_edge_litert.Interpreter` with a batched
  `embed_batch(images)` API.
- `apps/api-python/embeddings/scripts/__init__.py`
- `apps/api-python/embeddings/scripts/build_tflite.py` — downloads
  MobileNetV3-Small via `tf.keras.applications`, strips the classifier,
  exports to TFLite with int8 dynamic-range quantisation, emits the
  `manifest.json` next to the `.tflite` file, validates output size
  < 25 MB, runs a single-image smoke inference. Requires the `build`
  extras.
- `apps/api-python/embeddings/scripts/build_card_embeddings.py` —
  CLI: `--model-path --images-dir --output-path --manifest-path
  --batch-size --limit`. Reads images from a local directory (the
  T-DL-IMAGE-PIPELINE R2 → local-mirror is out of scope here), runs
  batched inference, writes an `.npz` with `printing_ids: U36` and
  `embeddings: float32 (N, D)`, both L2-normalised.
- `apps/api-python/embeddings/scripts/smoke.py` — 10-image end-to-end
  smoke; produces a temp `.npz`, asserts shape + L2 norm + manifest
  schema.
- `apps/api-python/embeddings/tests/` — pytest suite:
  `test_manifest.py`, `test_normalize.py`, `test_runner.py`,
  `test_build_card_embeddings.py`, `test_smoke.py`. Tests use a
  pre-committed tiny TFLite fixture (`tests/fixtures/tiny_embedder.tflite`,
  ~2 KB) so they don't depend on the `build` extras at runtime.
- `.github/workflows/ci-python.yml` — sets up Python 3.12, installs
  the `runtime` + `dev` extras, runs `pytest apps/api-python/`. New
  job, not wired into branch protection (orchestrator can promote it
  later).

### Surface 2 — on-device half (TypeScript)

- `apps/mobile/src/scanner/embed/index.ts` — public surface.
- `apps/mobile/src/scanner/embed/manifest.ts` — Zod schema mirroring
  the Python manifest exactly (`EmbeddingManifestSchema`).
- `apps/mobile/src/scanner/embed/loader.ts` — `loadEmbeddingModel`:
  loads the bundled TFLite asset, validates the manifest, tries the
  GPU delegate first then falls back to CPU on any throw, returns the
  `EmbeddingModelHandle`.
- `apps/mobile/src/scanner/embed/embed.ts` — frame preprocessing
  (resize via the underlying frame metadata) + interpreter call +
  L2-normalisation + latency reporting.
- `apps/mobile/src/scanner/embed/telemetry.ts` — `EmbedTelemetry`
  type + an event-emitter-style hook so T-SC-MATCH can subscribe to
  per-scan latency.
- `apps/mobile/src/scanner/embed/types.ts` — shared types
  (`EmbeddingModelHandle`, `EmbedFrameInput`, `InferenceDelegate`).
- `apps/mobile/src/scanner/embed/__tests__/manifest.test.ts`
- `apps/mobile/src/scanner/embed/__tests__/loader.test.ts`
- `apps/mobile/src/scanner/embed/__tests__/embed.test.ts`
- `apps/mobile/src/scanner/embed/__tests__/telemetry.test.ts`
- `apps/mobile/package.json` — adds `react-native-fast-tflite`
  (pinned) as a runtime dep.
- `apps/mobile/metro.config.js` — adds `tflite` to
  `resolver.assetExts` so Metro bundles `.tflite` files.
- `apps/mobile/src/test-utils/setup.ts` — adds a deterministic mock
  for `react-native-fast-tflite` so the existing vitest harness can
  exercise loader / embed contract paths without the native module.

### Workspace + repo plumbing

- `pnpm-workspace.yaml` — negate `apps/api-python` so pnpm ignores
  the Python sub-tree (no `package.json` to mistake it for a JS
  workspace package).
- `dependencies.yaml` — flip this task's `status: pending → in_review`
  and `stub: true → false`.
- `.gitignore` — exclude generated TFLite builds and `.npz`
  embedding outputs and Python `__pycache__` / `.venv` under the new
  Python package. The shipped fixture under
  `apps/api-python/embeddings/tests/fixtures/` is exempted explicitly.

## Acceptance criteria

- [ ] `MobileNetV3-Small` is declared as the v1 model in
  `apps/api-python/embeddings/MODEL.md` with version, source URL and
  rationale.
- [ ] `apps/api-python/embeddings/scripts/build_tflite.py` exists and
  builds a TFLite file with the documented int8 dynamic-range
  quantisation when run with the `build` extras (offline-only;
  not exercised in CI).
- [ ] `build_card_embeddings.py` produces an `.npz` with
  `printing_ids: U36 (N,)` and `embeddings: float32 (N, 576)` where
  every row has `‖x‖₂ ≈ 1.0 ± 1e-5`.
- [ ] `manifest.json` validates against both the Python pydantic model
  and the TypeScript Zod schema (round-trip test).
- [ ] Mobile `loadEmbeddingModel`:
  - [ ] Returns a handle with `embeddingDim` matching the manifest.
  - [ ] Falls back to CPU delegate when the GPU delegate constructor
        throws.
  - [ ] Rejects a manifest whose `embeddingDim` disagrees with the
        loaded interpreter's actual output tensor shape.
- [ ] Mobile `embed(frame)` returns an L2-normalised `Float32Array` of
  the expected length and emits a telemetry event with measured
  latency.
- [ ] Python pytest suite passes locally and in the new
  `ci-python.yml` workflow.
- [ ] Mobile vitest suite has ≥ 15 net-new passing tests covering the
  module under `apps/mobile/src/scanner/embed/`.
- [ ] No changes outside the declared `owns_paths` except the
  pre-authorised list in the dispatch brief.
- [ ] Conventional Commits PR title using `feat(scanner): …`.

## Out of scope

- Card detection / cropping (T-SC-DETECT).
- ANN index construction (T-SC-ANN-INDEX) — this task only emits the
  `.npz` of `(printing_id, embedding)` pairs the index consumes.
- Match logic + confidence calibration (T-SC-MATCH).
- A full-catalog embedding run — that is a Pablo-driven offline batch
  job. CI only runs the 10-card smoke.
- On-device model updates fetched from R2 — v1 ships bundle-only.
- JP card variants — single English-trained variant for v1.
- Real-device perf benchmarking — we publish a *theoretical* latency
  budget based on published MobileNetV3-Small inference numbers; on-
  device measurement happens once the camera + frame processor are
  wired (T-SC-CAMERA → T-SC-MATCH).

## Branch & PR

- Branch: `agent/T-SC-EMBED-MODEL`
- PR title: `feat(scanner): T-SC-EMBED-MODEL — embedding model bundling + on-device TFLite inference`
- Commit format: Conventional Commits.

## Escalation triggers

- `react-native-fast-tflite` deprecated or moved → file a `Q-NNN`
  with options (`@tensorflow/tfjs-react-native`, ONNX Runtime), pick
  the best alternative, document the pivot in the PR.
- TFLite conversion of MobileNetV3-Small fails on the target
  TensorFlow version → fall back to MobileNetV2-1.0 (also
  Keras-Applications-native, broader op coverage) and document.
- Manifest schema mismatch between Python and TypeScript surfaces →
  pick the Python one as source of truth, regenerate Zod.

## Notes from execution

- **Model**: MobileNetV3-Small via `tf.keras.applications`. We chose
  `tf.keras.applications` over TF Hub because Keras Applications ships
  with TensorFlow itself (no extra dep, no internet during build) and
  its `(include_top=False, pooling='avg')` form already gives us the
  576-D feature vector cleanly.
- **TFLite runtime**: chose **`ai-edge-litert`** (Google's modern
  replacement for `tflite-runtime`) for the Python *runtime* path
  because `tflite-runtime` is no longer maintained for Python 3.12+.
  `tensorflow` is only required by `build_tflite.py`; CI installs
  only the `runtime` + `dev` extras.
- **Test fixture**: we ship a ~2 KB pre-built TFLite at
  `apps/api-python/embeddings/tests/fixtures/tiny_embedder.tflite`.
  It is a `224×224×3 → 32-D` dense projection so the runner / smoke
  tests can run without TensorFlow, which keeps the CI install
  light. The fixture is byte-for-byte deterministic (same seed,
  same converter, repeatable build via `tests/fixtures/build.py`).
- **`react-native-fast-tflite` version**: pinned `1.6.1` — latest
  stable as of 2026-05, supports vision-camera v4 `Frame` API + the
  GPU delegate try/init path the stage rules require.
- **GPU delegate fallback**: react-native-fast-tflite throws
  synchronously when GPU init fails on some Android devices; the
  loader wraps `loadTensorflowModel(uri, 'core-ml' | 'android-gpu')`
  in a try/catch, falls back to `'default'` (CPU) and reports the
  chosen delegate in the returned handle (T-SC-MATCH consumes this
  for telemetry).
- **Latency claim**: theoretical only for now (no device in the
  worktree). Published MobileNetV3-Small inference on a Pixel 6 CPU
  is ~12 ms, ~5 ms on the GPU delegate; well under the 100 ms
  per-frame budget. We expose a `telemetry` hook so T-SC-MATCH can
  validate on-device once camera frames are flowing.
