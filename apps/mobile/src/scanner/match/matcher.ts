// Core matcher state machine.
//
// Subscribes to a stream of `DetectionEvent`s (via `observe(event)`
// — `use-scanner.ts` wires the upstream `DetectionSink`), runs the
// crop through `embedCrop()` → `searchKNN()` → confidence + stability
// gates, and emits `MatchResult`s on the JS-thread `MatchSink`.
//
// Concurrency posture: while an `embedCrop()` is in flight we keep
// at most one **pending** detection event (newest wins, oldest
// dropped). This matches the camera-task throttle posture (the
// worklet is already 10 FPS-capped upstream); the matcher never
// builds a queue of stale crops.
//
// Async error posture: `embedCrop` and `searchKNN` are both fallible
// — we catch + swallow each error so a single bad frame doesn't
// take the matcher down. The matcher continues with the next event.

import { classifyConfidence } from './confidence.js';
import {
  MATCH_AUTO_ADD_SCORE,
  MATCH_DISAMBIG_SCORE,
  MATCH_K,
  MATCH_QUEUE_CAP,
  MATCH_STABILITY_COUNT,
  MATCH_STACK_RESET_MS,
  MATCH_TOP_GAP_MIN,
} from './constants.js';
import { createMatchQueue } from './match-queue.js';
import { createMatchSink } from './match-sink.js';
import {
  advanceStability,
  clearStability,
  createStabilityState,
  engageCooldown,
} from './stability.js';

import type {
  MatchConfig,
  MatchDisposition,
  MatchResult,
  MatcherDeps,
  MatcherHandle,
} from './types.js';
import type { DetectionEvent } from '@/scanner/detect';

/** Defaults assembled from the per-constant exports for ergonomic spreading. */
export const MATCH_DEFAULTS: MatchConfig = Object.freeze({
  autoAddScore: MATCH_AUTO_ADD_SCORE,
  disambigScore: MATCH_DISAMBIG_SCORE,
  topGapMin: MATCH_TOP_GAP_MIN,
  stabilityCount: MATCH_STABILITY_COUNT,
  stackResetMs: MATCH_STACK_RESET_MS,
  k: MATCH_K,
  queueCap: MATCH_QUEUE_CAP,
});

/**
 * Build a matcher. The returned handle's `observe(event)` is what
 * `useScanner()` wires the upstream `DetectionSink` into.
 */
export function createMatcher(deps: MatcherDeps): MatcherHandle {
  const config: MatchConfig = { ...MATCH_DEFAULTS, ...(deps.config ?? {}) };
  if (config.k < 3) {
    throw new Error(
      `createMatcher: config.k must be >= 3 (need top-2 for gap + top-3 for disambig); got ${config.k}`,
    );
  }
  if (config.stabilityCount < 1) {
    throw new Error(
      `createMatcher: config.stabilityCount must be >= 1; got ${config.stabilityCount}`,
    );
  }
  const sink = deps.sink ?? createMatchSink();
  const queue = deps.queue ?? createMatchQueue(config.queueCap);
  const now = deps.now ?? defaultNow;

  const stability = createStabilityState();

  let disposed = false;
  let inFlight = false;
  /** Newest detection observed while an embed was running (newest-wins). */
  let pending: DetectionEvent | null = null;
  /** Count of detections observed since the last fire. */
  let framesSinceMatchCounter = 0;
  /** Sentinel so the first fire reports `framesSinceMatch: 0`. */
  let hasFiredOnce = false;

  /**
   * The actual per-event work. Async because `embedCrop()` is.
   * Errors are caught + swallowed so a single bad frame can't
   * kill the matcher.
   */
  async function process(event: DetectionEvent): Promise<void> {
    if (disposed) return;
    // Rejected frames have already been filtered upstream; we
    // defensive-check anyway so a misbehaving caller can't bypass
    // the gate.
    if (!event.accepted || event.cropped === null) return;

    framesSinceMatchCounter += 1;

    let embedding: Float32Array;
    try {
      embedding = await deps.embedCrop(event.cropped);
    } catch {
      // Single bad frame; carry on with the next event.
      return;
    }
    if (disposed) return;

    let candidates;
    try {
      candidates = deps.searchKNN(embedding, config.k);
    } catch {
      return;
    }
    if (disposed) return;

    const verdict = classifyConfidence(candidates, config);
    if (verdict.disposition === 'reject') {
      // Reject doesn't advance the stability counter — a low-conf
      // frame between two high-conf frames shouldn't break the
      // stability chain (the detect-stage already filtered bad
      // crops; "low ANN score" usually means "different card in
      // frame", and that's caught by the printingId-changed
      // branch in advanceStability).
      return;
    }

    const advance = advanceStability(
      stability,
      verdict.printingId,
      event.ts,
      config.stabilityCount,
      config.stackResetMs,
    );
    if (!advance.shouldFire) return;

    fire({
      printingId: verdict.printingId,
      confidence: verdict.confidence,
      topGap: verdict.topGap,
      disposition: verdict.disposition as MatchDisposition,
      candidates,
      stabilityCount: advance.count,
    });
  }

  function fire(args: {
    printingId: string;
    confidence: number;
    topGap: number;
    disposition: MatchDisposition;
    candidates: readonly import('@/scanner/ann').AnnSearchResult[];
    stabilityCount: number;
  }): void {
    const result: MatchResult = {
      printingId: args.printingId,
      confidence: args.confidence,
      topGap: args.topGap,
      disposition: args.disposition,
      candidates: [...args.candidates],
      stabilityCount: args.stabilityCount,
      framesSinceMatch: hasFiredOnce ? framesSinceMatchCounter : 0,
      emittedAtMs: now(),
    };
    engageCooldown(stability, args.printingId);
    queue.enqueue(result);
    sink.emit(result);
    hasFiredOnce = true;
    framesSinceMatchCounter = 0;
  }

  /**
   * Drain the pending event slot. Called after each `process()`
   * settles. The slot may have been overwritten multiple times
   * while the embed was running — we always pick the newest.
   */
  async function drainPending(): Promise<void> {
    while (!disposed && pending !== null) {
      const next = pending;
      pending = null;
      try {
        await process(next);
      } catch {
        // process() catches its own errors; this is a belt-and-
        // braces guard against the unlikely case where a synchronous
        // throw escapes through one of the dependency hooks.
      }
    }
  }

  return {
    sink,
    queue,
    config,
    isMatching(): boolean {
      return inFlight;
    },

    async observe(event: DetectionEvent): Promise<void> {
      if (disposed) return;

      // Off-worklet posture: this is a JS-thread method; the
      // worklet hop already happened upstream in
      // `useDetectFrameProcessor`. We never invoke `runOnJS` from
      // here, so there's no deadlock surface — embed and search
      // both run on whichever microtask the await schedules.

      if (!event.accepted || event.cropped === null) {
        // Rejected upstream — the detect stage already filtered
        // these out. We do still let an extended-gap detection
        // event update the cooldown timer: by NOT counting this
        // event into `framesSinceMatchCounter` or advancing
        // stability, a 'rejected' run looks the same as a missed
        // frame.
        return;
      }

      if (inFlight) {
        // Back-pressure: drop the oldest pending event in favour
        // of the newest. The matcher is async-debouncing.
        pending = event;
        return;
      }

      inFlight = true;
      try {
        await process(event);
        await drainPending();
      } finally {
        inFlight = false;
      }
    },

    dispose(): void {
      disposed = true;
      pending = null;
      clearStability(stability);
    },
  };
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
