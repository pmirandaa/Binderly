// Tests for the frame-processor worklet contract.
//
// The actual worklet runs inside vision-camera's JSI runtime on
// device; in tests we mock `useFrameProcessor` so the worklet body
// is invokable as a plain JS function (see `src/test-utils/setup.ts`).
// That lets us assert the throttle + telemetry behaviour without
// spinning up a worklets-core runtime.

import { renderHook } from '@testing-library/react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildFrameTelemetryEvent,
  createFrameThrottleState,
  shouldEmitFrame,
  useScanFrameProcessor,
} from './frame-processor.js';
import { createFrameTelemetrySink } from './frame-telemetry.js';
import { createStackModeDetector } from './stack-mode.js';

import type { FrameLike } from './frame-processor.js';
import type { FrameTelemetryEvent } from './types.js';

function frame(timestamp: number): FrameLike & { readonly timestamp: number } {
  return { width: 1920, height: 1080, bytesPerRow: 1920 * 4, timestamp };
}

afterEach(() => {
  vi.mocked(useFrameProcessor).mockClear();
  vi.mocked(useRunOnJS).mockClear();
});

describe('shouldEmitFrame', () => {
  it('passes the first frame regardless of the minimum interval', () => {
    const state = createFrameThrottleState();
    expect(shouldEmitFrame(state, 0, 100)).toBe(true);
  });

  it('suppresses frames inside the minimum interval', () => {
    const state = createFrameThrottleState();
    expect(shouldEmitFrame(state, 0, 100)).toBe(true);
    expect(shouldEmitFrame(state, 50, 100)).toBe(false);
    expect(shouldEmitFrame(state, 99, 100)).toBe(false);
  });

  it('passes the next frame exactly at the interval boundary', () => {
    const state = createFrameThrottleState();
    shouldEmitFrame(state, 0, 100);
    expect(shouldEmitFrame(state, 100, 100)).toBe(true);
  });

  it('mutates the state so subsequent calls observe the new gate', () => {
    const state = createFrameThrottleState();
    shouldEmitFrame(state, 0, 100);
    expect(state.lastEmittedAt).toBe(0);
    shouldEmitFrame(state, 150, 100);
    expect(state.lastEmittedAt).toBe(150);
  });
});

describe('buildFrameTelemetryEvent', () => {
  it('produces a telemetry event from the frame metadata', () => {
    const f = frame(42);
    const event = buildFrameTelemetryEvent(f, f.timestamp);
    expect(event).toEqual<FrameTelemetryEvent>({
      ts: 42,
      width: 1920,
      height: 1080,
      bytesPerRow: 1920 * 4,
    });
  });

  it('never leaks any frame buffer reference into the payload', () => {
    const f = { ...frame(0), toArrayBuffer: vi.fn() } as unknown as FrameLike & {
      readonly timestamp: number;
    };
    const event = buildFrameTelemetryEvent(f, 0);
    expect(Object.keys(event).sort()).toEqual(['bytesPerRow', 'height', 'ts', 'width']);
  });
});

describe('useScanFrameProcessor', () => {
  it('forwards a telemetry event for the first frame and throttles within the window', () => {
    const sink = createFrameTelemetrySink();
    const detector = createStackModeDetector();
    const sinkSpy = vi.spyOn(sink, 'observe');
    const detectorSpy = vi.spyOn(detector, 'observe');

    const { result } = renderHook(() =>
      useScanFrameProcessor({
        telemetrySink: sink,
        stackModeDetector: detector,
        minIntervalMs: 100,
      }),
    );

    const fp = result.current.frameProcessor;

    fp(frame(0) as never);
    fp(frame(50) as never);
    fp(frame(99) as never);
    fp(frame(100) as never);

    expect(sinkSpy).toHaveBeenCalledTimes(2);
    expect(detectorSpy).toHaveBeenCalledTimes(2);
    expect(sinkSpy.mock.calls[0]?.[0]).toMatchObject({ ts: 0 });
    expect(sinkSpy.mock.calls[1]?.[0]).toMatchObject({ ts: 100 });
  });

  it('hits ~10 FPS under a fake camera ticking at the same rate', () => {
    const sink = createFrameTelemetrySink({ ringSize: 64 });
    const detector = createStackModeDetector({ ringSize: 64 });

    const { result } = renderHook(() =>
      useScanFrameProcessor({
        telemetrySink: sink,
        stackModeDetector: detector,
        minIntervalMs: 100,
      }),
    );

    const fp = result.current.frameProcessor;

    // 10 frames spaced exactly 100ms apart — perfect 10 FPS source.
    for (let i = 0; i < 10; i += 1) {
      fp(frame(i * 100) as never);
    }

    expect(detector.__buffer().size).toBe(10);
    expect(sink.fps()).toBeCloseTo(10, 1);
  });

  it('hits ~10 FPS under a fake camera ticking faster than the cap', () => {
    const sink = createFrameTelemetrySink({ ringSize: 64 });
    const detector = createStackModeDetector({ ringSize: 64 });

    const { result } = renderHook(() =>
      useScanFrameProcessor({
        telemetrySink: sink,
        stackModeDetector: detector,
        minIntervalMs: 100,
      }),
    );

    const fp = result.current.frameProcessor;

    // 60 frames spaced 16.67ms apart over one second — 60 FPS source.
    let observed = 0;
    const ringSpy = vi.spyOn(sink, 'observe');
    for (let i = 0; i < 60; i += 1) {
      fp(frame(Math.floor(i * 1000 / 60)) as never);
    }
    observed = ringSpy.mock.calls.length;

    // 1000ms / 100ms == 10 windows; first frame always passes; the
    // throttle should let through 10 or 11 events depending on
    // rounding (we accept both — 10 windows + the boundary frame).
    expect(observed).toBeGreaterThanOrEqual(10);
    expect(observed).toBeLessThanOrEqual(11);
  });

  it('returns a memoized frame processor with `type: "readonly"`', () => {
    const sink = createFrameTelemetrySink();
    const detector = createStackModeDetector();

    const { result, rerender } = renderHook(() =>
      useScanFrameProcessor({
        telemetrySink: sink,
        stackModeDetector: detector,
      }),
    );

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first.type).toBe('readonly');
    expect(first).toBe(second);
  });
});
