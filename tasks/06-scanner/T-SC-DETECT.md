# T-SC-DETECT — Card detection + quality gate

**Stage:** 06-scanner
**Agent role:** ml
**Effort:** L
**Status:** in_review

## Hard dependencies

- **T-SC-CAMERA** (merged, `56aaa82`) — ships the
  `vision-camera@4.6.4` + `worklets-core@1.5.0` frame-processor seam
  this task docks onto. We consume `FrameLike` (`width`, `height`,
  `bytesPerRow`) and the `runOnJS` bridge; the camera task's
  placeholder `processFrame()` is the worklet seam we replace.

## Soft dependencies

- **T-SC-EMBED-MODEL** (merged, `122e879`) — the consumer of our
  output. We emit a `224 × 224 × 3` Float32 tensor pre-normalised
  with the `mobilenet_v3` recipe (`byte / 127.5 - 1`) so the embed
  layer can pipe our crop straight into the MobileNetV3-Small
  TFLite interpreter without re-preprocessing. Shape + recipe must
  match `apps/mobile/src/scanner/embed/` exactly.
- **T-SC-ANN-INDEX** (in flight, sibling worker, disjoint paths)
  — owns `apps/mobile/src/scanner/ann/`, never touches ours.
- **T-SC-MATCH** (future) — stitches detect → embed → ann into the
  scan loop. Will subscribe to our telemetry hook.

## Required reading (consulted during elaboration)

- `PROJECT.md` § 11 (Scanner Pipeline — pipeline diagram, on-device
  budget, ≤ 100 ms per-inference target).
- `rules/06-scanner.md` (hard rule: on-device only, sub-1.5 s
  scan-to-add, frame processor on worklet thread, no JS-thread-only
  APIs inside the worklet).
- `apps/mobile/src/scanner/camera/frame-processor.ts` (`FrameLike`,
  `shouldEmitFrame`, `useRunOnJS` posture).
- `apps/mobile/src/scanner/camera/constants.ts`
  (`TARGET_FRAME_RATE_FPS = 10`).
- `apps/mobile/src/scanner/embed/embed.ts` (preprocessing recipe
  table; `mobilenet_v3` = `byte/127.5 - 1`).
- `apps/mobile/src/scanner/embed/manifest.ts` (input shape =
  `[1, 224, 224, 3]` for v1).
- `apps/mobile/src/test-utils/setup.ts` (vision-camera + worklets-core
  mocks — `useFrameProcessor`'s mock exposes `frameProcessor` as a
  callable function under the `readonly` shape).

## Goal

Given a single camera frame delivered by T-SC-CAMERA's worklet,
identify the bounding rectangle of a Pokémon card in view, score
the frame on **sharpness / brightness / aspect-ratio**, and — if
the frame clears the quality gates — emit a normalised
`224 × 224 × 3` Float32 tensor ready for T-SC-EMBED-MODEL's
MobileNetV3-Small interpreter. Frames that fail the quality gate
return early with a populated `quality` block and a `null` crop so
the rest of the pipeline never wastes an embedding-budget on a
blurry, dark, mis-framed, or landscape-oriented frame.

The hot path is a **pure function** of `(pixels, width, height,
options)` so the worklet can call it directly. No closures over
React state, no `await`, no JS-thread-only APIs.

## Decision — pure-JS, gradient-projection rectangle detection (no native module)

We take the pure-JS path the brief recommended. The compelling
reasons:

1. **No new native modules.** The sandbox has no real camera and
   can't validate Swift / Kotlin builds; adding one would force
   another `expo prebuild` cycle and another version-pin matrix
   alongside `vision-camera@4.6.4` + `fast-tflite@3.0.1` +
   `nitro-modules@0.35.7` + `worklets-core@1.5.0`. The on-device
   budget for v1 is generous (~30 ms per frame) and a downsampled
   gradient projection comfortably fits under that.
2. **Worklet-safe by construction.** Pure functions over typed
   arrays only — exactly what the `react-native-worklets-core`
   JSI runtime accepts without bridging.
3. **Tests run in vitest without native bindings.** The pure
   functions are unit-testable against synthetic pixel buffers; the
   only worklet-adapter test mocks the vision-camera `Frame` shape
   (the existing `setup.ts` helper).

### Algorithm

The detection is a five-step pipeline operating on a small
downsampled grayscale projection of the source frame:

1. **RGB → grayscale**: `gray = 0.299·R + 0.587·G + 0.114·B`
   (Rec. 601 luma — same coefficients used by every common
   demosaicer).
2. **Nearest-neighbour downsample** to a fixed analysis grid
   (`DETECT_GRID_WIDTH × DETECT_GRID_HEIGHT`, default `96 × 128`).
   Downsampling keeps the per-frame work O(`grid_area`) regardless
   of source resolution.
3. **Sobel-ish abs-difference gradient field**: for each interior
   pixel compute `|G[i,j+1] - G[i,j-1]|` (horizontal) and
   `|G[i+1,j] - G[i-1,j]|` (vertical).
4. **Row + column gradient projections**: sum vertical gradients
   per row → `rowActivity`; sum horizontal gradients per column →
   `colActivity`. A card placed against a contrasting background
   produces four sharp peaks (two row, two column) at its edges.
5. **Threshold + first-from-each-side scan** to derive
   `(xLeft, xRight, yTop, yBottom)` in grid space; rescale back to
   source-frame coordinates.

Threshold = `RECT_ACTIVITY_THRESHOLD_RATIO · max(profile)` (default
`0.35`). A noise floor (`RECT_ACTIVITY_FLOOR`, default `12`)
suppresses false positives on dim/uniform frames; if `max(profile)`
falls below the floor we report a degenerate detection and fail
the quality gate.

### Quality gates (all run inside the detected rect, in grid space)

- **Sharpness** = mean of `|gradient|` over the rect. Cards in
  focus produce sharp edges → high gradient. Threshold
  `QUALITY_SHARPNESS_MIN = 6.0`.
- **Brightness** = mean luminance over the rect (0–1). Reject
  blown-out or near-black frames. Threshold range
  `[QUALITY_BRIGHTNESS_MIN, QUALITY_BRIGHTNESS_MAX]` = `[0.10,
  0.92]`.
- **Aspect** = `max(h, w) / min(h, w)`. Pokémon card is
  `3.5 / 2.5 = 1.4`. Accept inside
  `[CARD_ASPECT_MIN, CARD_ASPECT_MAX]` = `[1.25, 1.60]`. We also
  flag the orientation: landscape (rect wider than tall) returns
  `aspectOK: false` for v1 — users hold cards portrait. Mid-future
  follow-up: auto-rotate the crop tensor on detected landscape.

`accepted = sharpnessOK && brightnessOK && aspectOK && rectValid`.
Only `accepted` frames produce a `cropped` tensor; otherwise
`cropped: null` so the embed-stage budget is preserved.

### Crop tensor

Given an `accepted` detection, we crop the source pixels to the
detected rect (axis-aligned; full perspective correction deferred
— see Out of scope) and resize to `224 × 224 × 3` with
nearest-neighbour resampling. We normalise per the `mobilenet_v3`
recipe (`byte / 127.5 - 1`, range `[-1, +1]`) so the tensor is
drop-in to T-SC-EMBED-MODEL's `embed()` call with `inputShape =
[1, 224, 224, 3]` and `normalization = 'mobilenet_v3'`.

We DO NOT call the embed helper itself — we mirror its math
locally with a tiny `normalizeMobilenetV3` because the camera
worklet path can't import from `scanner/embed/` (different
sandbox, different module-graph posture). The recipe must stay in
lockstep; a regression test cross-checks our normalised value
against the embed module's published constant.

## Deliverables

### Pure detection core

- `apps/mobile/src/scanner/detect/constants.ts` —
  `DETECT_GRID_WIDTH = 96`, `DETECT_GRID_HEIGHT = 128`,
  `CARD_ASPECT_TARGET = 1.4`, `CARD_ASPECT_MIN = 1.25`,
  `CARD_ASPECT_MAX = 1.60`, `QUALITY_SHARPNESS_MIN = 6.0`,
  `QUALITY_BRIGHTNESS_MIN = 0.10`, `QUALITY_BRIGHTNESS_MAX = 0.92`,
  `RECT_ACTIVITY_THRESHOLD_RATIO = 0.35`,
  `RECT_ACTIVITY_FLOOR = 12`, `CROP_TENSOR_SIZE = 224`.
- `apps/mobile/src/scanner/detect/types.ts` — `Rect`,
  `QualityMetrics`, `DetectionResult`, `DetectionInput`,
  `DetectFrameLike`.
- `apps/mobile/src/scanner/detect/grayscale.ts` —
  `rgbToGrayscale(pixels, w, h)`; `downsampleGrayscale(gray, srcW,
  srcH, dstW, dstH)`. Pure functions over typed arrays.
- `apps/mobile/src/scanner/detect/gradient.ts` —
  `computeGradientField(gray, w, h)`;
  `computeProjections(gradientField, w, h)`. Pure.
- `apps/mobile/src/scanner/detect/rectangle.ts` —
  `findRectFromProjections(rowActivity, colActivity, gridW, gridH,
  options)`. Pure. Rescaling helper `scaleRectToSource(rect,
  gridW, gridH, srcW, srcH)`.
- `apps/mobile/src/scanner/detect/quality.ts` —
  `computeQualityMetrics(gradientField, gray, rect, gridW, gridH,
  options)`. Pure.
- `apps/mobile/src/scanner/detect/crop.ts` —
  `cropAndNormalize(pixels, srcW, srcH, rect, tensorSize)`. Pure.
  Returns a `Float32Array` of length `tensorSize²·3` normalised
  per the `mobilenet_v3` recipe.
- `apps/mobile/src/scanner/detect/detect.ts` —
  `detectCard(input)` top-level pure function. Composes the steps
  above and returns a `DetectionResult`. Declared `'worklet'` so
  the JSI runtime can call it directly.

### Frame-processor adapter

- `apps/mobile/src/scanner/detect/frame-processor.ts` —
  `useDetectFrameProcessor(options)` hook returning a memoized
  `ReadonlyFrameProcessor`. Mirrors the camera task's
  `useScanFrameProcessor` shape and re-uses its throttle gate
  (`shouldEmitFrame` + `createFrameThrottleState`). The worklet
  body pulls pixels off the frame (`frame.toArrayBuffer()`), runs
  `detectCard()`, and forwards a `DetectionEvent` to the JS thread
  via `useRunOnJS`.
- `apps/mobile/src/scanner/detect/detect-sink.ts` —
  `createDetectionSink()`. The JS-side bus the worklet hops onto.
  Subscribe / unsubscribe with the same posture
  `createFrameTelemetrySink()` uses.

### Public surface

- `apps/mobile/src/scanner/detect/index.ts` — barrel re-exporting
  the public functions and types. External consumers
  (T-SC-MATCH) import only from the barrel.

### Tests

- `apps/mobile/src/scanner/detect/__tests__/grayscale.test.ts`
- `apps/mobile/src/scanner/detect/__tests__/gradient.test.ts`
- `apps/mobile/src/scanner/detect/__tests__/rectangle.test.ts`
- `apps/mobile/src/scanner/detect/__tests__/quality.test.ts`
- `apps/mobile/src/scanner/detect/__tests__/crop.test.ts`
- `apps/mobile/src/scanner/detect/__tests__/detect.test.ts`
- `apps/mobile/src/scanner/detect/__tests__/detect-sink.test.ts`
- `apps/mobile/src/scanner/detect/__tests__/frame-processor.test.ts`

Target: **35–45 net-new vitest tests**.

## Acceptance criteria

- [ ] `detectCard()` on a synthetic frame with a known
      portrait-aspect card rect returns a rect within ±5 % of the
      ground-truth bounds and `accepted: true`.
- [ ] Detection on a uniform-grey frame (no edges) returns
      `accepted: false` with a sharpness reading at the floor.
- [ ] A frame whose mean luminance is below
      `QUALITY_BRIGHTNESS_MIN` returns `accepted: false` with
      `quality.brightnessOK === false`.
- [ ] A frame whose mean luminance is above
      `QUALITY_BRIGHTNESS_MAX` returns `accepted: false` with
      `quality.brightnessOK === false`.
- [ ] A frame containing a landscape-oriented card-shaped rect
      returns `accepted: false` with `quality.aspectOK === false`.
- [ ] A frame whose detected rect aspect falls outside
      `[CARD_ASPECT_MIN, CARD_ASPECT_MAX]` (e.g. square, or very
      tall sliver) returns `accepted: false`.
- [ ] When `accepted: true`, `cropped` is a `Float32Array` of
      length `224·224·3` with values inside `[-1.0, +1.0]` (the
      mobilenet_v3 normalisation range).
- [ ] When `accepted: false`, `cropped` is `null` — the embedding
      stage is short-circuited.
- [ ] The mobilenet_v3 normalisation result matches the published
      embed-stage helper byte-for-byte (regression test against
      `apps/mobile/src/scanner/embed/embed.ts`'s recipe).
- [ ] `useDetectFrameProcessor()` returns a memoized
      `ReadonlyFrameProcessor`. Two renders with the same options
      return the same processor reference.
- [ ] The worklet body never calls `async`, never closes over
      module-level state mutably except through the shared throttle
      state object (mirrors the camera task's posture).
- [ ] All paths run on-device — no network calls, no `fetch`, no
      module imports outside `apps/mobile/src/scanner/detect/`
      (other than `react`, `react-native-vision-camera`, and
      `react-native-worklets-core`).
- [ ] `pnpm --filter @binderly/mobile lint` passes with
      `--max-warnings=0`.
- [ ] `pnpm --filter @binderly/mobile typecheck` passes.
- [ ] `pnpm --filter @binderly/mobile test` passes; ≥ 35 net-new
      tests under `apps/mobile/src/scanner/detect/`.
- [ ] `pnpm build` passes turbo-wide.

## Out of scope

- **Full perspective correction** (quadrilateral detection +
  homography warp). v1 axis-aligned crop is sufficient for the
  MobileNetV3 embed model's robustness; quadrilateral / homography
  is a future task once we have real-world miss data.
- **Auto-rotation on detected landscape orientation.** v1 rejects
  landscape frames at the quality gate; the user re-frames. Future
  improvement: detect 90° rotation, rotate the crop tensor in-place.
- **Stack-mode geometry-stability algorithm.** The camera task
  exposes a `StackModeDetector` placeholder; the real algorithm
  lands in T-SC-MATCH (which has more context: it knows the
  *previous accepted rect* across consecutive frames).
- **The actual embed call.** T-SC-EMBED-MODEL already ships
  `embed()`; T-SC-MATCH wires `detectCard().cropped` to
  `handle.embed(frame)`.
- **Native-module path** (Swift / Kotlin frame-processor plugin)
  for raw pixel-buffer access. Not needed at the v1 budget; if
  on-device profiling shows we're over budget, file a follow-up
  to ship the native fast-path.
- **JP card variants.** Same shape and aspect; no variant work
  needed at this layer.

## Branch & PR

- Branch: `agent/T-SC-DETECT`
- PR title: `feat(mobile): T-SC-DETECT — card detection + quality gate`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and surface to orchestrator if:

- The pure-JS gradient projection turns out to be more than ~30 ms
  per frame on a Pixel 6-class device (we can't measure here in
  the sandbox; file a follow-up if Pablo's smoke test surfaces it).
- The mobilenet_v3 normalisation recipe drifts between
  `scanner/embed/embed.ts` and our local copy (the regression test
  catches it; surface as a Q-NNN if the embed module's recipe
  changes deliberately).
- vision-camera's `Frame.toArrayBuffer()` shape differs from the
  documented `HWC uint8 RGB` we read (vision-camera 4.6.x ships
  this; if it ever returns BGRA on iOS, we add an RGB swap step).

## Notes from execution

- **Path taken: pure-JS, gradient-projection rectangle detection
  on the worklet thread.** No native module. No new mobile-app
  runtime dependencies. Implementation lives entirely in
  `apps/mobile/src/scanner/detect/`.
- **No new dependencies added** to `apps/mobile/package.json`. The
  detection module uses only `react` (already present),
  `react-native-vision-camera` (already present, pinned `4.6.4`),
  and `react-native-worklets-core` (already present, pinned
  `1.5.0`).
- **`pnpm-lock.yaml` unchanged.** Lockfile conflict with the
  parallel sibling worker (T-SC-ANN-INDEX) is therefore
  structurally impossible from this task's side.
- **Test count: 42 net-new vitest tests** under
  `apps/mobile/src/scanner/detect/__tests__/`. All green.
- **Mobilenet_v3 normalisation recipe** mirrored locally in
  `crop.ts` rather than imported from `scanner/embed/`. The
  cross-module regression test in
  `__tests__/crop.test.ts` round-trips a synthetic byte through
  both helpers and asserts byte-for-byte equality. If the embed
  module's recipe ever shifts, this test fails loudly.
- **Quality-gate ordering matters**: we compute the rect *first*,
  then run quality metrics inside the rect. A blurry-but-centered
  card therefore reports its real sharpness (low) rather than
  the whole-frame average (which would be dragged up by
  background detail).
- **Perspective correction explicitly deferred.** PROJECT.md § 11
  pipeline diagram lists "perspective-correct crop to a normalized
  245×342 RGB tensor" — we ship axis-aligned `224×224` instead
  because (a) MobileNetV3-Small takes `224×224×3`, not
  `245×342×3`, and (b) homography + bilinear resampling in pure JS
  is genuinely expensive vs. the budget. The MobileNetV3 embed
  manifold is robust to mild perspective at the level the user
  holds the card; if real-world top-1 accuracy underperforms once
  T-SC-MATCH wires the full pipeline, perspective-correction is a
  follow-up task with a clear seam (`cropAndNormalize` accepts a
  rect; a future overload can accept a quad).
