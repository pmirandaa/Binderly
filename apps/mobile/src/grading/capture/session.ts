// Capture session reducer — pure, testable.
//
// The session is a tiny state machine over the guided capture
// flow (one step per shot in CAPTURE_STEPS — the full PROJECT.md
// § 12 set). Operations are pure (state in, state out) so the hook layer
// can drive them with a `useReducer` and the tests can pin
// progression behaviour without rendering React.
//
// Re-entry behaviour: the reducer **persists** partial progress for
// the lifetime of the holding hook. Re-mounting the screen
// (component unmount + re-mount) starts a fresh session — we did
// not add an AsyncStorage layer in v1 (see task brief § UX
// decisions; tracked as a follow-up). Tab navigation away and back
// keeps the screen mounted under the tabs router, so the session
// survives that path.

import { CAPTURE_KINDS, CAPTURE_STEP_COUNT, CAPTURE_STEPS } from './constants.js';

import type {
  CaptureFeedbackReason,
  CaptureSessionState,
  CaptureStepDefinition,
  GradingCaptureSession,
  GradingShot,
  GradingShotKind,
} from './types.js';

/**
 * Create a fresh session at step 1 with no accepted shots. `id`
 * defaults to a short ULID-ish stamp; tests can pass a fixed id
 * for deterministic assertions.
 */
export function createInitialSessionState(
  options: { id?: string; startedAt?: number } = {},
): CaptureSessionState {
  const startedAt = options.startedAt ?? Date.now();
  const id = options.id ?? `gcs-${startedAt}-${Math.floor(Math.random() * 1e6)}`;
  return {
    id,
    startedAt,
    stepIndex: 0,
    shots: {},
    lastReason: null,
    isComplete: false,
  };
}

/**
 * Session reducer actions.
 *
 * - `accept` — a capture passed the quality gate; record it and
 *   advance to the next step.
 * - `reject` — a capture failed; record the reason without
 *   advancing.
 * - `retake` — drop a previously-accepted shot and re-enter that
 *   step. Used by the post-capture review modal when the user
 *   taps "Retake" instead of "Accept", or by the "Re-take" button
 *   on a finished session before navigating away.
 * - `reset` — start over (fresh id, fresh timestamps, no shots).
 */
export type CaptureSessionAction =
  | { readonly type: 'accept'; readonly shot: GradingShot }
  | { readonly type: 'reject'; readonly reason: CaptureFeedbackReason }
  | { readonly type: 'retake'; readonly kind: GradingShotKind }
  | { readonly type: 'reset'; readonly id?: string; readonly startedAt?: number };

/**
 * Apply an action to a session state. Pure.
 *
 * `accept` is a no-op if a shot for the current step has already
 * been accepted (defensive — the screen shouldn't dispatch a
 * second accept, but the reducer treats it as idempotent).
 */
export function reduceCaptureSession(
  state: CaptureSessionState,
  action: CaptureSessionAction,
): CaptureSessionState {
  switch (action.type) {
    case 'accept': {
      const step = CAPTURE_STEPS[state.stepIndex];
      if (step === undefined) return state; // already complete
      if (action.shot.kind !== step.kind) return state; // out-of-order
      if (state.shots[step.kind] !== undefined) return state; // duplicate
      const nextShots: CaptureSessionState['shots'] = {
        ...state.shots,
        [step.kind]: action.shot,
      };
      const nextIndex = state.stepIndex + 1;
      const nextComplete = nextIndex >= CAPTURE_STEP_COUNT;
      return {
        ...state,
        stepIndex: nextIndex,
        shots: nextShots,
        lastReason: 'great',
        isComplete: nextComplete,
      };
    }
    case 'reject': {
      return { ...state, lastReason: action.reason };
    }
    case 'retake': {
      if (state.shots[action.kind] === undefined) return state;
      const nextShots: CaptureSessionState['shots'] = { ...state.shots };
      delete nextShots[action.kind];
      // Walk back to the earliest missing step so we always re-take
      // in order. The scan is O(n) over the fixed CAPTURE_KINDS list.
      let walkbackIndex = state.stepIndex;
      for (let i = 0; i < CAPTURE_KINDS.length; i += 1) {
        if (nextShots[CAPTURE_KINDS[i] as GradingShotKind] === undefined) {
          walkbackIndex = i;
          break;
        }
      }
      return {
        ...state,
        stepIndex: walkbackIndex,
        shots: nextShots,
        lastReason: null,
        isComplete: false,
      };
    }
    case 'reset': {
      return createInitialSessionState({
        id: action.id,
        startedAt: action.startedAt,
      });
    }
    default: {
      // Exhaustiveness: TypeScript will complain if a new action
      // arm is added without a case. The runtime branch never fires.
      const _exhaust: never = action;
      void _exhaust;
      return state;
    }
  }
}

/** True iff every shot has been accepted. */
export function isComplete(state: CaptureSessionState): boolean {
  return state.isComplete;
}

/**
 * Current step (or `null` when the session is complete and the
 * caller should navigate to the next screen).
 */
export function currentStep(state: CaptureSessionState): CaptureStepDefinition | null {
  return CAPTURE_STEPS[state.stepIndex] ?? null;
}

/**
 * Build the emitted {@link GradingCaptureSession} from a complete
 * state. Returns `null` if the session isn't complete — the screen
 * must guard against this.
 */
export function buildEmittedSession(
  state: CaptureSessionState,
  completedAt: number = Date.now(),
): GradingCaptureSession | null {
  if (!state.isComplete) return null;
  const {
    frontFull,
    backFull,
    frontCorner,
    backCorner,
    bottomLeftCorner,
    bottomRightCorner,
    surface,
  } = state.shots;
  if (
    frontFull === undefined ||
    backFull === undefined ||
    frontCorner === undefined ||
    backCorner === undefined ||
    bottomLeftCorner === undefined ||
    bottomRightCorner === undefined ||
    surface === undefined
  ) {
    return null;
  }
  return {
    frontFull,
    backFull,
    frontCorner,
    backCorner,
    bottomLeftCorner,
    bottomRightCorner,
    surface,
    id: state.id,
    startedAt: state.startedAt,
    completedAt,
  };
}
