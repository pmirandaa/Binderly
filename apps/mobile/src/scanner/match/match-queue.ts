// Bounded in-session FIFO of fired matches.
//
// T-SC-UX reads this to render the "12 cards added — Done" footer
// and to batch-add to the collection on session end. Stack-mode
// scanning continuously pushes to this queue; the UI flushes once
// the user signals they're done.
//
// Overflow drops the oldest entry. This is a memory-safety guard
// for the misbehaving case (UI forgets to flush); a healthy
// session never approaches the cap.

import { MATCH_QUEUE_CAP } from './constants.js';

import type { MatchQueue, MatchResult } from './types.js';

/**
 * Build a fresh bounded match queue.
 *
 * @param cap  Maximum entries before back-pressure drops the
 *             oldest. Defaults to {@link MATCH_QUEUE_CAP}.
 */
export function createMatchQueue(cap: number = MATCH_QUEUE_CAP): MatchQueue {
  if (!Number.isFinite(cap) || cap < 1) {
    throw new Error(`createMatchQueue: cap must be >= 1, got ${cap}`);
  }
  const effectiveCap = Math.floor(cap);
  const items: MatchResult[] = [];

  return {
    get cap() {
      return effectiveCap;
    },
    get size() {
      return items.length;
    },
    enqueue(result: MatchResult): void {
      items.push(result);
      // shift() is O(n) but n is bounded by `cap` (default 32) and
      // we hit this branch only on overflow — well off the hot path.
      while (items.length > effectiveCap) items.shift();
    },
    peek(): readonly MatchResult[] {
      return [...items];
    },
    flush(): readonly MatchResult[] {
      const snapshot = [...items];
      items.length = 0;
      return snapshot;
    },
    latest(): MatchResult | null {
      return items[items.length - 1] ?? null;
    },
    clear(): void {
      items.length = 0;
    },
  };
}
