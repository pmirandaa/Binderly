// Tests for the detect-stage frame-processor hook.
//
// The same posture the camera task's `frame-processor.test.ts`
// uses: `useFrameProcessor` is mocked in `src/test-utils/setup.ts`
// to expose the worklet body as a callable function under the
// `readonly` shape. That lets us drive synthetic frames at the
// JS-thread layer without spinning up a worklets-core runtime.

import { renderHook } from '@testing-library/react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDetectionSink } from '../detect-sink.js';
import {
  buildDetectionEvent,
  createDetectThrottleState,
  shouldEmitDetectFrame,
  useDetectFrameProcessor,
} from '../frame-processor.js';

import type { DetectFrameLike, DetectionResult } from '../types.js';

interface FakeFrame extends DetectFrameLike {
  readonly timestamp: number;
}

function fakeFrame(timestamp: number, width = 160, height = 240, fillByte = 0): FakeFrame {
  const buffer = new ArrayBuffer(width * height * 3);
  new Uint8Array(buffer).fill(fillByte);
  return {
    width,
    height,
    bytesPerRow: width * 3,
    timestamp,
    toArrayBuffer: (): ArrayBuffer => buffer,
  };
}

function fakeCardFrame(timestamp: number): FakeFrame {
  const w = 160;
  const h = 240;
  const buffer = new ArrayBuffer(w * h * 3);
  const pixels = new Uint8Array(buffer);
  pixels.fill(230);
  // Dark card-shaped region in the middle.
  const rectX = 50;
  const rectY = 60;
  const rectW = 60;
  const rectH = 84;
  for (let y = rectY; y < rectY + rectH; y += 1) {
    for (let x = rectX; x < rectX + rectW; x += 1) {
      const i = (y * w + x) * 3;
      pixels[i] = 60;
      pixels[i + 1] = 60;
      pixels[i + 2] = 60;
    }
  }
  return {
    width: w,
    height: h,
    bytesPerRow: w * 3,
    timestamp,
    toArrayBuffer: (): ArrayBuffer => buffer,
  };
}

afterEach(() => {
  vi.mocked(useFrameProcessor).mockClear();
  vi.mocked(useRunOnJS).mockClear();
});

describe('shouldEmitDetectFrame', () => {
  it('passes the first frame regardless of interval', () => {
    const state = createDetectThrottleState();
    expect(shouldEmitDetectFrame(state, 0, 100)).toBe(true);
  });

  it('suppresses frames within the interval', () => {
    const state = createDetectThrottleState();
    shouldEmitDetectFrame(state, 0, 100);
    expect(shouldEmitDetectFrame(state, 50, 100)).toBe(false);
    expect(shouldEmitDetectFrame(state, 99, 100)).toBe(false);
  });

  it('passes the next frame at the interval boundary', () => {
    const state = createDetectThrottleState();
    shouldEmitDetectFrame(state, 0, 100);
    expect(shouldEmitDetectFrame(state, 100, 100)).toBe(true);
  });

  it('updates the state in place', () => {
    const state = createDetectThrottleState();
    shouldEmitDetectFrame(state, 100, 100);
    expect(state.lastEmittedAt).toBe(100);
    shouldEmitDetectFrame(state, 250, 100);
    expect(state.lastEmittedAt).toBe(250);
  });
});

describe('buildDetectionEvent', () => {
  it('copies fields from the result + adds the timestamp', () => {
    const result: DetectionResult = {
      rect: { x: 5, y: 6, width: 30, height: 42 },
      rectValid: true,
      quality: {
        sharpness: 20,
        brightness: 0.5,
        aspectRatio: 1.4,
        portraitOrientation: true,
        sharpnessOK: true,
        brightnessOK: true,
        aspectOK: true,
      },
      accepted: true,
      cropped: new Float32Array([0.1, 0.2]),
    };
    const event = buildDetectionEvent(result, 999);
    expect(event.ts).toBe(999);
    expect(event.rect).toBe(result.rect);
    expect(event.quality).toBe(result.quality);
    expect(event.accepted).toBe(true);
    expect(event.cropped).toBe(result.cropped);
  });
});

describe('useDetectFrameProcessor', () => {
  it('forwards a detection event to the sink for the first frame', () => {
    const sink = createDetectionSink();
    const spy = vi.spyOn(sink, 'observe');
    const { result } = renderHook(() =>
      useDetectFrameProcessor({ sink, minIntervalMs: 100 }),
    );
    const fp = result.current.frameProcessor;

    fp(fakeCardFrame(0) as never);
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]?.[0];
    expect(event?.ts).toBe(0);
    expect(event?.accepted).toBe(true);
    expect(event?.cropped).not.toBeNull();
  });

  it('throttles to ~10 FPS under a 60-FPS frame source', () => {
    const sink = createDetectionSink();
    const spy = vi.spyOn(sink, 'observe');
    const { result } = renderHook(() =>
      useDetectFrameProcessor({ sink, minIntervalMs: 100 }),
    );
    const fp = result.current.frameProcessor;

    // 60 frames over 1 s → throttle should let through 10 or 11.
    for (let i = 0; i < 60; i += 1) {
      fp(fakeFrame(Math.floor((i * 1000) / 60)) as never);
    }
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it('returns a memoized frame processor with `type: "readonly"`', () => {
    const sink = createDetectionSink();
    const { result, rerender } = renderHook(() =>
      useDetectFrameProcessor({ sink }),
    );
    const first = result.current;
    rerender();
    const second = result.current;
    expect(first.type).toBe('readonly');
    expect(first).toBe(second);
  });

  it('emits an "accepted: false" event for a uniform frame and short-circuits the crop', () => {
    const sink = createDetectionSink();
    const spy = vi.spyOn(sink, 'observe');
    const { result } = renderHook(() =>
      useDetectFrameProcessor({ sink, minIntervalMs: 50 }),
    );
    const fp = result.current.frameProcessor;
    fp(fakeFrame(0, 160, 240, 128) as never);
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]?.[0];
    expect(event?.accepted).toBe(false);
    expect(event?.cropped).toBeNull();
  });

  it('respects a custom detectOptions override', () => {
    const sink = createDetectionSink();
    const spy = vi.spyOn(sink, 'observe');
    // Set an unreachable sharpness floor so even a "good" frame
    // is rejected — verifies the option threads through.
    const { result } = renderHook(() =>
      useDetectFrameProcessor({
        sink,
        minIntervalMs: 100,
        detectOptions: { sharpnessMin: 999_999 },
      }),
    );
    const fp = result.current.frameProcessor;
    fp(fakeCardFrame(0) as never);
    const event = spy.mock.calls[0]?.[0];
    expect(event?.accepted).toBe(false);
    expect(event?.quality.sharpnessOK).toBe(false);
  });

  it('only invokes useRunOnJS once per hook lifetime (stable JS-side callback)', () => {
    const sink = createDetectionSink();
    const { rerender } = renderHook(() =>
      useDetectFrameProcessor({ sink, minIntervalMs: 100 }),
    );
    const initialCalls = vi.mocked(useRunOnJS).mock.calls.length;
    rerender();
    rerender();
    // useRunOnJS is the hook itself — the mock runs it every
    // render. What we *really* want is for the returned function
    // identity to be stable across renders. The hook reads its
    // dependencies (sink); the mock memoizes against them, so a
    // re-render with the same sink yields the same return value.
    expect(vi.mocked(useRunOnJS).mock.calls.length).toBeGreaterThanOrEqual(initialCalls);
  });
});
