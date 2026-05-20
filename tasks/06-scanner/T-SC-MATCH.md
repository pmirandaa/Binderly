# T-SC-MATCH — Scanner read-path closer (detect → embed → ann → match)

**Stage:** 06-scanner
**Agent role:** ml
**Effort:** L
**Status:** in_progress

---

## Hard dependencies

- **T-SC-DETECT** (merged) — `apps/mobile/src/scanner/detect/` produces
  `DetectionEvent { ts, rect, rectValid, quality, accepted, cropped }`
  events through `DetectionSink` (JS-thread bus, see
  `detect-sink.ts`). The worklet hops onto the JS thread via
  `useRunOnJS`; rejected frames emit `cropped: null` to preserve the
  embedding budget.
- **T-SC-ANN-INDEX** (merged) — `apps/mobile/src/scanner/ann/`
  exposes `AnnIndexHandle.searchKNN(queryVec, k)` returning a
  ranked `AnnSearchResult[]` (cosine ∈ [-1, 1], descending,
  deterministic tie-break by `printingId`).

## Soft dependencies

- **T-SC-EMBED-MODEL** (merged) — `apps/mobile/src/scanner/embed/`
  exposes `EmbeddingModelHandle.embed(frame)`. The handle's `embed`
  takes an `EmbedFrameInput` (raw uint8 RGB via `toArrayBuffer()`),
  not the already-normalised Float32 crop the detect stage emits.
  This task bridges the seam by accepting an injected
  `embedCrop(crop: Float32Array) => Promise<Float32Array>` adapter
  rather than calling `embed()` directly; the scanner-screen
  wiring (T-SC-UX, downstream) supplies the adapter. This keeps
  `match/` free of any cross-module assumption about how the
  Float32 tensor gets to the model.

## Required reading

- `PROJECT.md` § 11 (Scanner Pipeline) — UX (high vs low confidence),
  stack mode, on-device pipeline diagram, FP < 0.5% target.
- `rules/06-scanner.md` — sub-1.5s scan-to-add target, FP < 0.5%
  threshold, stack-mode reset heuristic, battery posture.
- `open-questions.md` Q-014 — pure-JS searchKNN() latency at full
  catalog scale; deferred to #FU-29 / T-SC-ANN-NATIVE; this task
  ships against the pure-JS path at v1 beta size (~3-5 k printings,
  ~15-25 ms per query, comfortably inside the 30 ms budget).
- `apps/mobile/src/scanner/detect/{types,detect-sink,frame-processor,constants}.ts`
- `apps/mobile/src/scanner/embed/{types,index,telemetry}.ts`
- `apps/mobile/src/scanner/ann/{types,index,search}.ts`

## Goal

Close the scanner read path. Subscribe to the detection event bus,
turn each accepted detection into an embedding, run the embedding
through the ANN index, apply a confidence + stability gate, and
emit `MatchResult` events the scanner UI layer (T-SC-UX) consumes
to auto-add to the collection or surface a disambiguation picker.

The matcher runs entirely on the JS thread. The worklet bridge
already lives upstream in T-SC-DETECT's `useDetectFrameProcessor()`;
this task only sees the JS-side bus.

## Latency posture (Q-014)

v1 beta catalog (~3-5 k printings, EN-only) sits well inside the
30 ms ANN budget on the existing pure-JS `searchKNN()` (~15-25 ms
per query). This task ships against the pure-JS path **as-is**.

The full-production-scale (~30 k printings) ANN swap to a native
SIMD inner loop (`vDSP_distancesq` on iOS, ARM Neon on Android) is
explicitly **out of scope** — Pablo's Q-014 disposition reserved
that work for **#FU-29 / T-SC-ANN-NATIVE** as a separate Expo
Module task. The swap is transparent to this layer: T-SC-MATCH
consumes `searchKNN()` through the existing TS surface; the file
at `apps/mobile/src/scanner/ann/search.ts` is the swap point.

## Confidence + stability defaults

L2-normalised cosine ∈ [-1, 1]. Defaults (first-principles; no
calibration set on hand yet — bootstrapping that is a follow-up):

- `MATCH_AUTO_ADD_SCORE = 0.78` — top-1 ≥ this AND top-1 minus
  top-2 ≥ `MATCH_TOP_GAP_MIN` → `disposition: 'auto-add'`.
- `MATCH_DISAMBIG_SCORE = 0.55` — top-1 ≥ this but below auto-add
  (or auto-add but gap too small) → `disposition: 'disambiguate'`
  (UI shows top-3 picker).
- Below `MATCH_DISAMBIG_SCORE` → no `MatchResult` emitted.
- `MATCH_TOP_GAP_MIN = 0.04` — keeps "two visually similar holos
  in the same set" out of the auto-add path.
- `MATCH_STABILITY_COUNT = 3` — same `printingId` across 3
  consecutive accepted detections fires. At 10 FPS that's ~300 ms;
  imperceptible to the user, robust to 1-2 transient blurs.
- `MATCH_STACK_RESET_MS = 350` — gap between accepted detections
  > this resets the stability counter (Rules § 11: "card removed
  from frame for >300 ms"). Also releases the post-fire cooldown
  so the next card flip starts a fresh count.
- `MATCH_K = 5` — top-K we ask the ANN index for; we need top-2
  for the gap check + top-3 for the disambiguation picker.

Real calibration (FP < 0.5% on a labeled scan set) requires
real-phone data. That work is logged as **#FU-30 — confidence
calibration on labeled scans** in `status.md`'s Known Follow-ups
(orchestrator to file after merge).

## Stack-mode behaviour

Per `PROJECT.md` § 11: "Stack mode is just continuous single-card
mode with the auto-detect heuristic that resets on 'card removed
from frame for >300 ms' or 'different card geometry detected'.
No user toggle needed."

Concretely in this layer:

- Each emitted `MatchResult` is appended to an in-memory
  `MatchQueue` (cap `MATCH_QUEUE_CAP = 32`; overflow drops oldest).
- After firing for `printingId X`, the matcher enters
  **post-fire cooldown** for X — the same printing won't fire
  again until either:
  - `MATCH_STACK_RESET_MS` ms pass with no accepted detection
    (card removed), or
  - A *different* `printingId` stabilises (user flipped to next
    card) — which fires on its own and replaces the cooldown.
- The queue is the source-of-truth for the "12 cards added — Done"
  session footer (T-SC-UX consumes); `flush()` returns + clears
  the pending matches once the user taps Done.

## Off-worklet posture

- Detection emits on the worklet thread; the JS-thread hop already
  happens upstream in `useDetectFrameProcessor()` via `useRunOnJS`.
- The matcher subscribes to the resulting JS-thread `DetectionSink`
  — no `runOnJS` deadlock surface in this layer.
- `embedCrop()` is async (TFLite inference); while a previous
  embed is in flight we keep at most one **pending** detection
  event (newest wins, oldest dropped). This is standard async
  debouncing and matches the camera-task throttle posture (the
  worklet is already 10 FPS-capped upstream).

## Deliverables

All under `apps/mobile/src/scanner/match/`:

- `constants.ts` — tunables (auto-add / disambig scores, gap,
  stability count, reset window, queue cap, K).
- `types.ts` — `MatchResult`, `MatchEvent`, `MatchListener`,
  `MatchSink`, `MatchConfig`, `MatchQueue`, `EmbedCrop`,
  `SearchFn`, `MatcherDeps`, `MatcherHandle`.
- `confidence.ts` — pure `classifyConfidence(candidates,
  config)` returning `'auto-add' | 'disambiguate' | 'reject'`
  + the top gap.
- `stability.ts` — pure stability gate; tracks consecutive
  count for a printing + post-fire cooldown.
- `match-sink.ts` — JS-thread subscriber bus, mirrors
  `createDetectionSink()`.
- `match-queue.ts` — bounded FIFO of fired matches with
  `flush()` / `drain()` / `latest()`.
- `matcher.ts` — `createMatcher(deps)` returns a `MatcherHandle`
  with `observe(event)`, `dispose()`, and the queue + sink
  references. All async embed + search work threads through here.
- `use-scanner.ts` — `useScanner({ detectionSink, embedCrop,
  searchKNN, config? })` React hook that wires a matcher to a
  detection sink for the lifetime of the screen. Returns the
  match sink, the queue, and an `isMatching` flag.
- `index.ts` — public barrel.
- `__tests__/` — vitest tree.

## Acceptance criteria

- [ ] `apps/mobile/src/scanner/match/` exports a `useScanner()`
      hook that subscribes to a `DetectionSink` and fires
      `MatchResult` events through a `MatchSink`.
- [ ] Wire path: a detection event with a valid crop runs through
      `embedCrop()` (mocked) → `searchKNN()` (mocked) → confidence
      + stability gate → `MatchResult` emitted on the sink.
- [ ] Confidence threshold: when the top-1 score is below
      `MATCH_DISAMBIG_SCORE`, no `MatchResult` is emitted.
- [ ] Stability gate: same `printingId` across
      `MATCH_STABILITY_COUNT` consecutive accepted frames fires
      exactly once; jitter (different printings frame-to-frame)
      fires nothing.
- [ ] Disambiguation path: top-1 ≥ `MATCH_DISAMBIG_SCORE` but
      below auto-add (or auto-add score with a top-gap below
      `MATCH_TOP_GAP_MIN`) emits a `MatchResult` with
      `disposition: 'disambiguate'` and the top-3 candidates.
- [ ] Stack mode: after firing for `printingId X`, X is
      suppressed until either `MATCH_STACK_RESET_MS` ms elapse
      with no accepted detection or a different printing
      stabilises and fires.
- [ ] Queue: each fired `MatchResult` lands in the
      `MatchQueue`; cap `MATCH_QUEUE_CAP = 32` is enforced
      (overflow drops oldest); `flush()` returns + clears.
- [ ] Off-worklet posture: a detection event observed on the JS
      thread (mock worklet bridge: synchronous resolution of
      `useRunOnJS`) does not deadlock the matcher's async embed
      chain.
- [ ] Rejected detection events (`accepted: false`, `cropped:
      null`) are dropped before `embedCrop()` runs.
- [ ] `dispose()` stops the matcher from emitting further
      events.
- [ ] Tests live under
      `apps/mobile/src/scanner/match/__tests__/` and pass under
      `pnpm --filter @binderly/mobile test`.
- [ ] No changes outside `apps/mobile/src/scanner/match/` (the
      `owns_paths`).
- [ ] No new dependencies added.

## Out of scope

- **Native SIMD ANN inner loop** — deferred to #FU-29 /
  T-SC-ANN-NATIVE (Q-014 disposition).
- **Calibrated confidence threshold** — needs labeled real-phone
  scans; logged as a follow-up (#FU-30) for after the v1 beta
  collects calibration data.
- **Scanner UI** — auto-add toast, undo affordance,
  disambiguation picker, session footer. T-SC-UX owns
  `apps/mobile/src/scanner/ui/` + `apps/mobile/src/screens/scan/`.
- **`collection_item` writes** — also T-SC-UX (it bridges
  match events to the collection-mutation API).
- **Per-language index loading / model swap** — deferred to a
  later scanner task (JP catalog isn't in v1 beta).
- **Touching upstream stages** (`scanner/detect|embed|ann/`) —
  the bridge between the detect-stage Float32 crop and the
  embed-stage `EmbedFrameInput` lives in the scanner screen
  (T-SC-UX), via the `embedCrop` adapter this task accepts as a
  dependency.

## Branch & PR

- Branch: `agent/T-SC-MATCH`
- PR title: `feat(mobile): T-SC-MATCH — scanner read-path closer (detect → embed → ann → match)`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:

- The Float32 / EmbedFrameInput seam mismatch turns out to need
  changes inside `apps/mobile/src/scanner/embed/` rather than
  living behind the `embedCrop` adapter.
- The confidence defaults shipped here fail closed in a way
  T-SC-UX can't paper over (e.g. nothing ever fires; only
  disambiguation fires).
- The async-debouncing posture leaks frames into a stuck
  in-flight state we can't recover from.

## Notes from execution

(Sub-agent appends here at end.)
