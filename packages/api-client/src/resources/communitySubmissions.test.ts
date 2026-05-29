// Tests for the community-submissions resource.

import { describe, expect, it } from 'vitest';

import { makeCommunitySubmissionsResource } from './communitySubmissions.js';
import { HttpClient } from '../client.js';
import { ApiForbiddenError, ApiValidationError } from '../error.js';
import { mockFetch, okEnvelope } from '../test-helpers.js';

const FRONT = 'https://cdn.binderly.test/u/1/front.jpg';
const BACK = 'https://cdn.binderly.test/u/1/back.jpg';
const USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SUB_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const NOW = '2026-05-29T12:00:00Z';

const VALID_INPUT = {
  gradeCompany: 'PSA',
  certNumber: '12345678',
  overallGrade: 9,
  images: { front: FRONT, back: BACK },
  consent: true,
} as const;

function ROW(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB_ID,
    userId: USER_ID,
    gradingSubmissionId: null,
    gradeCompany: 'PSA',
    certNumber: '12345678',
    certNumberNormalized: '12345678',
    overallGrade: 9,
    subgrades: null,
    blackLabel: false,
    rawGradeLabel: null,
    images: { front: FRONT, back: BACK },
    consent: true,
    status: 'pending',
    ingestedSourceId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeResource(...responses: Parameters<typeof mockFetch>) {
  const fetch = mockFetch(...responses);
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => 'jwt-1',
    fetch,
  });
  return { resource: makeCommunitySubmissionsResource(http), fetch };
}

describe('submitCommunitySubmission', () => {
  it('POSTs to /v1/me/community-submissions', async () => {
    const { resource, fetch } = makeResource({
      status: 200,
      body: okEnvelope({ submission: ROW(), alreadySubmitted: false }),
    });
    await resource.submitCommunitySubmission(VALID_INPUT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/v1/me/community-submissions');
    expect(init?.method).toBe('POST');
  });

  it('returns the persisted submission', async () => {
    const { resource } = makeResource({
      status: 200,
      body: okEnvelope({ submission: ROW(), alreadySubmitted: false }),
    });
    const result = await resource.submitCommunitySubmission(VALID_INPUT);
    expect(result.submission.id).toBe(SUB_ID);
    expect(result.alreadySubmitted).toBe(false);
  });

  it('surfaces alreadySubmitted on an idempotent re-submit', async () => {
    const { resource } = makeResource({
      status: 200,
      body: okEnvelope({ submission: ROW(), alreadySubmitted: true }),
    });
    const result = await resource.submitCommunitySubmission(VALID_INPUT);
    expect(result.alreadySubmitted).toBe(true);
  });

  it('validates the request before sending (no fetch on bad input)', async () => {
    const { resource, fetch } = makeResource({ status: 200, body: okEnvelope(ROW()) });
    await expect(
      resource.submitCommunitySubmission({ ...VALID_INPUT, consent: false } as never),
    ).rejects.toBeInstanceOf(ApiValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a 403 to ApiForbiddenError (free user)', async () => {
    const { resource } = makeResource({
      status: 403,
      body: { ok: false, error: { code: 'FORBIDDEN', message: 'pro only' } },
    });
    await expect(resource.submitCommunitySubmission(VALID_INPUT)).rejects.toBeInstanceOf(
      ApiForbiddenError,
    );
  });
});
