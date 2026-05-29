// Capture-button state derivation (#FU-33).
//
// Pure function mapping the live frame-processor quality sample (if
// any) + the session/busy state to the capture button's label,
// disabled flag, and the feedback reason to surface before the user
// taps. Pulled out of the screen so the decision table is unit-
// testable without rendering React.
//
// Fallback posture: when there's **no** live quality sample
// (`liveQuality === null` — e.g. the native frame processor isn't
// available, or no frame has arrived yet) the button keeps its
// original tap-driven behaviour (enabled, "Capture"). The live
// sample only ever *adds* pre-tap feedback; it never blocks a flow
// that has no camera.

import type { CaptureFeedbackReason, CaptureQualityResult } from './types.js';

export interface CaptureButtonState {
  /** Whether the capture CTA is disabled. */
  readonly disabled: boolean;
  /** Button label. */
  readonly label: string;
  /**
   * Feedback reason to surface from the live sample (drives the
   * banner before a tap). `null` when there's nothing live to show.
   */
  readonly liveReason: CaptureFeedbackReason | null;
}

export interface DeriveCaptureButtonStateInput {
  /** Latest live quality sample, or `null` when none is available. */
  readonly liveQuality: CaptureQualityResult | null;
  /** True when the session is complete (no active step). */
  readonly sessionComplete: boolean;
  /** True while a `takePhoto()` capture is in flight. */
  readonly busy: boolean;
}

/**
 * Derive the capture-button state. Priority:
 *
 *   1. Session complete → "Done", disabled (nothing left to shoot).
 *   2. Busy → disabled (prevents double-tap; label stays "Capture").
 *   3. No live sample → enabled "Capture" (tap-driven fallback).
 *   4. Live sample, not accepted → disabled "Hold steady", surface
 *      the live reason so the banner coaches the fix.
 *   5. Live sample, accepted → enabled "Capture", liveReason `great`.
 */
export function deriveCaptureButtonState(
  input: DeriveCaptureButtonStateInput,
): CaptureButtonState {
  if (input.sessionComplete) {
    return { disabled: true, label: 'Done', liveReason: null };
  }
  if (input.busy) {
    return { disabled: true, label: 'Capture', liveReason: null };
  }
  if (input.liveQuality === null) {
    return { disabled: false, label: 'Capture', liveReason: null };
  }
  if (!input.liveQuality.accepted) {
    return { disabled: true, label: 'Hold steady', liveReason: input.liveQuality.reason };
  }
  return { disabled: false, label: 'Capture', liveReason: 'great' };
}
