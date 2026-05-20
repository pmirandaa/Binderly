# T-SC-CAMERA — Camera + frame processor infrastructure (vision-camera)

**Stage:** 06-scanner
**Agent role:** frontend-mobile
**Effort:** M
**Status:** in_review

## Hard dependencies

- T-M-SHELL (Expo app shell, navigation, tab routes, screen test
  posture).

## Soft dependencies

- T-SC-EMBED-MODEL (runs in parallel; owns
  `apps/mobile/src/scanner/embed/`; no shared files).
- T-SC-DETECT will consume the `processFrame()` worklet seam shipped
  here.

## Required reading

- `PROJECT.md` § 11 (Scanner Pipeline).
- `rules/06-scanner.md` (stage rules — battery, on-device, FPS, blur
  release, version pinning).
- `context/tech-stack.md` (vision-camera + fast-tflite versions, Expo
  SDK 52, React Native 0.76).
- `apps/mobile/` — match the shell conventions (T-M-SHELL,
  T-M-BROWSE, T-M-COLLECTION).
- VisionCamera v4 [Frame Processors guide](https://mrousavy.com/react-native-vision-camera/docs/guides/frame-processors)
  and `react-native-worklets-core` README.

## Goal

Ship the **infrastructure** that the rest of the scanner stage
(T-SC-DETECT, T-SC-MATCH, T-SC-UX) will build on. That means: camera
permission flow, `react-native-vision-camera` v4 wiring with a pinned
version, an FPS-capped frame-processor worklet that already routes a
placeholder telemetry event to JS, a release-on-blur lifecycle hook,
a stack-mode ring buffer + reset-signal seam, and a scan screen shell
that hosts the camera. Card detection, embedding, and the
continuous-add UX are explicitly **out of scope**.

The placeholder worklet `processFrame(frame)` is the seam T-SC-DETECT
will overwrite. It stays narrow and well-typed so the rest of the
pipeline can dock onto it without re-plumbing.

## Deliverables

### Camera permission + privacy

- `apps/mobile/app.json` — `ios.infoPlist.NSCameraUsageDescription`
  (user-facing copy, not technical), `android.permissions` (camera
  declared), and the `react-native-vision-camera` config plugin entry
  with `enableFrameProcessors: true`.
- `apps/mobile/src/scanner/camera/permissions.ts` — typed
  `CameraPermissionStatus` and `useCameraPermissionFlow()` hook
  wrapping vision-camera's `useCameraPermission()`. Exposes the three
  branches the UI cares about: `granted`, `denied`, `not-determined`.
- `apps/mobile/src/scanner/camera/components/CameraPermissionPrompt.tsx`
  — pre-prompt screen explaining *why* before triggering the OS
  dialog. Renders in `not-determined` and `denied` branches with
  different copy and CTAs.

### Vision-camera v4 integration

- `apps/mobile/package.json` adds `react-native-vision-camera` and
  `react-native-worklets-core` (the v4 peer required for frame
  processors). Both pinned to exact patch versions to keep the
  worklet API stable.

### Frame processor scaffolding

- `apps/mobile/src/scanner/camera/constants.ts` —
  `TARGET_FRAME_RATE_FPS = 10`, ring buffer size, stack-reset gap.
  Documented as the source-of-truth knobs.
- `apps/mobile/src/scanner/camera/types.ts` — `FrameTelemetryEvent`,
  `StackModeSignal`, `FrameProcessorContext`.
- `apps/mobile/src/scanner/camera/frame-processor.ts` —
  `createScanFrameProcessor()` returns a worklet that invokes a
  placeholder `processFrame(frame)` worklet and uses `runOnJS` to
  forward a small telemetry event (`{ ts, width, height,
  bytesPerRow }`) to JS. No image bytes leave the worklet thread.
- `apps/mobile/src/scanner/camera/frame-telemetry.ts` —
  `createFrameTelemetrySink()`: small JS-side ring of recent event
  timestamps; computes a sliding-window FPS for the debug badge and
  exposes a subscription API for components.

### Stack-mode reset heuristic placeholder

- `apps/mobile/src/scanner/camera/ring-buffer.ts` — generic typed
  ring buffer (capacity, push, snapshot, clear).
- `apps/mobile/src/scanner/camera/stack-mode.ts` —
  `createStackModeDetector()` returns `{ observe(event),
  signal(): 'stable' | 'reset' }`. The algorithm is the T-SC-DETECT
  placeholder (always `'stable'`); ring buffer + the reset window
  contract are real and tested.

### Camera lifecycle

- `apps/mobile/src/scanner/camera/camera-lifecycle.ts` —
  `useCameraActive()` returns `true` only when the scan screen is
  focused (Expo Router `useIsFocused`) **and** the app is in the
  foreground (`AppState`). Used as the `Camera.isActive` prop so the
  camera releases on blur and on background.

### Components

- `apps/mobile/src/scanner/camera/components/CameraPreview.tsx` —
  wraps `<Camera>` with `frameProcessor`, `device`, `format`,
  `isActive`. Renders a friendly error fallback if no camera device
  is available.
- `apps/mobile/src/scanner/camera/components/FpsDebugBadge.tsx` —
  reads from a `FrameTelemetrySink` and renders a small overlay.
  Hidden by default; opts in via prop. Only used in debug.

### Scan screen

- `apps/mobile/src/screens/scan/ScanScreen.tsx` — hosts permission
  prompt or camera preview, an FPS debug badge (gated on
  `__DEV__`), and a Close button that pops the stack via
  `router.back()`. **Not** the full continuous-add UX — that ships
  later in T-SC-UX.
- `apps/mobile/src/screens/scan/index.ts` — barrel.
- `apps/mobile/app/(tabs)/scanner.tsx` — re-pointed to the new
  `ScanScreen` (the convention `T-M-SHELL` documented for feature
  tasks swapping out placeholder screens).
- `apps/mobile/src/screens/ScannerScreen.tsx` — deleted (placeholder
  removed since the real screen now lives at
  `src/screens/scan/ScanScreen.tsx`).

### Tests

- `permissions.test.ts` — granted / denied / not-determined branches
  and the request flow.
- `ring-buffer.test.ts` — capacity, eviction order, snapshot stability.
- `stack-mode.test.ts` — observe + signal contract; placeholder
  always-stable behaviour; reset-window seam documented.
- `frame-telemetry.test.ts` — sliding-window FPS calculation, subscriber
  lifecycle, clear.
- `frame-processor.test.ts` — given a fake frame source ticking at
  ~10 Hz, the JS-side telemetry sink observes ~10 events/s and never
  more than 11.
- `camera-lifecycle.test.ts` — focus + AppState combine; transitions
  flip `isActive` correctly.
- `CameraPermissionPrompt.test.tsx` — copy + CTA per branch; "Allow"
  triggers `requestPermission`.
- `CameraPreview.test.tsx` — renders the camera when granted; renders
  the no-device fallback when `useCameraDevice('back')` returns null.
- `ScanScreen.test.tsx` — full flow: shows prompt when permission is
  not-determined; shows camera once granted; Close button calls
  `router.back()`.

Target: ~25–35 net-new tests.

## Acceptance criteria

- [ ] `pnpm --filter @binderly/mobile lint`, `typecheck`, and `test`
      all pass.
- [ ] `pnpm --filter @binderly/mobile build` passes (tsc emits no
      diagnostics).
- [ ] Repo-wide `pnpm test` green (no other workspaces touched).
- [ ] `react-native-vision-camera` and `react-native-worklets-core`
      are pinned to exact patch versions in `apps/mobile/package.json`
      and `pnpm-lock.yaml` is in sync.
- [ ] `app.json` declares:
      - `ios.infoPlist.NSCameraUsageDescription` with user-facing copy.
      - `android.permissions` includes `android.permission.CAMERA`.
      - `react-native-vision-camera` config plugin entry with
        `cameraPermissionText` set.
- [ ] Frame-processor unit test asserts ~10 Hz under a mocked frame
      source.
- [ ] Stack-mode detector signal API exists and is documented as the
      T-SC-DETECT seam.
- [ ] Camera lifecycle hook releases the camera on blur and on
      AppState background. Tested.
- [ ] No frame bytes ever cross `runOnJS` — only the
      `FrameTelemetryEvent` metadata.
- [ ] Tests live under `apps/mobile/src/scanner/camera/` and
      `apps/mobile/src/screens/scan/` and run under
      `pnpm --filter @binderly/mobile test`.

## Out of scope

- Card rectangle detection / perspective correction (**T-SC-DETECT**).
- TFLite embedding inference (**T-SC-EMBED-MODEL** — runs in parallel).
- ANN matching, confidence calibration (**T-SC-ANN-INDEX, T-SC-MATCH**).
- The continuous-add UX, auto-add, disambiguation, undo, session
  footer (**T-SC-UX**).
- User-facing scanner settings (FPS, GPU delegate). Sensible defaults
  ship as constants; a settings surface is a future task.
- Real-device QA. The sandbox has no camera; manual smoke is on Pablo.

## Branch & PR

- Branch: `agent/T-SC-CAMERA`
- PR title: `feat(mobile): T-SC-CAMERA — camera + frame processor infrastructure`
- Commit format: Conventional Commits.

## Escalation triggers

- Vision-camera v4 + Expo SDK 52 native build breaks beyond what a
  pinned version + config plugin can fix → append a Q-NNN with
  options and recommend a fallback version.
- Reanimated 3.16 worklets conflicting with `react-native-worklets-core`
  on device → escalate; both packages are required (Reanimated for
  the rest of the app; worklets-core for vision-camera v4).
- Any need to touch files outside the pre-authorized list (beyond
  what is documented in the PR body) → escalate.

## Notes from execution

- The sandbox cannot run a real camera. Tests mock
  `react-native-vision-camera` and `react-native-worklets-core` via
  `src/test-utils/setup.ts`, asserting the **contract** the on-device
  pipeline relies on (FPS cap, telemetry shape, isActive wiring).
  Pablo runs the manual smoke recipe in the PR body to validate on
  a real device.
- `react-native-vision-camera` pinned to `4.6.4` — the last 4.6.x
  release. 4.6.1 explicitly fixed Android autolinking under React
  Native 0.76 and 4.6.4 layered targeted bug fixes on top without
  introducing the breaking API churn that the 4.7.x line saw against
  newer RN versions. The PR body documents the rationale.
- `react-native-worklets-core` pinned to `1.5.0` — required v4 peer
  for the frame-processor JSI runtime. Coexists with Reanimated 3.16
  (Reanimated has its own internal worklets runtime; the two do not
  conflict at the JSI level, but they require Reanimated's plugin to
  stay listed first in `babel.config.js`).
