// JS-thread bus for detection events forwarded from the worklet.
//
// Mirrors the camera task's `createFrameTelemetrySink()` posture
// — one bus per scan-screen mount; subscribers attach via
// `subscribe()` and receive a callback per event. The sink is
// deliberately tiny so the worklet-to-JS hop stays cheap.

import type {
  DetectionEvent,
  DetectionListener,
  DetectionSink,
} from './types.js';

/**
 * Build a fresh detection sink. Callers are expected to memoize
 * the reference across re-renders (e.g. via `useMemo`) so the
 * worklet adapter's `useRunOnJS` closure stays stable.
 */
export function createDetectionSink(): DetectionSink {
  const listeners = new Set<DetectionListener>();
  let lastEvent: DetectionEvent | null = null;

  function notify(event: DetectionEvent): void {
    if (listeners.size === 0) return;
    for (const fn of [...listeners]) {
      try {
        fn(event);
      } catch {
        // A misbehaving subscriber must not block the worklet
        // hot path. We swallow here intentionally — observability
        // wrappers handle their own error capture.
      }
    }
  }

  return {
    observe(event: DetectionEvent): void {
      lastEvent = event;
      notify(event);
    },
    subscribe(listener: DetectionListener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    last(): DetectionEvent | null {
      return lastEvent;
    },
    clear(): void {
      lastEvent = null;
    },
  };
}
