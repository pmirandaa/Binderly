# `apps/api-python` — Binderly Python services

Single Python package that hosts the offline / batch / server-side
pieces of Binderly that aren't comfortable inside the JS monorepo:

- `embeddings/` — image-embedding model selection, TFLite conversion,
  and offline catalog embedding (consumed by `T-SC-ANN-INDEX`).
- _future_ `ann/` — index distribution endpoints
- _future_ `grading/` — multi-shot grading pipeline
- _future_ `pricing/` — pricing-feed fetcher

This directory is excluded from `pnpm-workspace.yaml` so the JS
tooling (pnpm / turbo / eslint) leaves it alone. CI for Python lives
in `.github/workflows/ci-python.yml`.

## Quickstart

```bash
cd apps/api-python
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'           # runtime + test deps
# (only if you intend to (re)build the TFLite model)
pip install -e '.[build]'         # adds tensorflow
pytest
```

## Modules

### `embeddings/`

See `embeddings/MODEL.md` for the chosen v1 model + rationale, and
`embeddings/scripts/` for:

- `build_tflite.py` — Keras Applications → TFLite (`build` extras
  required).
- `build_card_embeddings.py` — runs an existing TFLite model over a
  directory of catalog images and emits an `.npz` for the ANN
  builder.
- `smoke.py` — 10-image end-to-end smoke that exercises both the
  runner and the build_card_embeddings pipeline against the tiny
  fixture model.

## Why a separate Python package?

- The TFLite conversion toolchain is Python-native and not worth
  reimplementing.
- The ANN builder (HNSW / similar) is also Python-native.
- Long-running training / batch jobs belong off the user device,
  outside the JS monorepo.

The mobile / web apps never import from this package at runtime; they
consume its *artifacts* — the `.tflite` file + `manifest.json` (loaded
on-device) and the HNSW index binary (loaded on-device or fetched
from R2).
