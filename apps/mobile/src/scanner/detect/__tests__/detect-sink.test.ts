// Tests for the JS-thread detection sink.

import { describe, expect, it, vi } from 'vitest';

import { createDetectionSink } from '../detect-sink.js';

import type { DetectionEvent } from '../types.js';

function fakeEvent(ts: number, accepted = true): DetectionEvent {
  return {
    ts,
    rect: { x: 1, y: 2, width: 30, height: 40 },
    rectValid: true,
    quality: {
      sharpness: 12,
      brightness: 0.5,
      aspectRatio: 1.4,
      portraitOrientation: true,
      sharpnessOK: true,
      brightnessOK: true,
      aspectOK: true,
    },
    accepted,
    cropped: accepted ? new Float32Array([0.1, 0.2, 0.3]) : null,
  };
}

describe('createDetectionSink', () => {
  it('starts with a null last-event', () => {
    const sink = createDetectionSink();
    expect(sink.last()).toBeNull();
  });

  it('notifies subscribers in registration order', () => {
    const sink = createDetectionSink();
    const a = vi.fn();
    const b = vi.fn();
    sink.subscribe(a);
    sink.subscribe(b);

    sink.observe(fakeEvent(100));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ ts: 100 }));
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ ts: 100 }));
  });

  it('records the most recent event in last()', () => {
    const sink = createDetectionSink();
    sink.observe(fakeEvent(100));
    sink.observe(fakeEvent(200));
    expect(sink.last()?.ts).toBe(200);
  });

  it('unsubscribes via the returned function', () => {
    const sink = createDetectionSink();
    const listener = vi.fn();
    const off = sink.subscribe(listener);
    sink.observe(fakeEvent(100));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    sink.observe(fakeEvent(200));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears the last-event reference', () => {
    const sink = createDetectionSink();
    sink.observe(fakeEvent(100));
    expect(sink.last()).not.toBeNull();
    sink.clear();
    expect(sink.last()).toBeNull();
  });

  it('survives a misbehaving listener (continues notifying others)', () => {
    const sink = createDetectionSink();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    sink.subscribe(bad);
    sink.subscribe(good);
    sink.observe(fakeEvent(100));
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('survives observe() with zero subscribers', () => {
    const sink = createDetectionSink();
    expect(() => sink.observe(fakeEvent(100))).not.toThrow();
    expect(sink.last()?.ts).toBe(100);
  });
});
