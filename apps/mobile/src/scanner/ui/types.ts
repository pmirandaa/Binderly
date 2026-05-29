// UI-local types for the scanner screen + match-result overlay.
//
// Kept separate from `scanner/match/types.ts` so the view layer's
// concepts (undo entry, session item, load phase) don't bleed into
// the read-path module.

import type { MatchResult } from '../match/index.js';

/** Which broad phase the scanner screen is in. */
export type ScannerPhase = 'scanning' | 'stack-review';

/**
 * Scanner capture mode (FU-57). `single` is the free experience —
 * one capture → one match → confirm/add, no continuous accumulation.
 * `continuous` is the Pro stack scanner (auto-add loop + stack-review),
 * gated behind the `stack_scanner` paid feature.
 */
export type ScanMode = 'single' | 'continuous';

/** Async load state for the embedding model + ANN index. */
export type ModelLoadPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelLoadState {
  readonly phase: ModelLoadPhase;
  readonly error: Error | null;
}

/**
 * One committed item in the live scan session.
 *
 * When a match fires (auto-add or disambiguate-confirm) the item
 * is added to the collection and simultaneously tracked here so
 * the session footer, stack panel, and undo flow all read the same
 * source of truth.
 */
export interface SessionItem {
  /** The `collection_item.id` returned by the API after insert. */
  readonly collectionItemId: string;
  /** The matched printing (top-1 from the ANN search). */
  readonly printingId: string;
  /**
   * Friendly display name. Populated from the API response or
   * synthesised as `printingId` until the catalog metadata loads.
   */
  readonly displayName: string;
  /** ISO timestamp of when the item was committed. */
  readonly committedAt: string;
  /** Original match result — kept for the debug overlay. */
  readonly matchResult: MatchResult;
}

/**
 * A pending undo entry. Created immediately after a successful add;
 * removed when the undo timer fires (item is kept) or the user
 * presses "Undo" (item is deleted).
 */
export interface UndoEntry {
  readonly collectionItemId: string;
  readonly printingId: string;
  readonly displayName: string;
  /** `performance.now()` when the entry was created. */
  readonly createdAtMs: number;
}

/** How many ms the undo toast remains visible. */
export const UNDO_TIMEOUT_MS = 5_000;

/** Maximum number of session items we track (mirrors `MATCH_QUEUE_CAP`). */
export const SESSION_ITEM_CAP = 32;
