// JS-side telemetry sink for the frame-processor worklet.
//
// The worklet hops over `runOnJS` to call `observe()` for every
// frame it lets through the FPS gate. The sink:
//
//   1. Retains a ring of recent timestamps so the debug FPS badge
//      has a smooth sliding-window estimate.
//   2. Notifies subscribers each time a new event lands. Components
//      subscribe via `useFrameTelemetry()` (see component code) and
//      re-render off the snapshot.
//   3. Never touches frame bytes. Per `rules/06-scanner.md`
//      on-device only — only the small `FrameTelemetryEvent`
//      metadata crosses the bridge.

import { FRAME_TELEMETRY_RING_SIZE } from './constants.js';
import { createRingBuffer } from './ring-buffer.js';

import type {
  FrameTelemetryEvent,
  FrameTelemetryListener,
  FrameTelemetrySink,
  FrameTelemetrySnapshot,
} from './types.js';

interface CreateFrameTelemetrySinkOptions {
  /**
   * Override the ring size. Tests pass small numbers so they can
   * fill the buffer with a few events; production should leave this
   * unset and inherit {@link FRAME_TELEMETRY_RING_SIZE}.
   */
  readonly ringSize?: number;
}

/**
 * Build a stand-alone {@link FrameTelemetrySink}. One sink per
 * scan-screen mount (the ScanScreen wires it as a `useMemo` so its
 * identity is stable across re-renders).
 */
export function createFrameTelemetrySink(
  options: CreateFrameTelemetrySinkOptions = {},
): FrameTelemetrySink {
  const ring = createRingBuffer<FrameTelemetryEvent>(
    options.ringSize ?? FRAME_TELEMETRY_RING_SIZE,
  );
  const listeners = new Set<FrameTelemetryListener>();

  function computeFps(): number | null {
    if (ring.size < 2) return null;
    const events = ring.snapshot();
    const first = events[0];
    const last = events[events.length - 1];
    if (first === undefined || last === undefined) return null;
    const elapsedMs = last.ts - first.ts;
    if (elapsedMs <= 0) return null;
    // (n-1) gaps across n samples — the classic FPS estimator.
    return ((events.length - 1) * 1_000) / elapsedMs;
  }

  function snapshot(): FrameTelemetrySnapshot {
    return {
      fps: computeFps(),
      lastEvent: ring.last(),
      sampleCount: ring.size,
    };
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const next = snapshot();
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {
        // A misbehaving subscriber must not poison the others. We
        // swallow here intentionally — the worklet thread keeps
        // pushing frames regardless.
      }
    }
  }

  return {
    observe(event: FrameTelemetryEvent): void {
      ring.push(event);
      notify();
    },
    subscribe(listener: FrameTelemetryListener): () => void {
      listeners.add(listener);
      // Prime the subscriber so it doesn't render `null` for one
      // frame on mount when samples already exist.
      try {
        listener(snapshot());
      } catch {
        // See notify().
      }
      return (): void => {
        listeners.delete(listener);
      };
    },
    fps(): number | null {
      return computeFps();
    },
    clear(): void {
      ring.clear();
      notify();
    },
  };
}
