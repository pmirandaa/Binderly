// JS-thread bus for fired match events.
//
// Symmetrical to `createDetectionSink()` in `scanner/detect/`. One
// bus per scanner-screen mount; T-SC-UX subscribes for the toast
// + collection-insert paths; the debug overlay (when wired) can
// subscribe a separate listener.

import type { MatchListener, MatchResult, MatchSink } from './types.js';

/**
 * Build a fresh match sink. Callers `useMemo` the reference across
 * re-renders so subscriptions don't churn.
 */
export function createMatchSink(): MatchSink {
  const listeners = new Set<MatchListener>();
  let lastResult: MatchResult | null = null;

  function notify(result: MatchResult): void {
    if (listeners.size === 0) return;
    for (const fn of [...listeners]) {
      try {
        fn(result);
      } catch {
        // A misbehaving subscriber must not block the matcher's
        // hot path. Observability wrappers handle their own error
        // capture; intentional swallow here mirrors the detect
        // sink's posture.
      }
    }
  }

  return {
    emit(result: MatchResult): void {
      lastResult = result;
      notify(result);
    },
    subscribe(listener: MatchListener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    last(): MatchResult | null {
      return lastResult;
    },
    clear(): void {
      lastResult = null;
    },
  };
}
