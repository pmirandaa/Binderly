// Pure reducer for the submission status machine.
//
// Split from the screen so the five states (idle / submitting / success /
// already_submitted / error) and their transitions are unit-testable without
// rendering React.

import type { SubmitCommunitySubmissionResponse } from '@binderly/api-contracts';

import type { SubmissionState } from './types.js';

export type SubmissionAction =
  | { readonly type: 'submit' }
  | { readonly type: 'resolve'; readonly response: SubmitCommunitySubmissionResponse }
  | { readonly type: 'fail'; readonly message: string }
  | { readonly type: 'reset' };

export const initialSubmissionState: SubmissionState = { status: 'idle' };

export function reduceSubmission(
  state: SubmissionState,
  action: SubmissionAction,
): SubmissionState {
  switch (action.type) {
    case 'submit': {
      // Only idle / error / a finished state can start a new submit; a second
      // submit while already submitting is ignored (defensive double-tap).
      if (state.status === 'submitting') return state;
      return { status: 'submitting' };
    }
    case 'resolve': {
      // A resolve that arrives when we're not submitting is stale — ignore.
      if (state.status !== 'submitting') return state;
      return action.response.alreadySubmitted
        ? { status: 'already_submitted', response: action.response }
        : { status: 'success', response: action.response };
    }
    case 'fail': {
      if (state.status !== 'submitting') return state;
      return { status: 'error', message: action.message };
    }
    case 'reset': {
      return { status: 'idle' };
    }
    default: {
      const _exhaust: never = action;
      void _exhaust;
      return state;
    }
  }
}

/** True iff a new submit may be dispatched from `state`. */
export function canSubmit(state: SubmissionState): boolean {
  return state.status !== 'submitting';
}
