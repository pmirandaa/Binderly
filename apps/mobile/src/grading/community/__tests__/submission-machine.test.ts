import { describe, expect, it } from 'vitest';

import type { SubmitCommunitySubmissionResponse } from '@binderly/api-contracts';

import {
  canSubmit,
  initialSubmissionState,
  reduceSubmission,
} from '../submission-machine';

function response(alreadySubmitted: boolean): SubmitCommunitySubmissionResponse {
  return {
    alreadySubmitted,
    submission: {
      id: 'cccccccc-3333-4333-8333-cccccccccccc',
      userId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      gradingSubmissionId: null,
      gradeCompany: 'PSA',
      certNumber: '12345678',
      certNumberNormalized: '12345678',
      overallGrade: 9,
      subgrades: null,
      blackLabel: false,
      rawGradeLabel: null,
      images: { front: 'https://x/f.jpg', back: 'https://x/b.jpg' },
      consent: true,
      status: 'pending',
      ingestedSourceId: null,
      createdAt: '2026-05-29T12:00:00Z',
      updatedAt: '2026-05-29T12:00:00Z',
    },
  };
}

describe('reduceSubmission', () => {
  it('starts idle', () => {
    expect(initialSubmissionState.status).toBe('idle');
  });

  it('submit → submitting', () => {
    const next = reduceSubmission(initialSubmissionState, { type: 'submit' });
    expect(next.status).toBe('submitting');
  });

  it('ignores a second submit while submitting', () => {
    const submitting = reduceSubmission(initialSubmissionState, { type: 'submit' });
    const next = reduceSubmission(submitting, { type: 'submit' });
    expect(next).toBe(submitting);
  });

  it('resolve(alreadySubmitted=false) → success', () => {
    const submitting = reduceSubmission(initialSubmissionState, { type: 'submit' });
    const next = reduceSubmission(submitting, { type: 'resolve', response: response(false) });
    expect(next.status).toBe('success');
  });

  it('resolve(alreadySubmitted=true) → already_submitted', () => {
    const submitting = reduceSubmission(initialSubmissionState, { type: 'submit' });
    const next = reduceSubmission(submitting, { type: 'resolve', response: response(true) });
    expect(next.status).toBe('already_submitted');
  });

  it('fail → error with message', () => {
    const submitting = reduceSubmission(initialSubmissionState, { type: 'submit' });
    const next = reduceSubmission(submitting, { type: 'fail', message: 'boom' });
    expect(next).toEqual({ status: 'error', message: 'boom' });
  });

  it('ignores a stale resolve when not submitting', () => {
    const next = reduceSubmission(initialSubmissionState, { type: 'resolve', response: response(false) });
    expect(next).toBe(initialSubmissionState);
  });

  it('reset → idle', () => {
    const errored = reduceSubmission(
      reduceSubmission(initialSubmissionState, { type: 'submit' }),
      { type: 'fail', message: 'boom' },
    );
    expect(reduceSubmission(errored, { type: 'reset' }).status).toBe('idle');
  });
});

describe('canSubmit', () => {
  it('is false while submitting', () => {
    expect(canSubmit({ status: 'submitting' })).toBe(false);
  });

  it('is true when idle / error', () => {
    expect(canSubmit({ status: 'idle' })).toBe(true);
    expect(canSubmit({ status: 'error', message: 'x' })).toBe(true);
  });
});
