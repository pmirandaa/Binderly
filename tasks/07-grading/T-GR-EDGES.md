# T-GR-EDGES — Edges subgrade model (training + inference)

**Stage:** 07-grading
**Agent role:** ml
**Effort:** L
**Status:** in_progress

---

## Goal

Ship the **edges sub-grade model** for Binderly's grading pipeline.  The edges
sub-grade is one of the four BGS-style sub-grades (centering, corners, edges,
surface) the app predicts when a user submits a card for grading.

"Edges" in PSA/BGS grading refers to the condition of the four perimeter edges
of the card (not the corner vertices).  Examiners look for nicks, dents, chips,
whitening, and wear along each edge strip.  The model crops four thin
rectangular strips from a card image and predicts an aggregate score on the
PSA 1.0–10.0 scale.

This task mirrors **T-GR-CORNERS exactly** — same module layout, same
`ml_common/` consumer pattern, same TypeScript factory contract.  The only
deltas are the input cropping geometry (strips instead of corners), the
aggregate rule (weakest-edge dominates, same convention), the eval column
(`edges` instead of `corners`), and the documented production CNN head.

---

## Input cropping — strip geometry

The card image is normalised to **256 × 256 px** before cropping.  Four strips
are extracted:

| Strip | Crop region (x, y, w, h at 256 px) | Normalised feature size |
|---|---|---|
| Top edge | (0, 0, 256, 32) | 32 × 256 px |
| Bottom edge | (0, 224, 256, 32) | 32 × 256 px |
| Left edge | (0, 0, 32, 256) | 256 × 32 px |
| Right edge | (224, 0, 32, 256) | 256 × 32 px |

Strip thickness = **32 px** at 256-px normalisation.  At the physical PSA
standard card (63 × 88 mm) the strip represents roughly 2.5 mm of real
material on each edge, which is sufficient to capture the wear band visible
to a grader.

For the **CI smoke test** (numpy placeholder), `patch_size=8` means each strip
is loaded as an 8 × 8 px mock array, giving a feature vector of
`4 × 8 × 8 × 3 = 768` floats — same as the corners placeholder for symmetry.

---

## Sub-grade specifics

| Property | Value |
|---|---|
| PSA sub-grade field | `subgrades->>'edges'` (PSA) / `parsed_sub_grades->>'edges'` (eBay + auction) |
| Prediction range | 1.0 – 10.0 |
| Aggregate rule | Weakest-edge dominates (same as corners) |
| Loss | MSE (same as corners) |
| Eval column | `edges` |

---

## Model architecture

### v1 numpy placeholder (default — CI smoke)

`EdgesModel` is a numpy linear regression.  Input: flattened feature vector
`(N, input_dim)` where `input_dim = NUM_STRIPS × patch_size² × 3`.
Output: `(N,)` predictions clamped to [1.0, 10.0].  Identical API to
`CornersModel`.

### Production CNN (behind `EDGES_USE_TORCH=1`)

```
backbone = torchvision.models.mobilenet_v3_small(weights='IMAGENET1K_V1')
backbone.classifier = nn.Sequential(
    nn.Linear(backbone.last_channel, 64),
    nn.Hardswish(),
    nn.Linear(64, 1),
)
# Process 4 strips independently through the shared backbone,
# average the 4 logit outputs, clamp to [1.0, 10.0].
# Each strip is letterboxed to 224×224 RGB for the ImageNet backbone.
```

---

## TypeScript contract (`EdgesService`)

```ts
createEdgesService(impl?: EdgesService): EdgesService
defaultEdgesService: EdgesService  // singleton, returns not_implemented

interface EdgesRequest {
  readonly sessionId: string;
  readonly stripUris: readonly [string, string, string, string];  // [top, bottom, left, right]
}

interface EdgesResult {
  readonly sessionId: string;
  readonly perEdge: ReadonlyArray<EdgesSubgrade>;  // 4 entries
  readonly aggregate: ConfidenceBand;
  readonly modelVersion: string;
}

function isEdgesError(value: EdgesResult | EdgesServiceError): value is EdgesServiceError
```

---

## Module layout (mirrors corners exactly)

```
apps/api-python/grading/edges/
  __init__.py       public surface
  types.py          EdgesLabelledSample, EdgesRequest, EdgesPrediction, constants
  dataset.py        EdgesDataset + EdgesMergedDataLoader
  model.py          EdgesModel (numpy placeholder)
  train.py          train_edges_model() + __main__
  eval.py           eval_edges_model() + __main__
  export.py         export_edges_model() + __main__
  infer.py          EdgesInferenceEngine
  Makefile
  tests/
    __init__.py
    conftest.py
    test_model.py
    test_dataset.py
    test_train.py
    test_eval.py
    test_export.py
    test_infer.py

apps/mobile/src/grading/edges/
  types.ts
  edges-service.ts
  index.ts
  __tests__/
    edges-service.test.ts
```

---

## Data loading design note

`ml_common.MergedDataLoader` is coupled to the `corners` sub-grade column
(hard-coded `is_labelled_for_corners()` filter and `corners_score` field on
`LabelledGradingSample`).  Since ml_common **must not** be modified in this
task (T-GR-SURFACE is running in parallel and may want different changes),
this task introduces an `EdgesMergedDataLoader` and `EdgesLabelledSample` in
`edges/dataset.py` and `edges/types.py` respectively — a parallel data layer
that reads the same raw row dicts but extracts the `edges` sub-grade label.

→ **Q-44** filed: ml_common should be generalised to support arbitrary
sub-grade columns without per-sub-grade boilerplate.

---

## Acceptance criteria

1. `pytest -q apps/api-python/grading/edges/tests/` passes with ≥ 50 tests.
2. `pnpm vitest run --reporter verbose apps/mobile/src/grading/edges` passes
   with ≥ 15 tests.
3. `pnpm build` + `pnpm typecheck` pass with no new TS errors.
4. `python -m grading.edges.train` runs end-to-end with synthetic data, prints
   a JSON summary, and exits 0.
5. ONNX export round-trip: `export_edges_model(model, path)` produces a valid
   ONNX file that `onnxruntime` can load and run.
6. `EdgesInferenceEngine.predict_from_uris([...4 URIs...])` returns an
   `EdgesPrediction` with 4 per-edge entries and an aggregate, all values
   in [1.0, 10.0].
7. `defaultEdgesService.grade(request)` returns an `EdgesServiceError` with
   `reason === 'not_implemented'`.
8. `isEdgesError` type guard correctly distinguishes `EdgesResult` from
   `EdgesServiceError` in both success and error branches.

---

## Out of scope

- Live DB connection or real image fetching (deferred to #FU-39, #FU-40).
- Replacing the numpy placeholder with the PyTorch CNN (deferred to #FU-45).
- Wiring `EdgesService` to a real network endpoint or on-device ONNX (#FU-46).
- Hyperparameter tuning or dataset curation (#FU-47).

---

## Branch & PR

- Branch: `agent/T-GR-EDGES`
- PR title: `feat(grading): T-GR-EDGES — Edges subgrade model (training + inference)`

## Notes from execution

Elaborated from stub by T-GR-EDGES sub-agent (2026-05-20).  The Q-44 concern
about ml_common generalisation is documented in open-questions.md.
