# T-SC-UX — Scanner screen + match-result UI + stack-mode review

**Stage:** 06-scanner
**Agent role:** frontend-mobile
**Effort:** L
**Status:** in_progress

## Hard dependencies

- **T-SC-MATCH** (merged — PR #78) — `apps/mobile/src/scanner/match/`
  exposes `useScanner({ detectionSink, embedCrop, searchKNN, config? })`
  returning `{ sink: MatchSink, queue: MatchQueue, isMatching, config }`.
  `MatchResult` shape: `{ printingId, confidence, topGap, disposition,
  candidates, stabilityCount, framesSinceMatch, emittedAtMs }`.
  Constants: `MATCH_AUTO_ADD_SCORE = 0.78`, `MATCH_DISAMBIG_SCORE = 0.55`,
  `MATCH_STABILITY_COUNT = 3`, `MATCH_STACK_RESET_MS = 350`,
  `MATCH_QUEUE_CAP = 32`.
- **T-M-COLLECTION** (merged) — `@binderly/api-client` exposes
  `client.collection.addCollectionItem({ printingId, source?, notes? })`
  → `CollectionItemDto` and `client.collection.deleteCollectionItem({ id })`
  → `void`. Used for the undo flow (add-then-delete-on-timeout).

## Soft dependencies

- **T-SC-EMBED-MODEL** (merged) — `apps/mobile/src/scanner/embed/`
  exposes `loadEmbeddingModel(opts)` → `EmbeddingModelHandle`.
- **T-SC-ANN-INDEX** (merged) — `apps/mobile/src/scanner/ann/`
  exposes `loadAnnIndex(opts)` → `AnnIndexHandle`.
- **T-SC-CAMERA** (merged) — `apps/mobile/src/scanner/camera/` provides
  `<CameraPreview>`, `useCameraPermissionFlow`, `useCameraActive`,
  `createFrameTelemetrySink`, `createStackModeDetector`, `FpsDebugBadge`.

## Required reading

- `PROJECT.md` § 11 (Scanner Pipeline)
- `rules/06-scanner.md` — sub-1.5s target, FP < 0.5%, undo non-negotiable,
  disambiguation < 300ms, stack-mode reset heuristic, battery posture.
- `tasks/06-scanner/T-SC-MATCH.md` — confidence gate params, stack-mode FIFO,
  `embedCrop` adapter contract, `MatchResult` shape.
- `apps/mobile/src/scanner/match/` — `types.ts`, `constants.ts`, `use-scanner.ts`.
- `apps/mobile/src/scanner/camera/` — camera infrastructure to reuse.
- `apps/mobile/src/grading/capture/` — structural pattern for pure-module +
  hook + components + screen organisation.

## Goal

Ship the continuous-scan screen UX that closes Stage 06. The read-path is
already complete (T-SC-MATCH, PR #78); this task adds the view layer on top:

1. **Model loader** — async-loads the embedding model and ANN index on screen
   mount and exposes a typed state machine to the screen (`idle → loading →
   ready | error`).
2. **Live-scan overlay** — subscribes to the `MatchSink` emitted by
   `useScanner()`; renders an auto-add confirmation, a disambiguation picker,
   or a "hold steady" hint depending on `disposition` and confidence.
3. **Stability indicator** — visual countdown of the 3-frame stability gate
   so the user knows the scanner is tracking the card.
4. **Undo affordance** — every auto-add silently adds the card and shows a
   5-second undo toast. The undo path calls `deleteCollectionItem` and removes
   the item from the session queue.
5. **Stack panel** — when the user taps "Done", flips the screen into a
   review mode where they inspect every auto-added card in the session and
   optionally discard individual items. Tapping "Commit" fires the remaining
   collection writes and resets the session.
6. **Loading / error states** — show a spinner and copy while models warm up;
   show a recoverable error screen if loading fails.
7. **Auth gate** — the scanner requires a signed-in user (`<ProtectedScreen>`
   wraps the camera + UX layer).

## Deliverables

### `apps/mobile/src/scanner/ui/` — pure UI components (new tree)

- `types.ts` — UI-local types (`ScannerPhase`, `ModelLoadState`, `SessionItem`,
  `UndoEntry`).
- `MatchOverlay.tsx` — floating card shown when `disposition === 'auto-add'`;
  displays printing name + set + number + thumbnail placeholder.
- `DisambigPicker.tsx` — bottom sheet with top-3 candidates; user taps to
  confirm one, which fires the same auto-add path.
- `StabilityIndicator.tsx` — a row of 3 dots animating from empty → filled
  as `stabilityCount` increases. Accessibility-labelled.
- `UndoToast.tsx` — transient banner with count-down and "Undo" button.
- `SessionFooter.tsx` — "N cards added — Done" bar at the bottom of the live
  camera view. Zero-count state shows nothing.
- `ScannerLoading.tsx` — full-screen spinner with "Preparing scanner…" copy.
- `ScannerError.tsx` — full-screen error with retry button.
- `StackPanel.tsx` — scrollable list of session items with per-item discard;
  "Commit" / "Discard all" actions at the bottom.
- `index.ts` — public barrel.
- `__tests__/` — RTL + unit tests.

### `apps/mobile/src/screens/scan/` — screen orchestration (existing tree; extended)

- `use-model-loader.ts` — hook that calls `loadEmbeddingModel` +
  `loadAnnIndex` and returns `ModelLoadState`.
- `use-scanner-session.ts` — pure state-machine + hook for the session
  (queue snapshot, undo entries, phase: `scanning | stack-review`).
- `ScanScreen.tsx` — replaces the existing thin shell with the full UX.
  Composes `<ProtectedScreen>`, camera infra, `useScanner()`, overlays.
- `index.ts` — re-exports (already exists; update as needed).

### `apps/mobile/app/(tabs)/scanner.tsx` — already points to correct path

No change needed; already imports `ScanScreen` from
`../../src/screens/scan/index.js`.

**Authorisation note:** `apps/mobile/app/(tabs)/scanner.tsx` is outside the
declared `owns_paths` in `dependencies.yaml`. No modification was required;
the file already routes to the correct screen. This is documented per the
orchestrator's instruction in the dispatch prompt.

## Acceptance criteria

- [ ] `ScanScreen` renders a loading state while the embedding model and ANN
      index load; renders an error state with a retry CTA if loading fails.
- [ ] `ScanScreen` is wrapped with `<ProtectedScreen>` (unauthenticated
      users are redirected to `/auth/sign-in`).
- [ ] Camera permission pre-prompt, denied, and restricted branches all render
      correctly (re-uses `<CameraPermissionPrompt>` from scanner/camera).
- [ ] When `useScanner()` emits a `MatchResult` with
      `disposition === 'auto-add'`, the `<MatchOverlay>` appears and
      `client.collection.addCollectionItem` is called with the `printingId`.
- [ ] After auto-add, a 5-second `<UndoToast>` appears; pressing "Undo"
      calls `deleteCollectionItem` and removes the item from the session.
- [ ] When `disposition === 'disambiguate'`, `<DisambigPicker>` appears with
      top-3 candidates; tapping one confirms the add.
- [ ] `<StabilityIndicator>` reflects the current `stabilityCount` (0–3
      filled dots).
- [ ] `<SessionFooter>` shows the live count of committed session items;
      tapping "Done" transitions to `phase === 'stack-review'`.
- [ ] `<StackPanel>` lists every committed item; per-item "Remove" discards
      it; "Commit all" closes the panel and resets the session.
- [ ] `<ScannerLoading>` and `<ScannerError>` render under `testID`s and
      pass RTL assertions.
- [ ] `use-scanner-session.ts` pure reducers have unit tests covering:
      enqueue, undo-enqueue, discard-item, flush/commit, cap enforcement.
- [ ] RTL tests mock `useScanner()` and drive auto-add / disambig flows
      without mounting real vision-camera.
- [ ] `scanner/ui/` tree has a `network-isolation.test.ts` confirming no
      `fetch` / `XMLHttpRequest` / `@binderly/api-client` imports in the
      pure-component layer.
- [ ] `pnpm --filter @binderly/mobile lint typecheck test build` exits 0.
- [ ] `pnpm lint typecheck test build` (workspace root) exits 0.
- [ ] No changes outside `apps/mobile/src/scanner/ui/`,
      `apps/mobile/src/screens/scan/`.
- [ ] No new npm dependencies added.
- [ ] All interactive elements have `accessibilityLabel` and
      `accessibilityRole` where appropriate.

## Out of scope

- **Native SIMD ANN inner loop** — #FU-29 / T-SC-ANN-NATIVE.
- **Calibrated confidence thresholds** — #FU-30 (needs labeled real-phone
  scan set).
- **Per-language index / model swap** — JP catalog is out of v1 beta.
- **Actual binary model + index asset bundling** — the loaders accept any
  `ArrayBuffer`; the real assets are fetched from R2 at runtime and managed
  by the expo-updates/asset system (out of scope here). The screen-level hook
  provides a testable seam for this.
- **Sentry integration** — error events can be added in a follow-up.
- **Debug overlay HUD** — a future scanner-settings surface can consume
  `classifyConfidence` + `FpsDebugBadge` exposed by the existing barrels.

## Branch & PR

- Branch: `agent/T-SC-UX`
- PR title: `feat(mobile): T-SC-UX — scanner screen, match overlay, stack-mode review`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:
- The `loadEmbeddingModel` / `loadAnnIndex` APIs require mandatory binary
  assets that cannot be reasonably stubbed for tests.
- The `@binderly/api-client` `addCollectionItem` shape diverges from what
  the task brief describes (the brief is based on T-M-COLLECTION's merged PR).
- A product decision about the commit/undo flow is required.

## Notes from execution

**Out-of-owns-paths touch (authorised):** `apps/mobile/app/(tabs)/scanner.tsx`
already imports `ScanScreen` from the correct path (`../../src/screens/scan/
index.js`) — no edit was needed. The orchestrator dispatch prompt authorised
touching the file if required; it was not required.

**Model loader stub:** The embedding model and ANN index require R2-hosted
binary assets that are not bundled in the repo. The `use-model-loader.ts`
hook is written against the public `loadEmbeddingModel` / `loadAnnIndex`
interfaces but is tested with dependency-injected stubs so CI passes without
real binary files.

**embedCrop adapter:** Per T-SC-MATCH notes, the `EmbeddingModelHandle.embed()`
takes `EmbedFrameInput` (raw uint8 RGB), not the detect-stage's Float32 crop.
The adapter is wired in `ScanScreen` where both handles are colocated:
```ts
const embedCrop = useCallback(
  async (crop: Float32Array): Promise<Float32Array> => {
    const buf = crop.buffer;
    const w = Math.round(Math.sqrt(crop.length / 3));
    return embedModelHandle.embed({
      width: w, height: w,
      toArrayBuffer: () => buf,
    });
  },
  [embedModelHandle],
);
```

**Network isolation scope:** `scanner/ui/` pure components are network-free
and have a `network-isolation.test.ts`. The screen layer (`screens/scan/`)
necessarily imports `@binderly/api-client` for collection writes (undo + commit).

**Follow-ups raised:** #FU-34 (see PR body and status.md Known follow-ups).
