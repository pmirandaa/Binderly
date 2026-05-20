import { describe, expect, it, vi } from 'vitest';

import { createFrameTelemetrySink } from './frame-telemetry.js';

import type { FrameTelemetryEvent, FrameTelemetrySnapshot } from './types.js';

function event(ts: number): FrameTelemetryEvent {
  return { ts, width: 1920, height: 1080, bytesPerRow: 1920 * 4 };
}

describe('createFrameTelemetrySink', () => {
  it('reports null FPS until at least two samples land', () => {
    const sink = createFrameTelemetrySink();

    expect(sink.fps()).toBeNull();
    sink.observe(event(0));
    expect(sink.fps()).toBeNull();
    sink.observe(event(100));
    expect(sink.fps()).toBeCloseTo(10);
  });

  it('computes a sliding-window FPS estimate over recent events', () => {
    const sink = createFrameTelemetrySink({ ringSize: 4 });

    sink.observe(event(0));
    sink.observe(event(100));
    sink.observe(event(200));
    sink.observe(event(300));

    expect(sink.fps()).toBeCloseTo(10);
  });

  it('drops the oldest event when the ring overflows', () => {
    const sink = createFrameTelemetrySink({ ringSize: 3 });

    sink.observe(event(0));
    sink.observe(event(1_000));
    sink.observe(event(2_000));
    sink.observe(event(2_100));
    sink.observe(event(2_200));

    expect(sink.fps()).toBeCloseTo(10);
  });

  it('notifies subscribers on every observe and primes them on subscribe', () => {
    const sink = createFrameTelemetrySink();
    const listener = vi.fn();

    const unsubscribe = sink.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject<FrameTelemetrySnapshot>({
      fps: null,
      lastEvent: null,
      sampleCount: 0,
    });

    sink.observe(event(0));
    sink.observe(event(100));

    expect(listener).toHaveBeenCalledTimes(3);
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1]?.[0] as
      | FrameTelemetrySnapshot
      | undefined;
    expect(lastCall?.fps).toBeCloseTo(10);
    expect(lastCall?.sampleCount).toBe(2);

    unsubscribe();
    sink.observe(event(200));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('clears retained samples and notifies subscribers', () => {
    const sink = createFrameTelemetrySink();
    sink.observe(event(0));
    sink.observe(event(100));

    const listener = vi.fn();
    sink.subscribe(listener);
    listener.mockClear();

    sink.clear();

    expect(sink.fps()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    const last = listener.mock.calls[0]?.[0] as FrameTelemetrySnapshot | undefined;
    expect(last?.sampleCount).toBe(0);
  });

  it('returns null when two events share a timestamp (avoid div-by-zero)', () => {
    const sink = createFrameTelemetrySink();
    sink.observe(event(42));
    sink.observe(event(42));
    expect(sink.fps()).toBeNull();
  });

  it('isolates one misbehaving subscriber from the others', () => {
    const sink = createFrameTelemetrySink();
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });

    sink.subscribe(bad);
    sink.subscribe(good);

    sink.observe(event(0));

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });
});
