// Bounded match queue tests.

import { describe, expect, it } from 'vitest';

import { createMatchQueue } from '../match-queue.js';

import type { MatchResult } from '../types.js';

function fakeMatch(printingId: string, ts: number): MatchResult {
  return {
    printingId,
    confidence: 0.9,
    topGap: 0.5,
    disposition: 'auto-add',
    candidates: [{ printingId, score: 0.9, distance: 0.1 }],
    stabilityCount: 3,
    framesSinceMatch: 0,
    emittedAtMs: ts,
  };
}

describe('createMatchQueue', () => {
  it('starts empty', () => {
    const q = createMatchQueue();
    expect(q.size).toBe(0);
    expect(q.peek()).toEqual([]);
    expect(q.latest()).toBeNull();
  });

  it('enqueues in order and surfaces latest()', () => {
    const q = createMatchQueue();
    q.enqueue(fakeMatch('A', 1));
    q.enqueue(fakeMatch('B', 2));
    expect(q.size).toBe(2);
    expect(q.latest()?.printingId).toBe('B');
    expect(q.peek().map((r) => r.printingId)).toEqual(['A', 'B']);
  });

  it('flush() returns and clears', () => {
    const q = createMatchQueue();
    q.enqueue(fakeMatch('A', 1));
    q.enqueue(fakeMatch('B', 2));
    const drained = q.flush();
    expect(drained.map((r) => r.printingId)).toEqual(['A', 'B']);
    expect(q.size).toBe(0);
    expect(q.latest()).toBeNull();
  });

  it('clear() drops everything without returning', () => {
    const q = createMatchQueue();
    q.enqueue(fakeMatch('A', 1));
    q.clear();
    expect(q.size).toBe(0);
  });

  it('overflow drops the oldest entry first (FIFO back-pressure)', () => {
    const q = createMatchQueue(3);
    q.enqueue(fakeMatch('A', 1));
    q.enqueue(fakeMatch('B', 2));
    q.enqueue(fakeMatch('C', 3));
    q.enqueue(fakeMatch('D', 4));
    expect(q.size).toBe(3);
    expect(q.peek().map((r) => r.printingId)).toEqual(['B', 'C', 'D']);
  });

  it('cap getter reflects the construction-time value', () => {
    const q = createMatchQueue(5);
    expect(q.cap).toBe(5);
  });

  it('rejects a non-positive cap', () => {
    expect(() => createMatchQueue(0)).toThrow();
    expect(() => createMatchQueue(-1)).toThrow();
    expect(() => createMatchQueue(NaN)).toThrow();
  });

  it('peek() returns a snapshot — mutating it does not affect the queue', () => {
    const q = createMatchQueue();
    q.enqueue(fakeMatch('A', 1));
    const snap = q.peek() as MatchResult[];
    snap.length = 0;
    expect(q.size).toBe(1);
  });
});
