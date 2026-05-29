// Tests for `communitySubmission.ts`. Positive + negative cases per schema.

import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_GRADE_COMPANIES,
  communityGradeCompanySchema,
  communityGradeSchema,
  communitySubmissionDto,
  communitySubmissionImagesSchema,
  submitCommunitySubmissionRequest,
  submitCommunitySubmissionResponse,
} from './communitySubmission.js';

const FRONT = 'https://cdn.binderly.test/u/1/front.jpg';
const BACK = 'https://cdn.binderly.test/u/1/back.jpg';
const NOW = '2026-05-29T12:00:00Z';
const USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SUB_ID = 'cccccccc-3333-4333-8333-cccccccccccc';

const VALID_REQUEST = {
  gradeCompany: 'PSA',
  certNumber: '12345678',
  overallGrade: 9,
  images: { front: FRONT, back: BACK },
  consent: true,
} as const;

describe('communityGradeCompanySchema', () => {
  it('accepts PSA / BGS / CGC / SGC', () => {
    for (const c of COMMUNITY_GRADE_COMPANIES) {
      expect(communityGradeCompanySchema.parse(c)).toBe(c);
    }
  });

  it('accepts SGC (unlike collection gradeCompanySchema)', () => {
    expect(communityGradeCompanySchema.parse('SGC')).toBe('SGC');
  });

  it('rejects an unknown company', () => {
    expect(communityGradeCompanySchema.safeParse('TAG').success).toBe(false);
  });
});

describe('communityGradeSchema', () => {
  it('accepts on-grid grades', () => {
    expect(communityGradeSchema.parse(9)).toBe(9);
    expect(communityGradeSchema.parse(9.5)).toBe(9.5);
  });

  it('rejects off-grid grades', () => {
    expect(communityGradeSchema.safeParse(8.3).success).toBe(false);
  });

  it('rejects out-of-range grades', () => {
    expect(communityGradeSchema.safeParse(0.5).success).toBe(false);
    expect(communityGradeSchema.safeParse(10.5).success).toBe(false);
  });
});

describe('communitySubmissionImagesSchema', () => {
  it('requires front and back', () => {
    expect(communitySubmissionImagesSchema.safeParse({ front: FRONT }).success).toBe(false);
    expect(communitySubmissionImagesSchema.safeParse({ back: BACK }).success).toBe(false);
  });

  it('accepts front + back + optional refs', () => {
    const parsed = communitySubmissionImagesSchema.parse({
      front: FRONT,
      back: BACK,
      corners: [FRONT],
      surface: FRONT,
      slab: FRONT,
    });
    expect(parsed.corners).toHaveLength(1);
  });
});

describe('submitCommunitySubmissionRequest', () => {
  it('accepts a valid request', () => {
    expect(submitCommunitySubmissionRequest.parse(VALID_REQUEST).certNumber).toBe('12345678');
  });

  it('defaults blackLabel to false', () => {
    expect(submitCommunitySubmissionRequest.parse(VALID_REQUEST).blackLabel).toBe(false);
  });

  it('requires consent === true', () => {
    expect(
      submitCommunitySubmissionRequest.safeParse({ ...VALID_REQUEST, consent: false }).success,
    ).toBe(false);
  });

  it('requires at least one grade signal', () => {
    const noGrade = { gradeCompany: 'PSA', certNumber: '1', images: { front: FRONT, back: BACK }, consent: true };
    expect(submitCommunitySubmissionRequest.safeParse(noGrade).success).toBe(false);
  });

  it('accepts a black-label submission with no numeric grade', () => {
    const bl = {
      gradeCompany: 'BGS',
      certNumber: '0015384312',
      blackLabel: true,
      images: { front: FRONT, back: BACK },
      consent: true,
    };
    expect(submitCommunitySubmissionRequest.safeParse(bl).success).toBe(true);
  });

  it('accepts sub-grades only (no overall)', () => {
    const sub = {
      gradeCompany: 'BGS',
      certNumber: '0015384312',
      subgrades: { corners: 9.5 },
      images: { front: FRONT, back: BACK },
      consent: true,
    };
    expect(submitCommunitySubmissionRequest.safeParse(sub).success).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    expect(
      submitCommunitySubmissionRequest.safeParse({ ...VALID_REQUEST, bogus: 1 }).success,
    ).toBe(false);
  });
});

describe('communitySubmissionDto', () => {
  const ROW = {
    id: SUB_ID,
    userId: USER_ID,
    gradingSubmissionId: null,
    gradeCompany: 'PSA',
    certNumber: '12345678',
    certNumberNormalized: '12345678',
    overallGrade: 9,
    subgrades: null,
    blackLabel: false,
    rawGradeLabel: 'PSA 9',
    images: { front: FRONT, back: BACK },
    consent: true,
    status: 'pending',
    ingestedSourceId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses a valid row', () => {
    expect(communitySubmissionDto.parse(ROW).id).toBe(SUB_ID);
  });

  it('wraps in the submit response with alreadySubmitted', () => {
    const parsed = submitCommunitySubmissionResponse.parse({
      submission: ROW,
      alreadySubmitted: true,
    });
    expect(parsed.alreadySubmitted).toBe(true);
  });
});
