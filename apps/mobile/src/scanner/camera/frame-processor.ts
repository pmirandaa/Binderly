// Frame processor — placeholder worklet + telemetry bridge.
//
// This module ships the **seam** the rest of the scanner stage
// docks onto. The worklet:
//
//   1. Runs inside the vision-camera frame-processor JSI runtime
//      (the camera surface feeds it raw frames at whatever rate the
//      underlying capture session can sustain).
//   2. Throttles itself to {@link TARGET_FRAME_RATE_FPS} via a
//      timestamp gate — even if the Camera component is misconfigured
//      and delivers 60 FPS, the bridge to JS still fires at the
//      capped rate.
//   3. Calls a placeholder `processFrame()` worklet block that
//      T-SC-DETECT will overwrite with rectangle detection +
//      perspective correction.
//   4. Forwards a small {@link FrameTelemetryEvent} (timestamps and
//      shape metadata only — never frame bytes) back to the JS
//      thread via the worklets-core JS bridge so the FPS badge,
//      stack-mode detector, and future analytics can observe.
//
// The pure {@link shouldEmitFrame} helper exposes the throttle
// decision as a deterministic function so we can unit-test the
// ~10 FPS contract without a real worklet runtime.

import { useMemo } from 'react';
import { useFrameProcessor as visionUseFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

import { FRAME_PROCESSOR_MIN_INTERVAL_MS } from './constants.js';


import type { StackModeDetector } from './stack-mode.js';
import type { FrameTelemetryEvent, FrameTelemetrySink } from './types.js';
import type { Frame, ReadonlyFrameProcessor } from 'react-native-vision-camera';

export interface ScanFrameProcessorOptions {
  /** JS-thread sink for the placeholder telemetry events. */
  readonly telemetrySink: FrameTelemetrySink;
  /** Stack-mode detector that buffers recent frames for the reset signal. */
  readonly stackModeDetector: StackModeDetector;
  /**
   * Override the minimum interval between forwarded telemetry
   * events. Defaults to {@link FRAME_PROCESSOR_MIN_INTERVAL_MS}.
   * Tests pass small values to verify the throttle contract.
   */
  readonly minIntervalMs?: number;
}

/**
 * Mutable throttle state. Tracks only the most recent emit
 * timestamp so the decision is O(1) and free of any JS-side
 * allocations on the hot path.
 */
export interface FrameThrottleState {
  lastEmittedAt: number;
}

/**
 * Build a fresh throttle state. The initial `lastEmittedAt` is
 * `-Infinity` so the first frame always passes the gate.
 */
export function createFrameThrottleState(): FrameThrottleState {
  return { lastEmittedAt: Number.NEGATIVE_INFINITY };
}

/**
 * Decide whether the worklet should emit a telemetry event for
 * a frame seen at `now` (milliseconds). Updates the state in
 * place when it returns `true` so the next call observes the new
 * gate boundary.
 *
 * Pure function — the implementation does not depend on global
 * clock or worklet-runtime state. Exported so the hook tests can
 * assert the FPS contract deterministically.
 */
export function shouldEmitFrame(
  state: FrameThrottleState,
  now: number,
  minIntervalMs: number,
): boolean {
  'worklet';
  if (now - state.lastEmittedAt < minIntervalMs) return false;
  state.lastEmittedAt = now;
  return true;
}

/**
 * Build a {@link FrameTelemetryEvent} from a vision-camera Frame.
 * Pure function so the test can run it without a real Frame
 * (the test passes a plain object that satisfies the
 * structural subset we read).
 */
export function buildFrameTelemetryEvent(frame: FrameLike, now: number): FrameTelemetryEvent {
  'worklet';
  return {
    ts: now,
    width: frame.width,
    height: frame.height,
    bytesPerRow: frame.bytesPerRow,
  };
}

/**
 * Structural subset of vision-camera's {@link Frame} that the
 * placeholder worklet reads. Keeping this narrow makes the worklet
 * resilient to upstream additions (e.g. new HostObject methods)
 * and gives the unit test a tractable shape to construct.
 */
export interface FrameLike {
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
}

/**
 * Placeholder for the real detection worklet that T-SC-DETECT
 * will ship. Runs inside the frame-processor JSI runtime; today
 * it's a no-op so we don't waste a copy of the frame buffer on a
 * pipeline that goes nowhere yet.
 *
 * **Do not** add any JS-thread side effects here — every additional
 * function call inside the worklet block costs us battery and CPU
 * frames. The detection result will land in a future
 * `DetectionResult` type that the worklet returns; for now the
 * worklet simply exits.
 */
export function processFrame(_frame: FrameLike): void {
  'worklet';
  // TODO: T-SC-DETECT will fill this in.
  //
  // The successor function will:
  //   1. Run OpenCV rectangle detection to find the card quad.
  //   2. Perspective-correct the crop to a 245×342 RGB tensor.
  //   3. Forward the crop (or a derived embedding) back to JS via
  //      a stronger event than `FrameTelemetryEvent`.
}

/**
 * Build the scan frame processor.
 *
 * Returns the memoized `ReadonlyFrameProcessor` the `<Camera>`
 * component reads off its `frameProcessor` prop. The returned
 * object is reference-stable across re-renders so vision-camera
 * doesn't tear the JSI runtime down between renders.
 */
export function useScanFrameProcessor(
  options: ScanFrameProcessorOptions,
): ReadonlyFrameProcessor {
  const { telemetrySink, stackModeDetector, minIntervalMs } = options;
  const effectiveInterval = minIntervalMs ?? FRAME_PROCESSOR_MIN_INTERVAL_MS;

  // The throttle is a shared mutable object captured by the worklet
  // closure. Worklets reset their global state across hot reloads,
  // not across renders, so reusing the same object via `useMemo`
  // keeps the throttle gate stable for the lifetime of the screen.
  const throttleState = useMemo(() => createFrameThrottleState(), []);

  // `useRunOnJS` builds a worklets-core function the worklet can
  // call without crossing into the React reconciliation cycle.
  // The callback receives the small telemetry event and forwards
  // it to the JS-side sink and detector.
  const forwardTelemetry = useRunOnJS(
    (event: FrameTelemetryEvent): void => {
      telemetrySink.observe(event);
      stackModeDetector.observe(event);
    },
    [telemetrySink, stackModeDetector],
  );

  return visionUseFrameProcessor(
    (frame: Frame) => {
      'worklet';
      // vision-camera's `frame.timestamp` is the buffer's capture
      // timestamp; we use it as the gate clock so the throttle is
      // independent of how busy the JS bridge is.
      const now = frame.timestamp;
      if (!shouldEmitFrame(throttleState, now, effectiveInterval)) return;
      processFrame(frame);
      // Build the telemetry event inside the worklet so the
      // structurally cloned payload is the minimum size.
      const event = buildFrameTelemetryEvent(frame, now);
      // `useRunOnJS` returns a worklet that resolves a Promise on
      // the JS side. We deliberately do not await it — the frame
      // processor stays non-blocking; the JS sink picks it up at
      // whatever cadence the bridge can sustain.
      forwardTelemetry(event);
    },
    [throttleState, effectiveInterval, forwardTelemetry],
  );
}
