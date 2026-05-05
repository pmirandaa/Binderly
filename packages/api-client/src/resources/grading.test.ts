// Tests for the grading resource.

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import {
  ApiForbiddenError,
  ApiNotFoundError,
  ApiResponseDecodeError,
  ApiValidationError,
} from '../error.js';
import { mockFetch, okEnvelope } from '../test-helpers.js';
import { FIXTURE_IDS, VALID_GRADING_SUBMISSION, VALID_PAGE } from './_fixtures.js';
import { makeGradingResource } from './grading.js';

const VALID_PREDICTION_INPUT = {
  printingId: FIXTURE_IDS.printingId,
  frontUrl: 'https://images.binderly.app/g/front.webp',
  backUrl: 'https://images.binderly.app/g/back.webp',
  cornerUrls: [
    'https://images.binderly.app/g/c1.webp',
    'https://images.binderly.app/g/c2.webp',
    'https://images.binderly.app/g/c3.webp',
    'https://images.binderly.app/g/c4.webp',
  ],
  surfaceUrl: 'https://images.binderly.app/g/surface.webp',
};

function makeResource(fetch: ReturnType<typeof mockFetch>): {
  fetch: ReturnType<typeof mockFetch>;
  grading: ReturnType<typeof makeGradingResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => 'jwt',
    fetch,
  });
  return { fetch, grading: makeGradingResource(http) };
}

describe('grading.listGradingSubmissions', () => {
  it('returns paginated grading submissions on happy path', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_GRADING_SUBMISSION])) }),
    );
    const page = await grading.listGradingSubmissions();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe('predicted');
  });

  it('hits GET /v1/me/grading', async () => {
    const { fetch, grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_GRADING_SUBMISSION])) }),
    );
    await grading.listGradingSubmissions({ cursor: 'c', limit: 10 });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/grading');
    expect(url).toContain('cursor=c');
    expect(url).toContain('limit=10');
  });
});

describe('grading.getGradingSubmission', () => {
  it('returns one submission on happy path', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    const submission = await grading.getGradingSubmission({ id: FIXTURE_IDS.gradingId });
    expect(submission.id).toBe(FIXTURE_IDS.gradingId);
  });

  it('hits GET /v1/me/grading/{id}', async () => {
    const { fetch, grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await grading.getGradingSubmission({ id: FIXTURE_IDS.gradingId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/grading/${FIXTURE_IDS.gradingId}`);
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { grading } = makeResource(mockFetch({ status: 404 }));
    await expect(
      grading.getGradingSubmission({ id: FIXTURE_IDS.gradingId }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

describe('grading.submitGradingPrediction', () => {
  it('happy-path round-trip returns the new submission', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    const submission = await grading.submitGradingPrediction(VALID_PREDICTION_INPUT);
    expect(submission.id).toBe(FIXTURE_IDS.gradingId);
  });

  it('hits POST /v1/me/grading with the body JSON-encoded', async () => {
    const { fetch, grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await grading.submitGradingPrediction(VALID_PREDICTION_INPUT);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetch.mock.calls[0]?.[1]?.body).toContain('"frontUrl"');
  });

  it('throws ApiValidationError when cornerUrls is not exactly 4 entries', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await expect(
      grading.submitGradingPrediction({
        ...VALID_PREDICTION_INPUT,
        cornerUrls: VALID_PREDICTION_INPUT.cornerUrls.slice(0, 3),
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiValidationError when an image URL is malformed', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await expect(
      grading.submitGradingPrediction({
        ...VALID_PREDICTION_INPUT,
        frontUrl: 'not a url',
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiForbiddenError on 403 (free user / freemium gate)', async () => {
    const { grading } = makeResource(mockFetch({ status: 403 }));
    await expect(grading.submitGradingPrediction(VALID_PREDICTION_INPUT)).rejects.toBeInstanceOf(
      ApiForbiddenError,
    );
  });
});

describe('grading.updateGradingSubmissionStatus', () => {
  it('hits PATCH /v1/me/grading/{id}/status with body', async () => {
    const { fetch, grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await grading.updateGradingSubmissionStatus({
      id: FIXTURE_IDS.gradingId,
      body: { status: 'submitted_for_grading' },
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/grading/${FIXTURE_IDS.gradingId}/status`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('throws ApiValidationError on a status not in the allowed enum', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await expect(
      grading.updateGradingSubmissionStatus({
        id: FIXTURE_IDS.gradingId,
        body: { status: 'graded' as never }, // not allowed via this endpoint
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('grading.attachActualGrade', () => {
  it('hits POST /v1/me/grading/{id}/actual', async () => {
    const { fetch, grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await grading.attachActualGrade({
      id: FIXTURE_IDS.gradingId,
      body: {
        actual: {
          company: 'PSA',
          grade: 9,
        },
      },
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/grading/${FIXTURE_IDS.gradingId}/actual`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('throws ApiValidationError when actual.grade is out of range', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_GRADING_SUBMISSION) }),
    );
    await expect(
      grading.attachActualGrade({
        id: FIXTURE_IDS.gradingId,
        body: {
          actual: {
            company: 'PSA',
            grade: 11 as never,
          },
        },
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiResponseDecodeError on shape drift', async () => {
    const { grading } = makeResource(
      mockFetch({ status: 200, body: okEnvelope({ wrong: 'shape' }) }),
    );
    await expect(
      grading.attachActualGrade({
        id: FIXTURE_IDS.gradingId,
        body: { actual: { company: 'PSA', grade: 9 } },
      }),
    ).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });
});
