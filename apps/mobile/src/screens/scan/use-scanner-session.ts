// `useScannerSession` — pure state machine + hook for the scan session.
//
// Manages the committed-item list, undo entries, and the phase
// transition (`scanning` → `stack-review` → back).
//
// The reducer is exported separately so unit tests can drive it
// without mounting React.

import { useCallback, useReducer } from 'react';

import { SESSION_ITEM_CAP } from '../../scanner/ui/types.js';

import type { SessionItem, ScannerPhase, UndoEntry } from '../../scanner/ui/types.js';

// ============================================================
// State shape
// ============================================================

export interface ScannerSessionState {
  readonly phase: ScannerPhase;
  /** Committed items (kept in add order). */
  readonly items: readonly SessionItem[];
  /** Pending undo entry (only one at a time — newest auto-add). */
  readonly undoEntry: UndoEntry | null;
}

const INITIAL_STATE: ScannerSessionState = {
  phase: 'scanning',
  items: [],
  undoEntry: null,
};

// ============================================================
// Actions
// ============================================================

export type ScannerSessionAction =
  | { type: 'ENQUEUE_ITEM'; item: SessionItem }
  | { type: 'SET_UNDO_ENTRY'; entry: UndoEntry | null }
  | { type: 'REMOVE_ITEM'; collectionItemId: string }
  | { type: 'DISCARD_ALL' }
  | { type: 'COMMIT' }
  | { type: 'ENTER_STACK_REVIEW' }
  | { type: 'EXIT_STACK_REVIEW' };

// ============================================================
// Reducer
// ============================================================

/**
 * Pure reducer — exported for unit tests. No React dependency.
 */
export function scannerSessionReducer(
  state: ScannerSessionState,
  action: ScannerSessionAction,
): ScannerSessionState {
  switch (action.type) {
    case 'ENQUEUE_ITEM': {
      const next = [...state.items, action.item];
      // Enforce cap — drop the oldest if we exceed it.
      while (next.length > SESSION_ITEM_CAP) next.shift();
      return { ...state, items: next };
    }

    case 'SET_UNDO_ENTRY': {
      return { ...state, undoEntry: action.entry };
    }

    case 'REMOVE_ITEM': {
      return {
        ...state,
        items: state.items.filter(
          (item) => item.collectionItemId !== action.collectionItemId,
        ),
        undoEntry:
          state.undoEntry?.collectionItemId === action.collectionItemId
            ? null
            : state.undoEntry,
      };
    }

    case 'DISCARD_ALL': {
      return {
        ...state,
        phase: 'scanning',
        items: [],
        undoEntry: null,
      };
    }

    case 'COMMIT': {
      return {
        ...state,
        phase: 'scanning',
        items: [],
        undoEntry: null,
      };
    }

    case 'ENTER_STACK_REVIEW': {
      return { ...state, phase: 'stack-review' };
    }

    case 'EXIT_STACK_REVIEW': {
      return { ...state, phase: 'scanning' };
    }

    default: {
      return state;
    }
  }
}

// ============================================================
// Hook
// ============================================================

export interface ScannerSessionHandle {
  readonly state: ScannerSessionState;
  enqueueItem(item: SessionItem): void;
  setUndoEntry(entry: UndoEntry | null): void;
  removeItem(collectionItemId: string): void;
  discardAll(): void;
  commit(): void;
  enterStackReview(): void;
  exitStackReview(): void;
}

export function useScannerSession(): ScannerSessionHandle {
  const [state, dispatch] = useReducer(scannerSessionReducer, INITIAL_STATE);

  const enqueueItem = useCallback((item: SessionItem): void => {
    dispatch({ type: 'ENQUEUE_ITEM', item });
  }, []);

  const setUndoEntry = useCallback((entry: UndoEntry | null): void => {
    dispatch({ type: 'SET_UNDO_ENTRY', entry });
  }, []);

  const removeItem = useCallback((collectionItemId: string): void => {
    dispatch({ type: 'REMOVE_ITEM', collectionItemId });
  }, []);

  const discardAll = useCallback((): void => {
    dispatch({ type: 'DISCARD_ALL' });
  }, []);

  const commit = useCallback((): void => {
    dispatch({ type: 'COMMIT' });
  }, []);

  const enterStackReview = useCallback((): void => {
    dispatch({ type: 'ENTER_STACK_REVIEW' });
  }, []);

  const exitStackReview = useCallback((): void => {
    dispatch({ type: 'EXIT_STACK_REVIEW' });
  }, []);

  return {
    state,
    enqueueItem,
    setUndoEntry,
    removeItem,
    discardAll,
    commit,
    enterStackReview,
    exitStackReview,
  };
}
