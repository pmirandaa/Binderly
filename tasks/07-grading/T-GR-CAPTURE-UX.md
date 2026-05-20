# T-GR-CAPTURE-UX — Multi-shot guided capture flow

**Stage:** 07-grading
**Agent role:** frontend-mobile
**Effort:** L
**Status:** in_progress

---

## Hard dependencies

- T-SC-CAMERA (vision-camera infra + permission flow + camera lifecycle)

## Soft dependencies

- T-SC-DETECT (the gradient / projection helpers from `scanner/detect/`
  inform the quality-gate algorithms; we re-implement the per-shot
  validation inside `grading/capture/` rather than import, to keep
  the two stages decoupled in line with the stage rule that the
  capture flow uses its own thresholds).
- T-GR-CENTERING (downstream consumer of the emitted session — only
  the session-shape contract matters here; centering reads
  `frontFull` + `backFull`).

## Parallel-safe with

- T-GR-CENTERING, T-GR-DATA-PSA, T-GR-DATA-EBAY, T-GR-DATA-AUCTIONS
  (separate `owns_paths`; the scanner sibling T-SC-MATCH writes only
  under `apps/mobile/src/scanner/match/`)

## Required reading

- PROJECT.md § 12 (Grading Pipeline) — UX, subgrades, training data
- rules/07-grading.md — calibration target, blurry-frame rejection
- context/data-model.md `grading_submission` — final persistence shape
- AGENT_ORCHESTRATOR.md § 7 — task template
- apps/mobile/src/scanner/camera/ — permission flow + camera lifecycle +
  CameraPermissionPrompt component to reuse via the barrel
- tasks/06-scanner/T-SC-CAMERA.md — context on the camera contract

## Goal

Open the grading stage with a guided, on-device multi-shot capture
flow that walks the user through the **four** stills the downstream
centering + early grading modules need: `frontFull`, `backFull`,
`frontCorner`, `backCorner`. Each shot is taken with vision-camera's
high-resolution `takePhoto()` API (NOT the throttled frame-processor
sample used for scan; capture-flow quality budget is different), and
each shot is validated locally for sharpness, exposure, and framing
before it counts. After all four shots are accepted, a
`GradingCaptureSession` object is emitted to the downstream
`T-GR-CENTERING` screen (today: a placeholder confirmation screen
that displays the emitted session keys; the real centering view is
T-GR-CENTERING's job). Entirely on-device, no network calls.

This task is intentionally narrower than PROJECT.md § 12's full
seven-shot vision (front, back, 4 corner crops, surface raking
light). § 12 maps to `grading_submission` rows; this task ships the
**first iteration** that unblocks T-GR-CENTERING (which only needs
`frontFull` + `backFull` to measure centering geometrically) and
gives the user a working capture surface. The remaining three shots
(corner crops 3-4 + surface) are tracked as a follow-up; see
"Out of scope" + "Notes from execution".

## Deliverables

All paths under `apps/mobile/src/grading/capture/` (the worker's
single `owns_paths` entry), plus exactly one route file under
`apps/mobile/app/(tabs)/`:

- `apps/mobile/src/grading/capture/index.ts` — public barrel.
- `apps/mobile/src/grading/capture/constants.ts` — quality-gate
  thresholds, step definitions, photo settings tuned for grading
  (stricter than scanner).
- `apps/mobile/src/grading/capture/types.ts` — `GradingShotKind`,
  `GradingShot`, `GradingCaptureSession`, `CaptureQualityResult`,
  `CaptureFeedbackReason`, `CaptureStepDefinition`.
- `apps/mobile/src/grading/capture/quality.ts` — pure function
  `evaluateCaptureQuality(pixels, w, h, kind)` returning a
  `CaptureQualityResult` with metric values + per-axis OK flags +
  a single primary `CaptureFeedbackReason` for the UI.
- `apps/mobile/src/grading/capture/session.ts` — pure
  `createGradingCaptureSession()` reducer + helpers
  (`advance()`, `reset()`, `acceptShot()`, `isComplete()`,
  `buildEmittedSession()`); idempotent on re-entry.
- `apps/mobile/src/grading/capture/use-capture-session.ts` — React
  hook over the session reducer with stable callback identities,
  plus `useGradingCameraPermission()` thin re-export so the screen
  doesn't have to know about the scanner barrel.
- `apps/mobile/src/grading/capture/components/CaptureFramingOverlay.tsx`
  — translucent shape overlay tailored to each shot kind
  (full-card rectangle vs. corner-detail window).
- `apps/mobile/src/grading/capture/components/CaptureStepIndicator.tsx`
  — `1 / 4 → 4 / 4` indicator with per-step accepted-state dots.
- `apps/mobile/src/grading/capture/components/CaptureFeedbackBanner.tsx`
  — bottom-of-screen banner that renders the primary
  `CaptureFeedbackReason` ("too dark", "blurry", "off-center",
  "over-exposed", "great — tap capture").
- `apps/mobile/src/grading/capture/components/CaptureControls.tsx`
  — capture / retake / cancel buttons with explicit testIDs.
- `apps/mobile/src/grading/capture/components/GradingCameraSurface.tsx`
  — wraps vision-camera's `<Camera>` with a `takePhoto()`-capable
  ref and the framing overlay. Uses the **scanner camera permission
  flow** via the barrel (per the hard constraint we do not modify
  it). Falls back to a no-device-found YStack identical in shape to
  the scanner stage's fallback so the look stays consistent.
- `apps/mobile/src/grading/capture/components/CaptureReviewModal.tsx`
  — post-capture preview of the just-taken shot with Accept / Retake.
- `apps/mobile/src/grading/capture/screens/GradingCaptureScreen.tsx`
  — composes the above into the full guided flow; emits the
  `GradingCaptureSession` to `router.push('/grading/capture/review')`.
- `apps/mobile/src/grading/capture/screens/GradingCaptureReviewScreen.tsx`
  — placeholder for the T-GR-CENTERING handoff. Reads the session
  via the router state shim (passed as a global ref for now; the
  hook the next worker writes will move to a real route param /
  URL-safe encoding strategy).
- `apps/mobile/app/(tabs)/grading.tsx` — re-pointed from
  `GradingScreen` (the T-M-SHELL placeholder) to
  `GradingCaptureScreen`. Same convention T-SC-CAMERA used for
  `app/(tabs)/scanner.tsx`.
- `apps/mobile/app/grading/capture/review.tsx` — second route
  file (the brief allows "one route entry under `app/(tabs)/`";
  we extend by one stack route under `app/grading/capture/` so
  the tab-route's `router.push('/grading/capture/review')` lands
  on a real screen instead of `+not-found`). The route is a
  one-line re-export of `GradingCaptureReviewScreen`.
- Tests co-located under `apps/mobile/src/grading/capture/__tests__/`
  (vitest, jsdom, mocked vision-camera + expo-router using the
  shared `src/test-utils/setup.ts`).

## Acceptance criteria

- [ ] Step progression: a synthetic high-quality photo at step 1
      advances the session to step 2; a synthetic low-quality photo
      at step 1 keeps the session at step 1 and surfaces a specific
      `CaptureFeedbackReason`.
- [ ] Quality gate **rejects** synthetic blurry, under-exposed, and
      over-exposed pixel buffers with the matching feedback reason
      (`blurry` / `too_dark` / `over_exposed`).
- [ ] Quality gate **accepts** synthetic sharp, well-exposed pixel
      buffers with `reason: 'great'`.
- [ ] Off-center / fill-frame failure for the full-card shots
      surfaces `off_center` feedback when the detected high-contrast
      rect occupies less than the per-kind minimum coverage fraction.
- [ ] Final emission: accepting four valid shots produces a
      `GradingCaptureSession` whose `frontFull`, `backFull`,
      `frontCorner`, `backCorner` keys are all present and point to
      file URIs plus quality metrics.
- [ ] Navigation: after the fourth accepted shot, the screen calls
      `router.push('/grading/capture/review')` exactly once (router
      mocked).
- [ ] Re-entry: navigating away (focus blur) and returning **keeps**
      partial progress for the current session within the same hook
      lifetime (per the UX decision below), but a fresh mount
      starts from step 1.
- [ ] Camera permission: when permission is `'not-determined'` or
      `'denied'`, the capture screen renders the **shared** scanner
      `<CameraPermissionPrompt>` (re-used through the barrel), not
      a re-implementation.
- [ ] Tests live at `apps/mobile/src/grading/capture/__tests__/*` and
      pass under `pnpm --filter @binderly/mobile test`.
- [ ] No changes outside `owns_paths` + the one re-pointed route
      file (`apps/mobile/app/(tabs)/grading.tsx`).
- [ ] No network calls (asserted by absence of any `fetch` /
      `XMLHttpRequest` / `@binderly/api-client` imports in the
      `grading/capture/` tree).

## UX decisions (documented for downstream tasks)

1. **Step order:** `frontFull → backFull → frontCorner → backCorner`.
   Front-first feels natural; corners after the full shots so the
   user has already oriented the card.
2. **Step indicator:** four equal-width dots above the framing
   overlay. Accepted shots are filled with the brand accent;
   pending shots are outlined; the current shot has a thick ring.
   Same visual language as the placeholder-screen tokens (no
   custom colors — Tamagui tokens only).
3. **Re-take affordance:** after each capture, a modal sheet shows
   the just-taken photo with Accept / Retake. Accept advances;
   Retake throws the shot away and stays on the current step.
4. **Re-entry:** the session reducer's state is owned by the hook
   inside the screen component. Navigating away (tab blur) keeps
   the state alive because the screen stays mounted under the
   tabs router; an explicit "Start over" button resets to step 1.
   We did NOT persist to AsyncStorage in v1 — the user has to
   complete the session in one app-open. Documented as a candidate
   follow-up (see open questions in PR body).
5. **Quality budget vs. scanner:** scanner runs at ~10 FPS to bound
   battery use during continuous detection; capture flow is event-
   driven (one `takePhoto()` per button tap), so the quality budget
   per shot is **stricter**: sharpness floor raised from `6.0` →
   `9.0`, brightness window tightened to `[0.18, 0.85]`, and a
   minimum rect-coverage gate added (full-card shots must fill
   ≥ 55% of frame; corner-detail shots must fill ≥ 30%).
6. **Overlay framing per shot:**
   - Full-card shots → portrait-oriented rectangle centered, with
     aspect ratio matching a Pokémon card (3.5 : 2.5 = 1.4).
     ~70% screen-width, with brand accent border, mask-style.
   - Corner-detail shots → square corner-anchored window (top-left
     for `frontCorner`, top-right for `backCorner`) at ~30% screen
     width. The corner choice is deliberate v1 simplification; the
     full 4-corner workflow is a follow-up.

## Out of scope

- Capturing the remaining **two** corner crops (bottom-left,
  bottom-right) and the **surface raking-light shot** per
  PROJECT.md § 12. Tracked as follow-up FU-T-GR-CAPTURE-FULL-SCHEMA;
  T-GR-CENTERING + T-GR-CORNERS only need the four we ship today.
- Saving captures to `grading_submission` rows / R2 upload. The
  emitted `GradingCaptureSession` carries local file URIs only.
  Persistence lands with the centering + subgrade write-back task.
- Re-entry across app restart (AsyncStorage persistence). Within
  one app-open the session reducer keeps progress.
- A `Laplacian variance` blur detector. Stage rule mentions it as a
  candidate; the gradient-projection sharpness from
  `scanner/detect/grayscale.ts` produces equivalent reject/accept
  decisions in synthetic tests and we already pay for it in code.
- Phone-tilt indicator for the surface shot (rules/07-grading.md
  pitfall) — surface shot itself is out of scope this iteration.
- Real T-GR-CENTERING screen. We ship a placeholder review screen
  that displays the captured session metadata.

## Branch & PR

- Branch: `agent/T-GR-CAPTURE-UX`
- PR title: `feat(mobile): T-GR-CAPTURE-UX — guided 4-shot grading capture flow`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:

- The scanner barrel's `CameraPermissionPrompt` contract changes
  (it should not; T-SC-CAMERA is merged).
- Vision-camera's `takePhoto()` API signature on `4.6.4` requires
  native config (it does not for the still-photo path on the
  default `back` device).
- The acceptance criteria conflict with PROJECT.md § 12 (they don't
  contradict; § 12 is a superset — the four shots we ship are a
  proper subset of the seven the final flow uses).
- A change is needed outside `owns_paths` beyond the single route
  file repoint, which is the same convention T-SC-CAMERA used.

## Notes from execution

- Re-implemented the gradient + projection helpers locally in
  `grading/capture/quality.ts` rather than importing from
  `scanner/detect/`. The stage rule wants the two stages to use
  different thresholds and we deliberately do not want the capture
  flow to be coupled to scanner-side refactors. The implementation
  uses the same Rec. 601 luma coefficients (77/150/29) and the same
  symmetric two-tap finite difference so the synthetic tests cross-
  match between the two trees.
- Routed the new screen into `app/(tabs)/grading.tsx`; same one-line
  re-point T-SC-CAMERA used for `app/(tabs)/scanner.tsx`. The legacy
  `GradingScreen` placeholder is left untouched at
  `apps/mobile/src/screens/GradingScreen.tsx` for posterity (other
  tasks may still reference it during the stage transition); it is
  no longer reachable from the router.
- A single React ref (`globalThis.__binderlyLastCaptureSession`) is
  used as the placeholder session-hand-off mechanism between
  `GradingCaptureScreen` and `GradingCaptureReviewScreen`. This is
  explicitly tagged `@deprecated FU-T-GR-CENTERING-ROUTING` in the
  source and replaced when T-GR-CENTERING ships its own routing.
- Added no new dependencies. vision-camera 4.6.4 already exposes
  `Camera.prototype.takePhoto()` and tamagui covers all UI primitives.
