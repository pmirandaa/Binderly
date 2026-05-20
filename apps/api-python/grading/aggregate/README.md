# `grading.aggregate` — Overall PSA grade aggregation

The aggregator is the final stage of the Binderly grading pipeline. It fuses
the four sub-grade predictions (centering, corners, edges, surface) into a
single user-facing PSA grade plus a 3-band categorical confidence.

| | |
|---|---|
| **Module path** | `apps/api-python/grading/aggregate/` |
| **TypeScript contract** | `apps/mobile/src/grading/aggregate/` |
| **Required reading** | `PROJECT.md` § 12 (Grading Pipeline), `rules/07-grading.md` |
| **Source of truth** | This Python module |

## Architecture

```
            ┌─────────────────┐
centering ─►│                 │
            │  Linear         │     PSA round
corners  ─►│  Weighted   ─►  │  ─► (0.5 ticks)  ─► overall_grade + psa_grade
            │  Sum            │     [1.0, 10.0]
edges    ─►│                 │
            │                 │
surface  ─►└─────────────────┘
                    │
                    ▼
            confidence band classifier
            (per-subgrade label + spread heuristic)
                    │
                    ▼
            'low' | 'medium' | 'high'
```

## Public surface

```python
from grading.aggregate import (
    aggregate_subgrades,   # pure workhorse
    infer,                 # upstream-prediction adapter
    AggregatedGrade,
    AggregateWeights,
    SubGradeInputs,
)

inputs = SubGradeInputs(
    scores={"centering": 9.0, "corners": 8.5, "edges": 9.0, "surface": 8.0},
    confidences={"centering": 1.0, "corners": 0.8, "edges": 0.7, "surface": 0.6},
)
result = aggregate_subgrades(inputs)
# AggregatedGrade(overall_grade=8.625, psa_grade=8.5,
#                 confidence_band='medium', sub_grades={...},
#                 calibration_notes='raw=8.625 psa=8.5 spread=1.00 ...')
```

## Default weights (priors)

PROJECT.md § 12 does not pin explicit weights. The defaults below are priors
grounded in PSA's publicly documented criteria where corners + centering
dominate:

| Sub-grade | Default weight |
|---|---|
| centering | 0.25 |
| corners | 0.35 |
| edges | 0.25 |
| surface | 0.15 |

The weights are constructor-configurable via `AggregateWeights(...)`.

## Calibration rationale (0.5 ticks)

PSA grades on **0.5 ticks** (1.0, 1.5, 2.0, …, 9.5, 10.0). The aggregator
rounds the weighted-sum to the nearest 0.5 and clamps to `[1.0, 10.0]`.
Rounding uses Python's banker's rounding for determinism at `.25` / `.75`
boundaries — important for test reproducibility.

## Confidence-band heuristic

Three layers:

1. **Per-sub-grade float → categorical** via thresholds:
   - `confidence >= 0.66` → `'high'`
   - `confidence >= 0.33` → `'medium'`
   - else → `'low'`

2. **Spread heuristic** across the 4 sub-grade scores:
   - `spread < 1.0` (high agreement): aggregate can be `'high'`.
   - `spread >= 2.0` (significant disagreement): aggregate forced to `'low'`
     even if every per-sub-grade label is `'high'`.

3. **Aggregate rule**:
   - `'high'` ⇔ all 4 labels are `'high'` AND `spread < 1.0`.
   - `'low'` if ANY label is `'low'` OR `spread >= 2.0`.
   - `'medium'` otherwise.

See `Q-018` in `open-questions.md` for the rationale and the calibration
upgrade path.

## Centering input adapter

Centering is geometric / deterministic, not ML. The `infer()` adapter maps
`CenteringResult.grade_hint` (string enum) → float score:

| `grade_hint` | score | confidence |
|---|---|---|
| `'10'` | 10.0 | 1.0 (or 0.3 if `low_confidence`) |
| `'9'` | 9.0 | same |
| `'8'` | 8.0 | same |
| `'7'` | 7.0 | same |
| `'worse'` | 4.0 | same |
| `'unknown'` | 5.0 | 0.0 (forces 'low') |

## Production upgrade path (`AGGREGATE_USE_TORCH=1`)

The v1 weighted-sum is a hand-tuned prior. Once PSA-labelled grading sessions
are available at scale (post-#FU-40 + community flywheel), a small dense
regression head can replace the linear weights:

```python
backbone = nn.Sequential(
    nn.Linear(4, 8),
    nn.Hardswish(),
    nn.Linear(8, 1),
)
```

The `AGGREGATE_USE_TORCH=1` env gate mirrors the
`CORNERS_USE_TORCH=1` / `EDGES_USE_TORCH=1` / `SURFACE_USE_TORCH=1` pattern
established by sibling sub-grade modules. The export pipeline routes to
`torch.onnx.export` when the gate is set; otherwise the numpy linear path
runs. Logged as `#FU-48` in `status.md`.

## Commands

```bash
# Run module tests
make -C apps/api-python/grading/aggregate test

# Export ONNX (default weights → aggregate_v0.onnx)
make -C apps/api-python/grading/aggregate export

# Synthetic-data eval smoke
make -C apps/api-python/grading/aggregate eval
```

## Tests

- `tests/test_types.py` — invariants on `SubGradeInputs`, `AggregatedGrade`, `AggregateWeights`.
- `tests/test_model.py` — linear weighted sum math + PSA tick rounding boundaries.
- `tests/test_service.py` — `aggregate_subgrades` + `infer` adapter + confidence-band classifier.
- `tests/test_export.py` — ONNX round-trip via `onnx.checker` + `onnxruntime` parity.
- `tests/test_eval.py` — MAE / RMSE / ±1-grade-accuracy on synthetic PSA-labelled rows.

CI smoke (no `torch` required) runs all of the above. Real-CNN training is
deferred to `#FU-48`.
