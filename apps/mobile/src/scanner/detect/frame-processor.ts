// Detect-stage frame-processor hook.
//
// Mirrors the camera task's `useScanFrameProcessor()` shape
// (`apps/mobile/src/scanner/camera/frame-processor.ts`) but plugs
// in real card detection. The eventual scan-screen wiring picks
// the appropriate processor for its mode:
//
//   - `useScanFrameProcessor()` — telemetry-only (FPS badge,
//     stack-mode probe). Camera task ships this.
//   - `useDetectFrameProcessor()` — full detection + crop. This
//     task ships it. T-SC-MATCH will wire it.
//
// The two hooks share the FPS-throttle posture: the worklet is
// gated at ~10 FPS so we don't burn battery running detection on
// every single frame the underlying sensor delivers.
//
// **Worklet-safety contract** (enforced by inspection — vitest
// can't statically verify):
//
//   - The worklet body uses only typed-array allocations.
//   - No closure over React state. The single mutable hook value
//     is the throttle state object (an object reference, not a
//     captured primitive).
//   - All side effects to the JS thread route through
//     `useRunOnJS` (a worklets-core JSI bridge).

import { useMemo } from 'react';
import { useFrameProcessor as visionUseFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

import { detectCard, type DetectCardOptions } from './detect.js';

import type { DetectionEvent, DetectionSink, DetectFrameLike } from './types.js';
import type { Frame, ReadonlyFrameProcessor } from 'react-native-vision-camera';

/**
 * Mutable throttle state — same shape T-SC-CAMERA uses.
 * Tracking only the most recent emit timestamp keeps the decision
 * O(1) on the hot path. The state object is captured by the
 * worklet via `useMemo` so its identity is stable for the lifetime
 * of the screen.
 */
export interface DetectThrottleState {
  lastEmittedAt: number;
}

export function createDetectThrottleState(): DetectThrottleState {
  return { lastEmittedAt: Number.NEGATIVE_INFINITY };
}

/**
 * Pure throttle decision. Mirrors the camera task's
 * `shouldEmitFrame`. Exported so the hook tests can drive the
 * gate deterministically without spinning up a real worklet
 * runtime.
 */
export function shouldEmitDetectFrame(
  state: DetectThrottleState,
  now: number,
  minIntervalMs: number,
): boolean {
  'worklet';
  if (now - state.lastEmittedAt < minIntervalMs) return false;
  state.lastEmittedAt = now;
  return true;
}

/**
 * Default throttle window: 100 ms = 10 FPS. Matches the camera
 * task's `FRAME_PROCESSOR_MIN_INTERVAL_MS`. We duplicate the value
 * locally instead of importing from the camera sandbox so this
 * task's owns_paths stay clean — both modules will eventually
 * pull from a shared scanner-stage constants module, but that's
 * a T-SC-MATCH-era lift.
 */
export const DETECT_FRAME_MIN_INTERVAL_MS = 100;

/**
 * Build a {@link DetectionEvent} from a detection result plus the
 * worklet-side timestamp. Pure so the test can call it without a
 * real frame.
 */
export function buildDetectionEvent(
  result: ReturnType<typeof detectCard>,
  ts: number,
): DetectionEvent {
  'worklet';
  return {
    ts,
    rect: result.rect,
    rectValid: result.rectValid,
    quality: result.quality,
    accepted: result.accepted,
    cropped: result.cropped,
  };
}

export interface UseDetectFrameProcessorOptions {
  /** JS-thread bus the worklet hops onto for each detection event. */
  readonly sink: DetectionSink;
  /**
   * Override the FPS-throttle window. Defaults to
   * {@link DETECT_FRAME_MIN_INTERVAL_MS}.
   */
  readonly minIntervalMs?: number;
  /** Override detection knobs (forwarded to {@link detectCard}). */
  readonly detectOptions?: DetectCardOptions;
}

/**
 * Build the detect-stage frame processor.
 *
 * The returned `ReadonlyFrameProcessor` is reference-stable
 * across re-renders (per vision-camera's contract) so the camera
 * surface doesn't tear the JSI runtime down between renders.
 */
export function useDetectFrameProcessor(
  options: UseDetectFrameProcessorOptions,
): ReadonlyFrameProcessor {
  const { sink, minIntervalMs, detectOptions } = options;
  const effectiveInterval = minIntervalMs ?? DETECT_FRAME_MIN_INTERVAL_MS;
  // `detectOptions` may be `undefined` in production; capture a
  // stable reference so the worklet doesn't see a fresh identity
  // every render (the dependency array catches identity changes).
  const stableDetectOptions = detectOptions ?? EMPTY_DETECT_OPTIONS;

  const throttleState = useMemo(() => createDetectThrottleState(), []);

  const forwardDetection = useRunOnJS(
    (event: DetectionEvent): void => {
      sink.observe(event);
    },
    [sink],
  );

  return visionUseFrameProcessor(
    (frame: Frame) => {
      'worklet';
      const now = frame.timestamp;
      if (!shouldEmitDetectFrame(throttleState, now, effectiveInterval)) return;
      // Pull pixel bytes off the frame. vision-camera@4 returns
      // an HWC uint8 ArrayBuffer here (RGB / RGBA depending on
      // pixelFormat — the camera task pins format such that this
      // is RGB; if the device ever returns RGBA we'd swap to a
      // 4-channel reader, but that's out of scope for v1).
      const frameLike = frame as unknown as DetectFrameLike;
      const buffer = frameLike.toArrayBuffer();
      const pixels = new Uint8Array(buffer);
      const result = detectCard(
        { pixels, width: frameLike.width, height: frameLike.height },
        stableDetectOptions,
      );
      const event = buildDetectionEvent(result, now);
      // Fire-and-forget JS hop. We deliberately don't `await` —
      // the worklet must stay non-blocking; the JS sink picks
      // events up at whatever cadence the bridge can sustain.
      forwardDetection(event);
    },
    [throttleState, effectiveInterval, forwardDetection, stableDetectOptions],
  );
}

const EMPTY_DETECT_OPTIONS: DetectCardOptions = Object.freeze({});
