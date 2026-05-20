// Public types for the scanner read-path closer.
//
// Designed to be the contract T-SC-UX docks onto. We deliberately
// keep the surface readonly + JSON-scalar / typed-array shaped so
// the same events can later be tunneled through `useRunOnJS` or a
// PostHog wrapper without re-encoding.
//
// The matcher itself never imports React — `use-scanner.ts` is the
// only file that does. That keeps the core state machine
// trivially unit-testable.

import type { AnnSearchResult } from '@/scanner/ann';
import type { DetectionSink } from '@/scanner/detect';

/** What kind of UI action a `MatchResult` is asking T-SC-UX to take. */
export type MatchDisposition = 'auto-add' | 'disambiguate';

/**
 * A confidence + stability-gated match the UI should act on.
 *
 * Emitted on the {@link MatchSink} exactly once per stable
 * recognition. The UI converts an `'auto-add'` into a silent
 * collection-item insert + toast; a `'disambiguate'` into the
 * top-3 picker.
 */
export interface MatchResult {
  /** Top-1 catalog `printing.id` (the recognised card). */
  readonly printingId: string;
  /** Top-1 cosine ∈ [-1, 1]. Larger = more confident. */
  readonly confidence: number;
  /** `top1.score - top2.score`. `+Infinity` when only one candidate. */
  readonly topGap: number;
  /** What action the UI should take. */
  readonly disposition: MatchDisposition;
  /**
   * Top-K candidates the search produced, ordered by descending
   * score. The disambiguation picker reads the first 3; the
   * debug overlay (when wired) can read the tail.
   */
  readonly candidates: readonly AnnSearchResult[];
  /** Consecutive accepted frames at this printing that produced this fire. */
  readonly stabilityCount: number;
  /**
   * Frames observed since the *previous* emitted match. `0` on
   * the very first fire of a scanner session. Useful for the UI
   * to gate "looks like a stack scan" affordances.
   */
  readonly framesSinceMatch: number;
  /** JS-thread monotonic timestamp the match fired at (`performance.now()`). */
  readonly emittedAtMs: number;
}

/** Listener registered against a {@link MatchSink}. */
export type MatchListener = (result: MatchResult) => void;

/**
 * JS-thread subscriber bus. Mirrors `DetectionSink` from
 * `scanner/detect/` so the UI layer's mental model is the same on
 * both ends of the pipeline.
 */
export interface MatchSink {
  /** Surface a match to subscribers. Called by the matcher. */
  emit(result: MatchResult): void;
  /** Subscribe; returns an unsubscribe function. */
  subscribe(listener: MatchListener): () => void;
  /** Most recent fired match, or `null` if none yet. */
  last(): MatchResult | null;
  /** Drop the cached last-fire. */
  clear(): void;
}

/**
 * Bounded in-session FIFO of fired matches. T-SC-UX reads this to
 * render the "12 cards added — Done" footer and to batch-add on
 * session end.
 */
export interface MatchQueue {
  /** Push a fired match. Drops the oldest if the cap is exceeded. */
  enqueue(result: MatchResult): void;
  /** Snapshot of pending matches without modifying the queue. */
  peek(): readonly MatchResult[];
  /** Return + clear all pending matches (atomic). */
  flush(): readonly MatchResult[];
  /** Most-recently enqueued match, or `null` when empty. */
  latest(): MatchResult | null;
  /** Drop all pending matches without returning them. */
  clear(): void;
  /** Current queue depth (0 ≤ size ≤ cap). */
  readonly size: number;
  /** Hard cap configured at construction time. */
  readonly cap: number;
}

/**
 * Confidence + stability + stack-mode knobs. Defaults come from
 * `./constants.ts`. T-SC-UX is allowed to override per-render
 * (e.g. a dev-menu slider) by threading a partial config through
 * `useScanner()`.
 */
export interface MatchConfig {
  /** Top-1 score ≥ this AND gap ≥ {@link topGapMin} → auto-add. */
  readonly autoAddScore: number;
  /** Top-1 score ≥ this (but below auto-add) → disambiguate. */
  readonly disambigScore: number;
  /** Minimum `top1 - top2` for auto-add. */
  readonly topGapMin: number;
  /** Same `printingId` across N consecutive accepted frames → fire. */
  readonly stabilityCount: number;
  /**
   * Gap (ms) between accepted detections that resets the
   * stability counter + releases the post-fire cooldown.
   */
  readonly stackResetMs: number;
  /** Top-K depth fetched from `searchKNN()`. Must be ≥ 3. */
  readonly k: number;
  /** Hard cap on the {@link MatchQueue} depth. */
  readonly queueCap: number;
}

/**
 * Embedding adapter — bridges the detect-stage Float32 crop into
 * an embedding vector. The matcher accepts this as a dependency
 * rather than calling `EmbeddingModelHandle.embed()` directly:
 *
 *   - `embed()` takes an `EmbedFrameInput` (raw uint8 RGB +
 *     `width` / `height` + `toArrayBuffer()`).
 *   - The detect stage already emitted a 224×224×3 mobilenet_v3-
 *     normalised Float32Array.
 *
 * Re-uploading the Float32 buffer through the `EmbedFrameInput`
 * interface would corrupt the data (preprocessor would re-resize
 * + re-normalise). The bridge lives in T-SC-UX where the scanner
 * screen owns both handles; this layer stays decoupled.
 *
 * Returning a Promise<Float32Array> (length === embeddingDim,
 * L2-normalised) matches `EmbeddingModelHandle.embed`'s shape.
 */
export type EmbedCrop = (crop: Float32Array) => Promise<Float32Array>;

/**
 * Search adapter — the matcher accepts this as a dependency
 * rather than holding a reference to the `AnnIndexHandle`. Same
 * decoupling story as {@link EmbedCrop}: tests pass a mock
 * trivially; production wires `handle.searchKNN.bind(handle)`.
 */
export type SearchFn = (query: Float32Array, k: number) => readonly AnnSearchResult[];

/**
 * Everything the matcher needs to do its job, threaded through
 * `createMatcher` and `useScanner`.
 */
export interface MatcherDeps {
  /** The async bridge into the embedding model. */
  readonly embedCrop: EmbedCrop;
  /** The synchronous bridge into the ANN index. */
  readonly searchKNN: SearchFn;
  /** Where fired matches land. Defaults to a fresh internal sink. */
  readonly sink?: MatchSink;
  /** Where fired matches accumulate. Defaults to a fresh internal queue. */
  readonly queue?: MatchQueue;
  /** Tunable overrides. Defaults come from {@link MATCH_DEFAULTS}. */
  readonly config?: Partial<MatchConfig>;
  /**
   * Monotonic time source. Defaults to `performance.now()` (with a
   * `Date.now()` fallback). Injected for deterministic stability /
   * cooldown tests.
   */
  readonly now?: () => number;
}

/**
 * Result of `createMatcher()`. The matcher subscribes to the
 * upstream `DetectionSink` on its caller's behalf; the caller
 * (`useScanner`) owns the cleanup.
 */
export interface MatcherHandle {
  /**
   * Feed a detection event into the matcher. Rejected events
   * (`accepted: false` / `cropped: null`) are dropped at the door.
   * Returns a promise that resolves after the matcher has finished
   * processing this event (including any embed + search). Used by
   * tests to await the async chain deterministically; production
   * fires and forgets.
   */
  observe(event: import('@/scanner/detect').DetectionEvent): Promise<void>;
  /** Detach from any upstream sink and stop emitting. Idempotent. */
  dispose(): void;
  /** The bus subscribers attach to. */
  readonly sink: MatchSink;
  /** The in-session queue of fired matches. */
  readonly queue: MatchQueue;
  /** Snapshot of the live, merged configuration. */
  readonly config: MatchConfig;
  /** True while an `embedCrop()` is in flight. */
  readonly isMatching: () => boolean;
}

/**
 * Options accepted by the React entry point `useScanner()`. The
 * upstream `DetectionSink` is a hard requirement; everything else
 * mirrors {@link MatcherDeps}.
 */
export interface UseScannerOptions {
  readonly detectionSink: DetectionSink;
  readonly embedCrop: EmbedCrop;
  readonly searchKNN: SearchFn;
  readonly config?: Partial<MatchConfig>;
  readonly now?: () => number;
}

/** Subset of `MatcherHandle` `useScanner()` returns to React callers. */
export interface UseScannerResult {
  readonly sink: MatchSink;
  readonly queue: MatchQueue;
  readonly isMatching: boolean;
  readonly config: MatchConfig;
}
