# Stage 06 — Scanner rules

Continuous on-device card recognition. Detection → crop → embed → ANN
match → confidence threshold → auto-add or disambiguate. Free per scan.

## Required reading

- `PROJECT.md` § 11 (Scanner Pipeline)
- `context/tech-stack.md` (vision-camera, fast-tflite)
- `context/data-model.md` (`collection_item.source = 'scan'`)

## Hard rules

- **On-device only in MVP.** No frame leaves the phone. Cloud fallback
  is architecturally allowed but not built; keep the seam clean.
- **Sub-1.5s scan-to-add target.** Detection + embed + match should hit
  this on a mid-range phone (e.g., a 3-year-old iPhone or Pixel 6-class
  Android). Tasks measure and report.
- **Auto-add threshold tuned for FP < 0.5%.** Calibration set required;
  T-SC-MATCH owns this.
- **Undo is non-negotiable.** Every auto-add has a 5s undo affordance.
  The collection_item insert is reversible cleanly (delete by id; if
  it was a quantity bump on an existing item, decrement).
- **Disambiguation is fast.** When confidence is below threshold, top-3
  candidates appear in <300ms after the bad-confidence signal. User
  taps once.
- **Stack mode = continuous mode with reset heuristic.** Frame
  processor watches for "card removed from view ≥ 300ms" or "different
  card geometry detected" and treats the next stable frame as a new
  card. No user toggle.
- **Battery behavior.** Frame processor runs at sensible FPS (~10 fps,
  not 60). Camera releases on screen blur. Tested on iOS and Android.

## Conventions specific to this stage

- Frame processor runs in the worklet thread; never call JS-thread-only
  APIs from it. Use the runOnJS bridge sparingly.
- Models live in R2 under `models/{name}/{version}/...` and are
  versioned. Mobile fetches on first launch and on app update.
- ANN index ships as a single binary file (HNSW format); per-language
  variants when we add JP. Total size budget: < 100MB on disk.
- Scan results write through `collection_item.source = 'scan'` with the
  embedding distance and top-K alternatives stored in
  `collection_item.notes` JSON for debugging (move to a dedicated table
  if it gets noisy).

## Common pitfalls

- vision-camera v3 → v4 changed the worklet API; pin a version.
- TFLite GPU delegate availability differs by device; have a CPU
  fallback path.
- iOS camera privacy strings (`NSCameraUsageDescription`) must be
  user-facing, not technical.
- HNSW index loading takes ~100–500ms; preload during scanner screen
  enter, not on first capture.

## Done when

- A user can open the scanner, hold cards in front of the camera, and
  add cards to their collection in a continuous flow.
- Auto-add accuracy ≥ 95% top-1 on a held-out test set of real phone
  photos.
- Auto-add false-positive rate < 0.5% at the chosen threshold.
- Disambiguation flow works for low-confidence cases.
- Undo works.
- Stack mode (continuous flipping) feels fluid in user testing.
