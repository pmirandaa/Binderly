// Tests for `grading.ts`. Each schema gets a positive +
// negative case.

import { describe, expect, it } from 'vitest';

import {
  actualGradeSchema,
  attachActualGradeRequest,
  gradingSubmissionDto,
  gradingSubmissionStatusSchema,
  predictedScoresSchema,
  submitGradingPredictionRequest,
  subgradeSchema,
  updateGradingSubmissionStatusRequest,
} from './grading.js';

const NOW = '2026-05-05T12:00:00Z';
const USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PRINTING_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SUBMISSION_ID = 'cccccccc-3333-4333-8333-cccccccccccc';

const VALID_PREDICTED = {
  centering: 9.0,
  corners: 9.5,
  edges: 9.0,
  surface: 9.0,
  aggregate: 9.0,
  confidence: 0.78,
};

const SIX_URLS = {
  frontUrl: 'https://images.binderly.app/users/me/g/1/front.webp',
  backUrl: 'https://images.binderly.app/users/me/g/1/back.webp',
  cornerUrls: [
    'https://images.binderly.app/users/me/g/1/c1.webp',
    'https://images.binderly.app/users/me/g/1/c2.webp',
    'https://images.binderly.app/users/me/g/1/c3.webp',
    'https://images.binderly.app/users/me/g/1/c4.webp',
  ],
  surfaceUrl: 'https://images.binderly.app/users/me/g/1/surface.webp',
};

describe('subgradeSchema', () => {
  it('accepts 0..10', () => {
    expect(subgradeSchema.parse(8.5)).toBe(8.5);
    expect(subgradeSchema.parse(0)).toBe(0);
    expect(subgradeSchema.parse(10)).toBe(10);
  });

  it('rejects values > 10', () => {
    expect(subgradeSchema.safeParse(10.5).success).toBe(false);
  });
});

describe('predictedScoresSchema', () => {
  it('parses a fully-populated prediction', () => {
    expect(predictedScoresSchema.parse(VALID_PREDICTED).aggregate).toBe(9.0);
  });

  it('rejects when a subgrade is missing', () => {
    const { centering, ...without } = VALID_PREDICTED;
    void centering;
    expect(predictedScoresSchema.safeParse(without).success).toBe(false);
  });

  it('rejects when confidence > 1', () => {
    expect(predictedScoresSchema.safeParse({ ...VALID_PREDICTED, confidence: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('actualGradeSchema', () => {
  it('parses a PSA aggregate-only payload', () => {
    expect(actualGradeSchema.parse({ company: 'PSA', grade: 9 }).grade).toBe(9);
  });

  it('parses a BGS payload with subgrades + slabUrl', () => {
    expect(
      actualGradeSchema.parse({
        company: 'BGS',
        grade: 9.5,
        subgrades: { centering: 9.5, corners: 9.5, edges: 9.5, surface: 9.5 },
        slabUrl: 'https://images.binderly.app/users/me/g/1/slab.webp',
      }).subgrades?.centering,
    ).toBe(9.5);
  });

  it('rejects an unknown grading company', () => {
    expect(actualGradeSchema.safeParse({ company: 'AGS', grade: 9 }).success).toBe(false);
  });
});

describe('gradingSubmissionStatusSchema', () => {
  it('accepts the three statuses', () => {
    expect(gradingSubmissionStatusSchema.parse('predicted')).toBe('predicted');
    expect(gradingSubmissionStatusSchema.parse('submitted_for_grading')).toBe(
      'submitted_for_grading',
    );
    expect(gradingSubmissionStatusSchema.parse('graded')).toBe('graded');
  });

  it('rejects an unknown status', () => {
    expect(gradingSubmissionStatusSchema.safeParse('queued').success).toBe(false);
  });
});

describe('gradingSubmissionDto', () => {
  const VALID = {
    id: SUBMISSION_ID,
    userId: USER_ID,
    printingId: PRINTING_ID,
    ...SIX_URLS,
    predicted: VALID_PREDICTED,
    actual: null,
    status: 'predicted' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses a predicted-only submission', () => {
    expect(gradingSubmissionDto.parse(VALID).status).toBe('predicted');
  });

  it('parses a graded submission with actual payload', () => {
    expect(
      gradingSubmissionDto.parse({
        ...VALID,
        status: 'graded',
        actual: { company: 'PSA', grade: 9 },
      }).actual?.grade,
    ).toBe(9);
  });

  it('rejects when cornerUrls has 3 entries', () => {
    expect(
      gradingSubmissionDto.safeParse({ ...VALID, cornerUrls: SIX_URLS.cornerUrls.slice(0, 3) })
        .success,
    ).toBe(false);
  });
});

describe('submitGradingPredictionRequest', () => {
  it('parses a request without printingId', () => {
    expect(submitGradingPredictionRequest.parse(SIX_URLS).frontUrl).toBeDefined();
  });

  it('parses a request with printingId', () => {
    expect(
      submitGradingPredictionRequest.parse({ ...SIX_URLS, printingId: PRINTING_ID }).printingId,
    ).toBe(PRINTING_ID);
  });

  it('rejects when cornerUrls has 5 entries', () => {
    expect(
      submitGradingPredictionRequest.safeParse({
        ...SIX_URLS,
        cornerUrls: [...SIX_URLS.cornerUrls, 'https://images.binderly.app/x.webp'],
      }).success,
    ).toBe(false);
  });

  it('rejects an attempt to set userId on the wire (strict)', () => {
    expect(submitGradingPredictionRequest.safeParse({ ...SIX_URLS, userId: USER_ID }).success).toBe(
      false,
    );
  });
});

describe('attachActualGradeRequest', () => {
  it('parses a CGC actual-grade payload', () => {
    expect(
      attachActualGradeRequest.parse({ actual: { company: 'CGC', grade: 9.5 } }).actual.grade,
    ).toBe(9.5);
  });

  it('rejects when actual is missing', () => {
    expect(attachActualGradeRequest.safeParse({}).success).toBe(false);
  });
});

describe('updateGradingSubmissionStatusRequest', () => {
  it('parses a status flip to submitted_for_grading', () => {
    expect(
      updateGradingSubmissionStatusRequest.parse({ status: 'submitted_for_grading' }).status,
    ).toBe('submitted_for_grading');
  });

  it("rejects status: 'graded' (must use attachActualGradeRequest)", () => {
    expect(updateGradingSubmissionStatusRequest.safeParse({ status: 'graded' }).success).toBe(
      false,
    );
  });
});
