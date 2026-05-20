import { describe, expect, it } from 'vitest';

import { createStackModeDetector } from './stack-mode.js';

import type { FrameTelemetryEvent } from './types.js';

function event(ts: number): FrameTelemetryEvent {
  return { ts, width: 1920, height: 1080, bytesPerRow: 1920 * 4 };
}

describe('createStackModeDetector', () => {
  it('reports `stable` from the very first observation', () => {
    const detector = createStackModeDetector();
    expect(detector.signal()).toBe('stable');

    detector.observe(event(0));
    expect(detector.signal()).toBe('stable');
  });

  it('placeholder always returns `stable` regardless of frame history', () => {
    const detector = createStackModeDetector();

    for (let i = 0; i < 100; i += 1) {
      detector.observe(event(i * 100));
    }

    expect(detector.signal()).toBe('stable');
  });

  it('buffers frames in the underlying ring (T-SC-DETECT seam)', () => {
    const detector = createStackModeDetector({ ringSize: 4 });

    detector.observe(event(0));
    detector.observe(event(100));
    detector.observe(event(200));

    expect(detector.__buffer().size).toBe(3);
    expect(detector.__buffer().last()).toEqual(event(200));
  });

  it('evicts the oldest sample once the ring is full', () => {
    const detector = createStackModeDetector({ ringSize: 3 });

    detector.observe(event(0));
    detector.observe(event(100));
    detector.observe(event(200));
    detector.observe(event(300));

    const snapshot = detector.__buffer().snapshot();
    expect(snapshot.map((e) => e.ts)).toEqual([100, 200, 300]);
  });

  it('forgets the buffered history on `reset()`', () => {
    const detector = createStackModeDetector({ ringSize: 4 });

    detector.observe(event(0));
    detector.observe(event(100));
    detector.reset();

    expect(detector.__buffer().size).toBe(0);
    expect(detector.signal()).toBe('stable');
  });
});
