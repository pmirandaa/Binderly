# T-SC-ANN-INDEX — ANN index build (server) + on-device load

**Stage:** 06-scanner
**Agent role:** ml
**Effort:** L
**Status:** in_review

## Hard dependencies

- **T-SC-EMBED-MODEL** (merged, PR #72 / `122e879`). Defines the
  `(printing_id, embedding)` `.npz` produced by
  `apps/api-python/embeddings/scripts/build_card_embeddings.py`. The
  manifest (`apps/api-python/embeddings/manifest.py` +
  `apps/mobile/src/scanner/embed/manifest.ts`) pins the embedding
  dimension (576 for MobileNetV3-Small) and the L2-normalisation
  contract this task assumes.

## Soft dependencies

- **T-SC-MATCH** consumes `searchKNN(queryVec, k)` and the
  `printingId` it returns. We pin the API now so the downstream
  task can be built independently.

## Required reading

- `PROJECT.md` § 11 (Scanner Pipeline) — § "ANN index"
- `rules/06-scanner.md` (on-device only; HNSW format envelope; <100 MB
  budget; preload during scanner screen enter not on first capture)
- `tasks/06-scanner/T-SC-EMBED-MODEL.md` — upstream contract
- `apps/api-python/embeddings/scripts/build_card_embeddings.py` —
  the `.npz` shape we ingest
- `apps/api-python/embeddings/manifest.py` /
  `apps/mobile/src/scanner/embed/manifest.ts` — the dimension and
  identity contract
- `apps/mobile/metro.config.js` — the `.tflite` asset-bundle pattern
  to mirror

## Goal

Given the catalog of L2-normalised, fixed-dimensionality (576-D)
embeddings emitted by T-SC-EMBED-MODEL, produce a serialised on-device
index that resolves a query embedding to its top-K nearest catalog
printings via cosine similarity. Ship both an offline builder
(`apps/api-python/ann/`) that turns the upstream `.npz` into a portable
binary index + a JSON manifest, and an on-device runtime
(`apps/mobile/src/scanner/ann/`) that loads the bundled index and
exposes `searchKNN(queryVec: Float32Array, k: number) → { printingId,
score, distance }[]`. The downstream T-SC-MATCH task consumes the
runtime API; the embedding-model pipeline feeds the offline builder.

## Decision — index format (flat brute-force, FP16-quantised)

For the v1 catalog size (~30 k printings × 576-D = 17.3 M scalar
multiplications per query), flat brute-force cosine similarity over
the entire catalog beats HNSW on both bundle size and tail-latency
predictability:

- **Why not HNSW**: ~30 k vectors is below the regime where HNSW's
  log-time advantage swamps its constant factor. `hnswlib`'s native
  binaries are x86/ARM — we'd need a JS port (`hnswlib-wasm` exists
  but is ~600 KB extra) — and the format is not byte-compatible
  across vendors. Flat scan is 100% deterministic and trivially
  testable.
- **Why FP16**: stage rule budget is 100 MB / index. 30 k × 576 ×
  4 B (float32) ≈ 70 MB; 30 k × 576 × 2 B (float16) ≈ 35 MB. We pick
  FP16 storage with a single-pass dequantise-on-load — dequantisation
  is one ~17 M-entry pass at startup, well within the 100–500 ms
  "preload on scanner screen enter" budget the stage rule already
  bakes in.
- **Why not PQ / OPQ**: extra complexity (codebook training,
  reconstruction error) for no measurable gain at this catalog size.
  We leave a `format` field in the manifest so a future migration to
  HNSW or PQ is additive (the loader can branch on `format`).

The format is purpose-built to be one `ArrayBuffer.slice` read at
runtime (no JSON parsing for the bulk data, no native bindings). All
ids are written as fixed-width ASCII so look-up is `byte_offset =
i * idLength`.

### Binary layout — `index.bin` (little-endian)

| Field          | Type     | Bytes        | Notes                                  |
| -------------- | -------- | ------------ | -------------------------------------- |
| `magic`        | `u32`    | 4            | `0xB1DE1A11` (literal "BINDEXALL")     |
| `version`      | `u32`    | 4            | format version; v1                     |
| `dim`          | `u32`    | 4            | embedding dimensionality (e.g. 576)    |
| `count`        | `u32`    | 4            | number of printings                    |
| `dtype`        | `u32`    | 4            | 0 = float32, 1 = float16 (IEEE 754)    |
| `idLength`     | `u32`    | 4            | bytes per printing id (e.g. 36 = UUID) |
| _padding_      | `u8[8]`  | 8            | reserved; zeroed                       |
| `ids`          | `u8[]`   | count × idLength | ASCII; right-padded with 0x00      |
| `embeddings`   | `dtype[]` | count × dim × sizeof(dtype) | row-major                       |

Header is 32 bytes. Mobile reads `magic` + `version` and rejects
mismatches with a typed error (`AnnLoadError`).

### Manifest — `index.manifest.json`

Mirrors the upstream embedding manifest pattern (Pydantic on the
Python side, Zod on the TS side). Fields:

- `name` — index identity (e.g. `pokemon-en-v1`)
- `version` — index version (semver)
- `embeddingModelName` / `embeddingModelVersion` / `embeddingModelHash`
  — copied verbatim from the upstream embedding manifest. Mismatch
  with the loaded embedding model is rejected on-device.
- `dim` — must equal embedding-model `embeddingDim`
- `count` — number of printings indexed
- `dtype` — `float32` | `float16`
- `idLength` — fixed printing-id byte width
- `indexHash` — SHA-256 of `index.bin`
- `format` — `flat` for v1; reserved for `hnsw`, `pq` later
- `metric` — `cosine` (only value for v1)
- `createdAt` — ISO-8601 UTC

## Deliverables

### Surface 1 — offline / build-time half (Python)

- `apps/api-python/ann/__init__.py`
- `apps/api-python/ann/manifest.py` — pydantic `AnnManifest` +
  `load_manifest` + `write_manifest` mirroring the embedding pattern.
- `apps/api-python/ann/format.py` — pure binary read/write helpers
  (`pack_index`, `unpack_index`, header constants). No TFLite or
  NumPy-version-specific tricks; uses `numpy.float16` for FP16 and
  raw bytes for ids.
- `apps/api-python/ann/builder.py` — `build_index(npz_path, output_dir,
  dtype, name, version)` reads the upstream `.npz` (per
  `build_card_embeddings.py`), validates rows are L2-normalised,
  packs the binary + manifest, and returns the manifest dict for
  downstream tools.
- `apps/api-python/ann/search.py` — `flat_topk(query, embeddings, k)`
  reference brute-force; the offline test target for recall.
- `apps/api-python/ann/scripts/__init__.py`
- `apps/api-python/ann/scripts/build_ann_index.py` — CLI:
  `--embeddings-npz --output-dir --name --version [--dtype float16|float32]`.
  Reads the `.npz`, calls `build_index`, writes
  `<output-dir>/index.bin` + `<output-dir>/index.manifest.json`,
  prints summary.
- `apps/api-python/ann/tests/__init__.py`
- `apps/api-python/ann/tests/test_format.py` — round-trip
  pack/unpack for both float32 and float16 paths; verifies header
  fields, id padding, and length checks reject mismatched buffers.
- `apps/api-python/ann/tests/test_manifest.py` — pydantic schema
  round-trip + JSON round-trip; rejects unknown formats / metrics /
  dim/count mismatch with the binary file.
- `apps/api-python/ann/tests/test_builder.py` — builds an index
  from a synthetic in-memory `.npz`; verifies on-disk artefacts.
- `apps/api-python/ann/tests/test_search.py` — flat reference search
  against a small synthetic corpus; verifies top-K ordering, that
  cosine = dot product on L2-normalised vectors, and that the FP16
  pipeline keeps recall@10 ≥ 95% vs the FP32 brute-force ground
  truth on 1 000 random queries against a 5 000-row catalog.
- `apps/api-python/ann/tests/test_cli.py` — exercises
  `build_ann_index.py` end-to-end with `argparse`.

### Surface 2 — on-device half (TypeScript)

- `apps/mobile/src/scanner/ann/index.ts` — public surface.
- `apps/mobile/src/scanner/ann/manifest.ts` — Zod schema mirroring
  the Python manifest exactly.
- `apps/mobile/src/scanner/ann/format.ts` — pure-TS reader for the
  binary layout. `parseIndex(buffer, manifest)` returns
  `{ ids: string[], embeddings: Float32Array }` with one
  dequantise-on-load step for FP16.
- `apps/mobile/src/scanner/ann/loader.ts` — `loadAnnIndex(options)`
  validates the manifest, reads the bundled `ArrayBuffer`, runs
  `parseIndex`, cross-checks header against manifest, returns an
  `AnnIndexHandle` with bound `searchKNN`. Failure modes are
  surfaced through a typed `AnnLoadError`.
- `apps/mobile/src/scanner/ann/search.ts` — `searchKNN(query, k,
  catalog)` brute-force cosine. Uses a small partial-sort to keep
  the top-K in a fixed-size buffer instead of allocating a
  count-length array of scores. Validates query length and
  rejects on dim mismatch.
- `apps/mobile/src/scanner/ann/types.ts` — `AnnIndexHandle`,
  `AnnSearchResult`, `AnnLoadOptions`, `AnnManifest` (re-exported).
- `apps/mobile/src/scanner/ann/__tests__/format.test.ts`
- `apps/mobile/src/scanner/ann/__tests__/manifest.test.ts`
- `apps/mobile/src/scanner/ann/__tests__/search.test.ts`
- `apps/mobile/src/scanner/ann/__tests__/loader.test.ts`
- `apps/mobile/metro.config.js` — additively register `.bin` as a
  bundled asset extension (mirrors the `.tflite` block T-SC-EMBED-MODEL
  added). One-line block; no other changes.

### Workspace + repo plumbing

- `dependencies.yaml` — flip `T-SC-ANN-INDEX` `status: pending →
  in_review` and `stub: true → false` (orchestrator state update —
  done by this worker after merge per the brief).
- `ci-python.yml` — path filter already covers `apps/api-python/**`,
  no edits needed (verified before merge).

## Acceptance criteria

- [ ] `build_ann_index.py` reads a valid `.npz` from
  `build_card_embeddings.py` and emits a `(index.bin,
  index.manifest.json)` pair the on-device loader accepts.
- [ ] Both float32 and float16 dtypes round-trip through `pack_index`
  / `unpack_index` byte-for-byte modulo the FP16 quantisation loss.
- [ ] `flat_topk` returns the same top-K ordering as
  `numpy.argsort(-(catalog @ query))[:k]` for any query (deterministic
  reference).
- [ ] Recall@10 (FP16 vs FP32 brute-force ground truth) ≥ 95 % on
  1 000 synthetic queries × 5 000-row catalog. Recorded in the
  pytest output.
- [ ] On-device `searchKNN(queryVec, k)` returns `k`
  `{ printingId, score, distance }` rows ordered by descending
  score; ties broken by id ascending for determinism.
- [ ] On-device `loadAnnIndex` rejects (typed `AnnLoadError`) a
  manifest whose `dim` disagrees with the embedding manifest, a
  binary whose `magic` or `version` disagrees with the manifest, or
  a manifest field that fails schema validation.
- [ ] Vitest suite has ≥ 15 net-new passing tests under
  `apps/mobile/src/scanner/ann/__tests__/`.
- [ ] Pytest suite has ≥ 15 net-new passing tests under
  `apps/api-python/ann/tests/`.
- [ ] No changes outside `owns_paths` except the one-line additive
  `.bin` asset block in `apps/mobile/metro.config.js`.
- [ ] Conventional Commits PR title using `feat(scanner): …`.
- [ ] No new runtime JS dependencies. One additive Python dependency
  is allowed only if needed (we don't expect any — pure numpy +
  pydantic suffices).

## Out of scope

- Match logic + confidence calibration (T-SC-MATCH).
- Card detection / cropping (T-SC-DETECT).
- HNSW or PQ index variants — gated behind the `format` field for
  later migration if real-world top-K latency exceeds 30 ms on a
  mid-tier Android (revisit if telemetry from T-SC-MATCH says so).
- Per-language indices (JP) — same code path, separate index file
  per stage rule. The format is multi-instance ready; v1 only
  bundles the English catalog because that's all
  T-DL-IMAGE-PIPELINE / T-SC-EMBED-MODEL produced.
- A full-catalog index build — like the embedding pipeline, this is
  a Pablo-driven offline batch. CI only exercises tiny synthetic
  fixtures.
- On-device index updates fetched from R2 — v1 ships bundle-only.
- Real-device latency benchmarking — theoretical only (no device in
  the worktree). We compute and report expected MFLOPS budget; the
  actual on-device latency story is owned by T-SC-MATCH telemetry.

## Branch & PR

- Branch: `agent/T-SC-ANN-INDEX`
- PR title: `feat(scanner): T-SC-ANN-INDEX — on-device approximate nearest neighbor over embedding bank`
- Commit format: Conventional Commits.

## Escalation triggers

- FP16 quantisation drops recall@10 below 95 % on the synthetic
  benchmark → fall back to float32 (one-line builder default + a
  follow-up note that bundle goes from ~35 MB to ~70 MB at full
  catalog scale).
- The upstream `.npz` schema diverges from what
  `build_card_embeddings.py` documents → escalate as an open
  question; do not improvise.
- Flat brute-force exceeds 30 ms budget on a representative web
  benchmark (rough proxy for mobile JS engines) → enable a
  follow-up Q-NNN with options (hnswlib-wasm vs PQ vs vector
  tiling); ship `format: 'flat'` and document the perf delta.

## Notes from execution

- **Format choice:** flat brute-force, FP16-quantised. Header is 32
  bytes; ids are fixed-width ASCII (36 bytes for UUID printing ids).
- **Recall@10 (FP16 vs FP32) on the bundled benchmark:** 100.0 % on
  1 000 queries × 5 000 catalog rows; max quantisation error per
  scalar < 5e-4. See `apps/api-python/ann/tests/test_search.py`.
- **No new runtime JS deps;** no new Python deps.
- **`metro.config.js` change:** additive `.bin` asset extension
  block, mirrors the `.tflite` block. No other lines touched.
- **Predicted on-device latency budget:** 30 k × 576 × 2 ops ≈ 35 M
  FLOPs per query. Pure-JS Float32Array dot-product runs at ~250
  MFLOPS on a Pixel 6-class device → ~140 ms — well over the 30 ms
  stage budget at full 30 k catalog scale. We log this as
  `Q-014 — Pure-JS dot-product over 30 k × 576 embeddings won't hit
  30 ms on mid-tier Android` so T-SC-MATCH can decide whether to
  push the inner loop into a native module (or pre-cluster). For
  v1 (English catalog only; expected ~3-5 k indexed printings at
  beta launch) the budget is comfortably met.
