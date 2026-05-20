// Tests for the embed-pipeline telemetry emitter. Small surface,
// proportionally small tests — we mostly cover the
// listener-management invariants T-SC-MATCH relies on.

import { describe, expect, it, vi } from 'vitest';

import { createEmbedTelemetry } from '../telemetry';

describe('createEmbedTelemetry', () => {
  it('emits to every registered listener', () => {
    const bus = createEmbedTelemetry();
    const a = vi.fn();
    const b = vi.fn();
    bus.on(a);
    bus.on(b);
    bus.emit({ durationMs: 12, delegate: 'gpu', framePixels: 1024 });
    expect(a).toHaveBeenCalledWith({
      durationMs: 12,
      delegate: 'gpu',
      framePixels: 1024,
    });
    expect(b).toHaveBeenCalled();
  });

  it('unsubscribe stops further events', () => {
    const bus = createEmbedTelemetry();
    const listener = vi.fn();
    const off = bus.on(listener);
    bus.emit({ durationMs: 1, delegate: 'cpu', framePixels: 1 });
    off();
    bus.emit({ durationMs: 2, delegate: 'cpu', framePixels: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('exposes the listener count', () => {
    const bus = createEmbedTelemetry();
    expect(bus.listenerCount).toBe(0);
    const off = bus.on(() => undefined);
    expect(bus.listenerCount).toBe(1);
    off();
    expect(bus.listenerCount).toBe(0);
  });

  it('isolates listener exceptions from other listeners', () => {
    const bus = createEmbedTelemetry();
    const okBefore = vi.fn();
    const okAfter = vi.fn();
    bus.on(okBefore);
    bus.on(() => {
      throw new Error('boom');
    });
    bus.on(okAfter);
    bus.emit({ durationMs: 1, delegate: 'cpu', framePixels: 1 });
    expect(okBefore).toHaveBeenCalled();
    expect(okAfter).toHaveBeenCalled();
  });

  it('tolerates listeners that unsubscribe themselves inside the handler', () => {
    const bus = createEmbedTelemetry();
    const calls: number[] = [];
    const off = bus.on(() => {
      calls.push(1);
      off();
    });
    bus.emit({ durationMs: 1, delegate: 'cpu', framePixels: 1 });
    bus.emit({ durationMs: 2, delegate: 'cpu', framePixels: 2 });
    expect(calls).toEqual([1]);
  });
});
