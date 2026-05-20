// Pure unit tests for the scanner session state machine.
// No React dependency — drives the reducer directly.

import { describe, expect, it } from 'vitest';

import {
  scannerSessionReducer,
  type ScannerSessionState,
} from '../use-scanner-session.js';

import type { MatchResult } from '../../../scanner/match/types.js';
import type { SessionItem } from '../../../scanner/ui/types.js';

const INITIAL_STATE: ScannerSessionState = {
  phase: 'scanning',
  items: [],
  undoEntry: null,
};

function makeMatch(printingId: string): MatchResult {
  return {
    printingId,
    confidence: 0.85,
    topGap: 0.08,
    disposition: 'auto-add',
    candidates: [],
    stabilityCount: 3,
    framesSinceMatch: 0,
    emittedAtMs: 1000,
  };
}

function makeItem(n: number): SessionItem {
  return {
    collectionItemId: `cid-${n}`,
    printingId: `pid-${n}`,
    displayName: `Card ${n}`,
    committedAt: new Date().toISOString(),
    matchResult: makeMatch(`pid-${n}`),
  };
}

describe('scannerSessionReducer', () => {
  // ---------- ENQUEUE_ITEM -----------------------------------
  it('ENQUEUE_ITEM adds item to the list', () => {
    const state = scannerSessionReducer(INITIAL_STATE, {
      type: 'ENQUEUE_ITEM',
      item: makeItem(0),
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.collectionItemId).toBe('cid-0');
  });

  it('ENQUEUE_ITEM adds items in order', () => {
    let state = INITIAL_STATE;
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(0) });
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(1) });
    expect(state.items[0]?.printingId).toBe('pid-0');
    expect(state.items[1]?.printingId).toBe('pid-1');
  });

  it('ENQUEUE_ITEM drops the oldest when cap (32) is exceeded', () => {
    let state = INITIAL_STATE;
    for (let i = 0; i < 33; i++) {
      state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(i) });
    }
    expect(state.items).toHaveLength(32);
    // oldest (item 0) was dropped
    expect(state.items[0]?.collectionItemId).toBe('cid-1');
    // newest (item 32) is last
    expect(state.items[31]?.collectionItemId).toBe('cid-32');
  });

  // ---------- SET_UNDO_ENTRY ---------------------------------
  it('SET_UNDO_ENTRY stores the entry', () => {
    const entry = {
      collectionItemId: 'cid-x',
      printingId: 'pid-x',
      displayName: 'MyCard',
      createdAtMs: 1000,
    };
    const state = scannerSessionReducer(INITIAL_STATE, {
      type: 'SET_UNDO_ENTRY',
      entry,
    });
    expect(state.undoEntry).toEqual(entry);
  });

  it('SET_UNDO_ENTRY clears entry when null', () => {
    const withEntry = { ...INITIAL_STATE, undoEntry: {
      collectionItemId: 'c1',
      printingId: 'p1',
      displayName: 'X',
      createdAtMs: 0,
    } };
    const state = scannerSessionReducer(withEntry, {
      type: 'SET_UNDO_ENTRY',
      entry: null,
    });
    expect(state.undoEntry).toBeNull();
  });

  // ---------- REMOVE_ITEM ------------------------------------
  it('REMOVE_ITEM removes the item with matching id', () => {
    let state = INITIAL_STATE;
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(0) });
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(1) });
    state = scannerSessionReducer(state, { type: 'REMOVE_ITEM', collectionItemId: 'cid-0' });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.collectionItemId).toBe('cid-1');
  });

  it('REMOVE_ITEM clears undoEntry if it matches', () => {
    const entry = {
      collectionItemId: 'cid-0',
      printingId: 'pid-0',
      displayName: 'Card 0',
      createdAtMs: 0,
    } as const;
    const state = scannerSessionReducer(
      { ...INITIAL_STATE, undoEntry: entry },
      { type: 'REMOVE_ITEM', collectionItemId: 'cid-0' },
    );
    expect(state.undoEntry).toBeNull();
  });

  it('REMOVE_ITEM leaves undoEntry if id does not match', () => {
    const entry = {
      collectionItemId: 'cid-99',
      printingId: 'pid-99',
      displayName: 'Card 99',
      createdAtMs: 0,
    } as const;
    let state: ScannerSessionState = { ...INITIAL_STATE, undoEntry: entry };
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(0) });
    state = scannerSessionReducer(state, {
      type: 'REMOVE_ITEM',
      collectionItemId: 'cid-0',
    });
    expect(state.undoEntry).toEqual(entry);
  });

  it('REMOVE_ITEM is a no-op for unknown ids', () => {
    let state = INITIAL_STATE;
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(0) });
    state = scannerSessionReducer(state, {
      type: 'REMOVE_ITEM',
      collectionItemId: 'unknown',
    });
    expect(state.items).toHaveLength(1);
  });

  // ---------- DISCARD_ALL ------------------------------------
  it('DISCARD_ALL clears items, undo entry, and resets phase to scanning', () => {
    let state = INITIAL_STATE;
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(0) });
    state = scannerSessionReducer(state, {
      type: 'SET_UNDO_ENTRY',
      entry: { collectionItemId: 'c', printingId: 'p', displayName: 'd', createdAtMs: 0 },
    });
    state = scannerSessionReducer(state, { type: 'ENTER_STACK_REVIEW' });
    state = scannerSessionReducer(state, { type: 'DISCARD_ALL' });
    expect(state.items).toHaveLength(0);
    expect(state.undoEntry).toBeNull();
    expect(state.phase).toBe('scanning');
  });

  // ---------- COMMIT -----------------------------------------
  it('COMMIT clears items and returns to scanning phase', () => {
    let state = INITIAL_STATE;
    state = scannerSessionReducer(state, { type: 'ENQUEUE_ITEM', item: makeItem(0) });
    state = scannerSessionReducer(state, { type: 'ENTER_STACK_REVIEW' });
    state = scannerSessionReducer(state, { type: 'COMMIT' });
    expect(state.items).toHaveLength(0);
    expect(state.phase).toBe('scanning');
  });

  // ---------- ENTER / EXIT STACK_REVIEW ----------------------
  it('ENTER_STACK_REVIEW transitions phase to stack-review', () => {
    const state = scannerSessionReducer(INITIAL_STATE, { type: 'ENTER_STACK_REVIEW' });
    expect(state.phase).toBe('stack-review');
  });

  it('EXIT_STACK_REVIEW transitions phase back to scanning', () => {
    let state = scannerSessionReducer(INITIAL_STATE, { type: 'ENTER_STACK_REVIEW' });
    state = scannerSessionReducer(state, { type: 'EXIT_STACK_REVIEW' });
    expect(state.phase).toBe('scanning');
  });

  // ---------- default -----------------------------------------
  it('returns unchanged state for unknown actions', () => {
    const state = scannerSessionReducer(INITIAL_STATE, {
      type: 'UNKNOWN_ACTION' as never,
    });
    expect(state).toBe(INITIAL_STATE);
  });
});
