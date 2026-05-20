// Tiny synchronous event bus for embed-pipeline telemetry.
//
// T-SC-MATCH subscribes to receive per-frame latency events so the
// scanner UI can warn the user when scans are too slow ("Scans are
// running slowly on this device — try better lighting"). Keeping
// this in-process (rather than going through PostHog or a global
// EventEmitter) means the worklet thread can fire without crossing
// the JS bridge.
//
// The emitter intentionally does NOT use Node's `events` module —
// React Native ships only a partial Node shim and we'd have to pull
// in `events`. A 30-line, dependency-free implementation is plenty.

import type { EmbedTelemetryEvent } from './types';

export type EmbedTelemetryListener = (event: EmbedTelemetryEvent) => void;

export interface EmbedTelemetryEmitter {
  /** Register a listener; returns an unsubscribe function. */
  on(listener: EmbedTelemetryListener): () => void;
  /** Fire `event` to every registered listener. */
  emit(event: EmbedTelemetryEvent): void;
  /** Count of currently-registered listeners — used by tests. */
  readonly listenerCount: number;
}

export function createEmbedTelemetry(): EmbedTelemetryEmitter {
  const listeners = new Set<EmbedTelemetryListener>();

  return {
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      // Snapshot before iterating — listeners may unsubscribe inside
      // their own handler.
      for (const fn of [...listeners]) {
        try {
          fn(event);
        } catch {
          // A misbehaving listener must not break inference. We
          // intentionally swallow — Sentry/PostHog wrappers
          // (`packages/observability`) capture their own errors.
        }
      }
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

/**
 * Process-wide default emitter — the loader fires through this so
 * any module can subscribe without threading an emitter through the
 * camera screen tree.
 *
 * Tests mint their own emitter via `createEmbedTelemetry()` and pass
 * it explicitly to keep listener state hermetic.
 */
export const embedTelemetry: EmbedTelemetryEmitter = createEmbedTelemetry();
