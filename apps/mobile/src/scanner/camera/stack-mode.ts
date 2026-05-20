// Stack-mode reset detector — placeholder.
//
// Stack mode (per `PROJECT.md` § 11 and `rules/06-scanner.md`) is
// continuous single-card scanning with a reset heuristic that fires
// when:
//
//   1. The card is removed from the frame for ≥ 300ms, OR
//   2. A "different card geometry" is observed.
//
// The downstream pipeline ignores both signals until T-SC-DETECT
// fills in real geometry tracking. This module ships the **seam**:
//
//   - A ring buffer of the most recent frame events.
//   - An `observe()` + `signal()` contract that the scan controller
//     calls per frame.
//   - A documented `// TODO: T-SC-DETECT` block where the real
//     algorithm slots in.
//
// Today `signal()` always returns `'stable'`. T-SC-UX can wire
// session-counter behaviour to the reset events ahead of T-SC-DETECT
// landing; nothing actually fires until the detection algorithm
// exists, but the contract is in place.

import { STACK_MODE_RING_SIZE } from './constants.js';
import { createRingBuffer, type RingBuffer } from './ring-buffer.js';

import type { FrameTelemetryEvent, StackModeSignal } from './types.js';

export interface StackModeDetector {
  /** Tell the detector about a new frame from the worklet. */
  observe(event: FrameTelemetryEvent): void;
  /** Current reset signal. Pure function over the buffered state. */
  signal(): StackModeSignal;
  /** Forget the buffered history (e.g. on screen blur). */
  reset(): void;
  /**
   * Internal — exposed for tests and for the future T-SC-DETECT
   * integration. Returns the ring buffer of recent frame events so
   * the real algorithm can read whatever geometry data the
   * placeholder accumulates.
   */
  __buffer(): RingBuffer<FrameTelemetryEvent>;
}

interface CreateStackModeDetectorOptions {
  /** Override the ring size for tests. */
  readonly ringSize?: number;
}

/**
 * Build a new stack-mode detector. One detector per scan-screen
 * mount.
 */
export function createStackModeDetector(
  options: CreateStackModeDetectorOptions = {},
): StackModeDetector {
  const buffer = createRingBuffer<FrameTelemetryEvent>(
    options.ringSize ?? STACK_MODE_RING_SIZE,
  );

  return {
    observe(event: FrameTelemetryEvent): void {
      buffer.push(event);
    },
    signal(): StackModeSignal {
      // TODO: T-SC-DETECT will fill this in.
      //
      // The real implementation walks `buffer.snapshot()` and
      // returns `'reset'` when either:
      //   (a) The most recent N frames show no rectangle (card
      //       removed from frame), spanning ≥
      //       STACK_MODE_RESET_WINDOW_MS.
      //   (b) A new stable rectangle differs in geometry from the
      //       previous stable rectangle (different card).
      //
      // Until that lands, we never emit a reset — the
      // pipeline behaves as one long continuous scan, which is
      // safe because no scans actually trigger yet (T-SC-MATCH
      // hasn't shipped).
      return 'stable';
    },
    reset(): void {
      buffer.clear();
    },
    __buffer(): RingBuffer<FrameTelemetryEvent> {
      return buffer;
    },
  };
}
