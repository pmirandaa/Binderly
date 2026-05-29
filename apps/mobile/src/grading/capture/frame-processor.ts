// Live capture-quality frame processor (#FU-33).
//
// Today the capture flow is purely event-driven: `attemptCapture`
// runs only on a capture-button tap. This module adds an **optional**
// live sample so the capture button can reflect real-time quality
// (sharpness / brightness / coverage) *before* the user taps —
// "hold steady", "fill the frame", etc.
//
// It mirrors the scanner's frame-processor seam exactly
// (`apps/mobile/src/scanner/camera/frame-processor.ts` +
// `scanner/detect/frame-processor.ts`):
//
//   1. The worklet runs in vision-camera's JSI runtime, throttled to
//      ~10 FPS so we don't burn battery evaluating every sensor frame.
//   2. It pulls the frame's HWC-RGB bytes, runs the **existing**
//      `evaluateCaptureQuality` gate (reused, not re-implemented),
//      and forwards a small {@link CaptureQualityEvent} to JS via the
//      `useRunOnJS` bridge — never the frame bytes (on-device only,
//      per `rules/06-scanner.md`).
//   3. The JS-side {@link CaptureQualitySink} fans the latest result
//      out to subscribers; the screen reads it to drive the button.
//
// **Graceful no-op contract.** Where the native frame processor isn't
// available (jsdom tests, a device the worklet runtime can't reach, a
// pixel format we don't recognise) the worklet simply returns without
// emitting. The sink stays empty, the capture button falls back to its
// tap-driven behaviour, and nothing throws. Tests run without a camera
// for exactly this reason.

import { useMemo } from 'react';
import { useFrameProcessor as visionUseFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

import { evaluateCaptureQuality } from './quality.js';

import type { QualityEvaluationOptions } from './quality.js';
import type { CaptureQualityResult } from './types.js';
import type { Frame, ReadonlyFrameProcessor } from 'react-native-vision-camera';

/**
 * Event the capture worklet forwards to the JS thread. Carries the
 * full {@link CaptureQualityResult} (a small, structurally-cloneable
 * object) plus the worklet-side timestamp — never frame bytes.
 */
export interface CaptureQualityEvent {
  /** Worklet-side timestamp (ms) the frame was sampled at. */
  readonly ts: number;
  readonly quality: CaptureQualityResult;
}

export type CaptureQualityListener = (event: CaptureQualityEvent) => void;

/**
 * Default throttle window: 100 ms = 10 FPS. Matches the scanner's
 * `FRAME_PROCESSOR_MIN_INTERVAL_MS`. We duplicate the value locally
 * (rather than import from the scanner tree) so the capture flow's
 * owns_paths stay self-contained — same convention as
 * `scanner/detect/frame-processor.ts`.
 */
export const CAPTURE_FRAME_MIN_INTERVAL_MS = 100;

/**
 * JS-thread bus the worklet hops onto via `useRunOnJS`. Mirrors the
 * scanner's `DetectionSink` posture — one bus per capture-screen
 * mount; the screen wires it as a `useMemo` so its identity is
 * stable across re-renders.
 */
export interface CaptureQualitySink {
  /** Record a quality sample arriving from the worklet. */
  observe(event: CaptureQualityEvent): void;
  /** Subscribe to samples. Returns an unsubscribe function. */
  subscribe(listener: CaptureQualityListener): () => void;
  /** Most recent quality result, or `null` when none yet observed. */
  last(): CaptureQualityResult | null;
  /** Drop the cached last sample (e.g. on step change). */
  clear(): void;
}

/**
 * Build a fresh capture-quality sink. Callers memoize the reference
 * across re-renders so the worklet adapter's `useRunOnJS` closure
 * stays stable.
 */
export function createCaptureQualitySink(): CaptureQualitySink {
  const listeners = new Set<CaptureQualityListener>();
  let lastQuality: CaptureQualityResult | null = null;

  function notify(event: CaptureQualityEvent): void {
    if (listeners.size === 0) return;
    for (const fn of [...listeners]) {
      try {
        fn(event);
      } catch {
        // A misbehaving subscriber must not block the worklet hot
        // path. Swallow — observability wrappers own their capture.
      }
    }
  }

  return {
    observe(event: CaptureQualityEvent): void {
      lastQuality = event.quality;
      notify(event);
    },
    subscribe(listener: CaptureQualityListener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    last(): CaptureQualityResult | null {
      return lastQuality;
    },
    clear(): void {
      lastQuality = null;
    },
  };
}

/**
 * Mutable throttle state — same shape the scanner uses. Tracks only
 * the most recent emit timestamp so the gate decision is O(1) and
 * allocation-free on the worklet hot path.
 */
export interface CaptureThrottleState {
  lastEmittedAt: number;
}

export function createCaptureThrottleState(): CaptureThrottleState {
  return { lastEmittedAt: Number.NEGATIVE_INFINITY };
}

/**
 * Pure throttle decision. Mirrors the scanner's `shouldEmitFrame`.
 * Exported so the hook tests can drive the gate deterministically
 * without a real worklet runtime.
 */
export function shouldEmitCaptureFrame(
  state: CaptureThrottleState,
  now: number,
  minIntervalMs: number,
): boolean {
  'worklet';
  if (now - state.lastEmittedAt < minIntervalMs) return false;
  state.lastEmittedAt = now;
  return true;
}

/** Build a {@link CaptureQualityEvent} from a result + timestamp. Pure. */
export function buildCaptureQualityEvent(
  quality: CaptureQualityResult,
  ts: number,
): CaptureQualityEvent {
  'worklet';
  return { ts, quality };
}

/**
 * Structural subset of a vision-camera `Frame` the capture worklet
 * reads. `toArrayBuffer` is **optional** so the worklet can no-op
 * gracefully on a frame shape (or a mock) that doesn't expose pixel
 * bytes — the heart of the "no native frame processor" fallback.
 */
export interface CaptureFrameLike {
  readonly width: number;
  readonly height: number;
  readonly timestamp?: number;
  toArrayBuffer?(): ArrayBuffer;
}

export interface UseCaptureFrameProcessorOptions {
  /** JS-thread bus the worklet hops onto for each quality sample. */
  readonly sink: CaptureQualitySink;
  /**
   * Resolved quality gate for the **active** capture step (use
   * `gateOptionsForStep`). Re-creating the processor when the gate
   * changes is expected — vision-camera tolerates it.
   */
  readonly gate: QualityEvaluationOptions;
  /**
   * Override the FPS-throttle window. Defaults to
   * {@link CAPTURE_FRAME_MIN_INTERVAL_MS} (~10 FPS).
   */
  readonly minIntervalMs?: number;
}

/**
 * Build the live capture-quality frame processor.
 *
 * The returned `ReadonlyFrameProcessor` is reference-stable across
 * re-renders (per vision-camera's contract) so the camera surface
 * doesn't tear the JSI runtime down between renders. Pass it to
 * `<GradingCameraSurface frameProcessor=…>`.
 */
export function useCaptureFrameProcessor(
  options: UseCaptureFrameProcessorOptions,
): ReadonlyFrameProcessor {
  const { sink, gate, minIntervalMs } = options;
  const effectiveInterval = minIntervalMs ?? CAPTURE_FRAME_MIN_INTERVAL_MS;

  const throttleState = useMemo(() => createCaptureThrottleState(), []);

  const forwardQuality = useRunOnJS(
    (event: CaptureQualityEvent): void => {
      sink.observe(event);
    },
    [sink],
  );

  return visionUseFrameProcessor(
    (frame: Frame) => {
      'worklet';
      const now = frame.timestamp;
      if (!shouldEmitCaptureFrame(throttleState, now, effectiveInterval)) return;
      const frameLike = frame as unknown as CaptureFrameLike;
      // Graceful no-op: a frame shape without `toArrayBuffer` (e.g.
      // a runtime where the native frame processor isn't wired) can't
      // give us pixels, so we never emit and the button falls back to
      // tap-driven behaviour.
      if (typeof frameLike.toArrayBuffer !== 'function') return;
      const buffer = frameLike.toArrayBuffer();
      const pixels = new Uint8Array(buffer);
      // Defensive: the camera pins an HWC-RGB pixel format (3 bytes /
      // pixel). If a device hands us a different layout the length
      // won't match — skip rather than throw inside the worklet.
      if (pixels.length !== frameLike.width * frameLike.height * 3) return;
      const quality = evaluateCaptureQuality(pixels, frameLike.width, frameLike.height, gate);
      const event = buildCaptureQualityEvent(quality, now);
      // Fire-and-forget JS hop — the worklet must stay non-blocking.
      forwardQuality(event);
    },
    [throttleState, effectiveInterval, forwardQuality, gate],
  );
}
