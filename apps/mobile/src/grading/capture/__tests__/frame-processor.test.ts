// Live capture frame-processor tests (#FU-33).
//
// As with the scanner-side processor, the worklet is mocked so its
// body is invokable as a plain JS function (see `src/test-utils/
// setup.ts`). That lets us assert the throttle + quality-sink
// behaviour — and the graceful no-op fallbacks — without a real
// worklets-core runtime or a camera.

import { renderHook } from '@testing-library/react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CAPTURE_FULL_COVERAGE_MIN } from '../constants.js';
import {
  buildCaptureQualityEvent,
  createCaptureQualitySink,
  createCaptureThrottleState,
  shouldEmitCaptureFrame,
  useCaptureFrameProcessor,
} from '../frame-processor.js';
import { makeSharpCardBuffer, makeUniformBuffer } from './fixtures.js';

import type { CaptureFrameLike, CaptureQualitySink } from '../frame-processor.js';
import type { CaptureQualityResult } from '../types.js';

const W = 192;
const H = 256;
const FULL_GATE = { coverageMin: CAPTURE_FULL_COVERAGE_MIN } as const;

interface MockFrame extends CaptureFrameLike {
  readonly timestamp: number;
}

function frame(pixels: Uint8Array, timestamp: number): MockFrame {
  return {
    width: W,
    height: H,
    timestamp,
    toArrayBuffer: () => pixels.buffer as ArrayBuffer,
  };
}

afterEach(() => {
  vi.mocked(useFrameProcessor).mockClear();
  vi.mocked(useRunOnJS).mockClear();
});

describe('shouldEmitCaptureFrame', () => {
  it('passes the first frame then throttles within the interval', () => {
    const state = createCaptureThrottleState();
    expect(shouldEmitCaptureFrame(state, 0, 100)).toBe(true);
    expect(shouldEmitCaptureFrame(state, 50, 100)).toBe(false);
    expect(shouldEmitCaptureFrame(state, 99, 100)).toBe(false);
    expect(shouldEmitCaptureFrame(state, 100, 100)).toBe(true);
  });
});

describe('buildCaptureQualityEvent', () => {
  it('wraps a quality result with the timestamp and nothing else', () => {
    const quality = {
      metrics: { sharpness: 10, brightness: 0.5, coverage: 0.2 },
      sharpnessOK: true,
      brightnessOK: true,
      coverageOK: true,
      accepted: true,
      reason: 'great',
    } satisfies CaptureQualityResult;
    const event = buildCaptureQualityEvent(quality, 42);
    expect(event).toEqual({ ts: 42, quality });
  });
});

describe('createCaptureQualitySink', () => {
  it('stores the last result and fans out to subscribers', () => {
    const sink = createCaptureQualitySink();
    expect(sink.last()).toBeNull();
    const seen: number[] = [];
    const unsub = sink.subscribe((e) => seen.push(e.ts));
    const quality = {
      metrics: { sharpness: 10, brightness: 0.5, coverage: 0.2 },
      sharpnessOK: true,
      brightnessOK: true,
      coverageOK: true,
      accepted: true,
      reason: 'great',
    } satisfies CaptureQualityResult;
    sink.observe({ ts: 1, quality });
    expect(sink.last()).toBe(quality);
    expect(seen).toEqual([1]);
    unsub();
    sink.observe({ ts: 2, quality });
    expect(seen).toEqual([1]); // no longer subscribed
    sink.clear();
    expect(sink.last()).toBeNull();
  });

  it('isolates a throwing subscriber from the others', () => {
    const sink = createCaptureQualitySink();
    const good = vi.fn();
    sink.subscribe(() => {
      throw new Error('boom');
    });
    sink.subscribe(good);
    const quality = {
      metrics: { sharpness: 10, brightness: 0.5, coverage: 0.2 },
      sharpnessOK: true,
      brightnessOK: true,
      coverageOK: true,
      accepted: true,
      reason: 'great',
    } satisfies CaptureQualityResult;
    expect(() => sink.observe({ ts: 1, quality })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('useCaptureFrameProcessor', () => {
  function mountProcessor(sink: CaptureQualitySink) {
    return renderHook(() =>
      useCaptureFrameProcessor({ sink, gate: FULL_GATE, minIntervalMs: 100 }),
    );
  }

  it('samples a sharp frame and forwards an accepted quality result, throttled to ~10 FPS', () => {
    const sink = createCaptureQualitySink();
    const spy = vi.spyOn(sink, 'observe');
    const { result } = mountProcessor(sink);
    const fp = result.current.frameProcessor;

    const pixels = makeSharpCardBuffer({ width: W, height: H });
    fp(frame(pixels, 0) as never);
    fp(frame(pixels, 50) as never); // throttled
    fp(frame(pixels, 100) as never);

    expect(spy).toHaveBeenCalledTimes(2);
    const last = sink.last();
    expect(last).not.toBeNull();
    expect(last?.accepted).toBe(true);
    expect(last?.reason).toBe('great');
  });

  it('forwards a rejected result (with reason) for a poor frame', () => {
    const sink = createCaptureQualitySink();
    const { result } = mountProcessor(sink);
    const fp = result.current.frameProcessor;

    // Uniform grey → zero coverage → no_card_detected.
    const pixels = makeUniformBuffer(W, H, [128, 128, 128]);
    fp(frame(pixels, 0) as never);

    const last = sink.last();
    expect(last?.accepted).toBe(false);
    expect(last?.reason).toBe('no_card_detected');
  });

  it('gracefully no-ops when the frame exposes no toArrayBuffer (no native processor)', () => {
    const sink = createCaptureQualitySink();
    const spy = vi.spyOn(sink, 'observe');
    const { result } = mountProcessor(sink);
    const fp = result.current.frameProcessor;

    // A frame shape without pixel access — e.g. a runtime where the
    // native frame processor isn't wired. Must not throw, must not emit.
    fp({ width: W, height: H, timestamp: 0 } as never);

    expect(spy).not.toHaveBeenCalled();
    expect(sink.last()).toBeNull();
  });

  it('gracefully no-ops when the pixel buffer length does not match an RGB frame', () => {
    const sink = createCaptureQualitySink();
    const spy = vi.spyOn(sink, 'observe');
    const { result } = mountProcessor(sink);
    const fp = result.current.frameProcessor;

    // RGBA-sized buffer (4 bytes/px) against an RGB (3 bytes/px) reader.
    const rgba = new Uint8Array(W * H * 4);
    fp({
      width: W,
      height: H,
      timestamp: 0,
      toArrayBuffer: () => rgba.buffer,
    } as never);

    expect(spy).not.toHaveBeenCalled();
    expect(sink.last()).toBeNull();
  });

  it('returns a memoized readonly frame processor across re-renders', () => {
    const sink = createCaptureQualitySink();
    const { result, rerender } = mountProcessor(sink);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect((first as { type: string }).type).toBe('readonly');
  });
});
