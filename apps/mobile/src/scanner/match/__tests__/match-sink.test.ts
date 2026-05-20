// Tests for the JS-thread match sink.
//
// Mirrors `scanner/detect/__tests__/detect-sink.test.ts`; same
// posture, different event shape.

import { describe, expect, it, vi } from 'vitest';

import { createMatchSink } from '../match-sink.js';

import type { MatchResult } from '../types.js';

function fakeMatch(printingId: string, ts: number): MatchResult {
  return {
    printingId,
    confidence: 0.9,
    topGap: 0.4,
    disposition: 'auto-add',
    candidates: [{ printingId, score: 0.9, distance: 0.1 }],
    stabilityCount: 3,
    framesSinceMatch: 0,
    emittedAtMs: ts,
  };
}

describe('createMatchSink', () => {
  it('starts with no last result', () => {
    const sink = createMatchSink();
    expect(sink.last()).toBeNull();
  });

  it('notifies subscribers when emit() is called', () => {
    const sink = createMatchSink();
    const listener = vi.fn();
    sink.subscribe(listener);
    sink.emit(fakeMatch('A', 100));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ printingId: 'A' });
  });

  it('records the most recent emit in last()', () => {
    const sink = createMatchSink();
    sink.emit(fakeMatch('A', 100));
    sink.emit(fakeMatch('B', 200));
    expect(sink.last()?.printingId).toBe('B');
  });

  it('unsubscribes via the returned function', () => {
    const sink = createMatchSink();
    const listener = vi.fn();
    const off = sink.subscribe(listener);
    sink.emit(fakeMatch('A', 100));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    sink.emit(fakeMatch('B', 200));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clear() drops the cached last', () => {
    const sink = createMatchSink();
    sink.emit(fakeMatch('A', 100));
    expect(sink.last()).not.toBeNull();
    sink.clear();
    expect(sink.last()).toBeNull();
  });

  it('survives a misbehaving listener (keeps notifying the rest)', () => {
    const sink = createMatchSink();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    sink.subscribe(bad);
    sink.subscribe(good);
    sink.emit(fakeMatch('A', 100));
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('emit() with zero subscribers is a no-op and still records last()', () => {
    const sink = createMatchSink();
    expect(() => sink.emit(fakeMatch('A', 100))).not.toThrow();
    expect(sink.last()?.printingId).toBe('A');
  });
});
