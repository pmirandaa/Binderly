// React hook layer over the pure session reducer.
//
// The hook owns:
//
//   1. The session reducer (via `useReducer`).
//   2. Stable callback identities — every `useCallback` here uses
//      `dispatch` (stable across renders) so dependent
//      `useEffect`s in the screen don't churn.
//   3. The "attempt capture" plumbing — the actual photo capture +
//      quality evaluation is dependency-injected so tests can drive
//      the hook deterministically without touching a native module.
//      Production wires the injected callback to vision-camera's
//      `takePhoto()` + the live frame-processor's most recent
//      {@link CaptureQualityResult} (the frame-processor lives in
//      the screen layer; the hook stays pure).
//
// Re-exports `useCameraPermissionFlow` from the scanner barrel so
// the screen doesn't have to know about the cross-tree import
// path. We do NOT modify the scanner permission flow — the
// re-export is a thin pass-through.

import { useCallback, useMemo, useReducer } from 'react';


import { CAPTURE_STEPS } from './constants.js';
import { evaluateCaptureQuality } from './quality.js';
import {
  buildEmittedSession,
  createInitialSessionState,
  currentStep,
  reduceCaptureSession,
} from './session.js';
import { useCameraPermissionFlow } from '../../scanner/camera/index.js';

import type {
  CaptureFeedbackReason,
  CaptureQualityResult,
  CaptureSessionState,
  CaptureStepDefinition,
  GradingCaptureSession,
  GradingShot,
  GradingShotKind,
} from './types.js';

export { useCameraPermissionFlow };
export type { CameraPermissionFlow } from '../../scanner/camera/index.js';

/**
 * The shape the screen layer passes into {@link useCaptureSession.attemptCapture}.
 *
 * - `accepted`: the live frame-processor quality + a captured-still
 *   URI / dimensions. The hook will commit a {@link GradingShot}.
 * - `rejected`: the live frame-processor quality alone — no still
 *   was taken. The hook records the rejection reason for the
 *   feedback banner.
 *
 * Tests construct these directly. Production composes them from
 * vision-camera's `takePhoto()` result + the latest live quality
 * stream.
 */
export type CaptureAttemptInput =
  | {
      readonly outcome: 'accepted';
      readonly quality: CaptureQualityResult;
      readonly uri: string;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly outcome: 'rejected';
      readonly quality: CaptureQualityResult;
    };

/** Hook options. */
export interface UseCaptureSessionOptions {
  /**
   * Capture-attempt callback. Production wires this to a function
   * that:
   *   1. reads the latest live {@link CaptureQualityResult} from the
   *      frame-processor's JS-side ref;
   *   2. if `accepted`, awaits `camera.takePhoto()` and returns the
   *      URI + dimensions;
   *   3. if rejected, returns the live quality directly.
   */
  readonly attemptCapture: () => Promise<CaptureAttemptInput>;
  /**
   * Called exactly once when the final shot is accepted, with
   * the emitted {@link GradingCaptureSession}. Production wires
   * this to `router.push(CAPTURE_REVIEW_ROUTE)` after stashing
   * the session on the placeholder global ref.
   */
  readonly onSessionComplete?: (session: GradingCaptureSession) => void;
  /** Seed the session with a known id (testing). */
  readonly initialId?: string;
  /** Override `Date.now()` (testing). */
  readonly clock?: () => number;
}

/** Outcome of {@link UseCaptureSessionResult.attemptCapture}. */
export type CaptureAttempt =
  | {
      readonly outcome: 'accepted';
      readonly shot: GradingShot;
      readonly quality: CaptureQualityResult;
    }
  | {
      readonly outcome: 'rejected';
      readonly quality: CaptureQualityResult;
      readonly reason: CaptureFeedbackReason;
    };

/** Public hook surface. */
export interface UseCaptureSessionResult {
  readonly state: CaptureSessionState;
  /** Current step definition (`null` when complete). */
  readonly step: CaptureStepDefinition | null;
  /** All step definitions, in order. */
  readonly steps: ReadonlyArray<CaptureStepDefinition>;
  /**
   * Run the injected capture callback, evaluate the outcome, and
   * stage the result for the post-capture review modal. The reducer
   * is **not** mutated by this call; instead, the caller uses
   * {@link acceptShot} / {@link rejectShot} after the user accepts
   * or retakes (or the rejected-feedback banner is dismissed).
   */
  attemptCapture(): Promise<CaptureAttempt>;
  /** Commit a previously-attempted accepted shot. */
  acceptShot(shot: GradingShot): void;
  /** Record a quality-gate rejection (the user dismissed the modal). */
  rejectShot(reason: CaptureFeedbackReason): void;
  /** Retake a previously-accepted shot — walks back to that step. */
  retakeShot(kind: GradingShotKind): void;
  /** Reset the entire session. */
  resetSession(): void;
  /**
   * Read the current session if complete. The screen calls this
   * after the fourth accept to push to the review route.
   */
  emitSession(): GradingCaptureSession | null;
}

/**
 * Capture-session hook. See {@link UseCaptureSessionResult} for
 * the public surface.
 */
export function useCaptureSession(
  options: UseCaptureSessionOptions,
): UseCaptureSessionResult {
  const { attemptCapture: attempt, initialId, clock } = options;
  const now = useMemo<() => number>(() => clock ?? ((): number => Date.now()), [clock]);

  const [state, dispatch] = useReducer(
    reduceCaptureSession,
    null,
    () => createInitialSessionState({ id: initialId, startedAt: now() }),
  );

  const step = currentStep(state);

  const attemptCapture = useCallback<UseCaptureSessionResult['attemptCapture']>(async () => {
    const activeStep = CAPTURE_STEPS[state.stepIndex];
    if (activeStep === undefined) {
      throw new Error('attemptCapture: session is already complete');
    }
    const input = await attempt();
    if (input.outcome === 'rejected') {
      dispatch({ type: 'reject', reason: input.quality.reason });
      return {
        outcome: 'rejected',
        quality: input.quality,
        reason: input.quality.reason,
      };
    }
    const shot: GradingShot = {
      kind: activeStep.kind,
      uri: input.uri,
      width: input.width,
      height: input.height,
      quality: input.quality,
      capturedAt: now(),
    };
    return { outcome: 'accepted', shot, quality: input.quality };
  }, [attempt, now, state.stepIndex]);

  const acceptShot = useCallback<UseCaptureSessionResult['acceptShot']>(
    (shot) => {
      dispatch({ type: 'accept', shot });
    },
    [],
  );

  const rejectShot = useCallback<UseCaptureSessionResult['rejectShot']>(
    (reason) => {
      dispatch({ type: 'reject', reason });
    },
    [],
  );

  const retakeShot = useCallback<UseCaptureSessionResult['retakeShot']>(
    (kind) => {
      dispatch({ type: 'retake', kind });
    },
    [],
  );

  const resetSession = useCallback<UseCaptureSessionResult['resetSession']>(() => {
    dispatch({ type: 'reset', startedAt: now() });
  }, [now]);

  const emitSession = useCallback<UseCaptureSessionResult['emitSession']>(() => {
    return buildEmittedSession(state, now());
  }, [state, now]);

  return useMemo(
    () => ({
      state,
      step,
      steps: CAPTURE_STEPS,
      attemptCapture,
      acceptShot,
      rejectShot,
      retakeShot,
      resetSession,
      emitSession,
    }),
    [state, step, attemptCapture, acceptShot, rejectShot, retakeShot, resetSession, emitSession],
  );
}

/**
 * Convenience helper that composes a "pixel buffer producer" with
 * {@link evaluateCaptureQuality} into a {@link CaptureAttemptInput}.
 * Production wires this only when a CPU-side JPEG decoder is
 * available (none in v1); tests use it to keep their attempt
 * function expressive.
 */
export function evaluateAttemptFromPixels(
  input: {
    readonly pixels: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly uri: string;
  },
  coverageMin: number,
): CaptureAttemptInput {
  const quality = evaluateCaptureQuality(input.pixels, input.width, input.height, {
    coverageMin,
  });
  if (!quality.accepted) {
    return { outcome: 'rejected', quality };
  }
  return {
    outcome: 'accepted',
    quality,
    uri: input.uri,
    width: input.width,
    height: input.height,
  };
}
