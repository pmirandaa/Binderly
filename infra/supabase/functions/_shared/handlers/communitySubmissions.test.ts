// Tests for `POST /v1/me/community-submissions` (#FU-55).

import { describe, expect, it, vi } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import {
  buildRequest,
  createFakeSupabase,
  FIXTURE_USER_ID,
  makeFakeJwt,
  readErrorBody,
  readSuccessBody,
} from '../test-helpers.ts';
import { handleSubmitCommunitySubmission, normalizeCertNumber } from './communitySubmissions.ts';

import type { EdgeFetch } from '../db.ts';

const FRONT = 'https://cdn.binderly.test/u/1/front.jpg';
const BACK = 'https://cdn.binderly.test/u/1/back.jpg';
const SUB_ID = 'cccccccc-3333-4333-8333-cccccccccccc';

const VALID_INPUT = {
  gradeCompany: 'PSA',
  certNumber: '1234-5678',
  overallGrade: 9,
  images: { front: FRONT, back: BACK },
  consent: true,
} as const;

const URL = 'http://localhost/v1/me/community-submissions';

function submissionRowFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SUB_ID,
    user_id: FIXTURE_USER_ID,
    grading_submission_id: null,
    grade_company: 'PSA',
    cert_number: '1234-5678',
    cert_number_normalized: '12345678',
    overall_grade: '9.0',
    subgrades: null,
    black_label: false,
    raw_grade_label: null,
    images: { front: FRONT, back: BACK },
    consent: true,
    status: 'pending',
    ingested_source_id: null,
    created_at: '2026-05-29T12:00:00.000Z',
    updated_at: '2026-05-29T12:00:00.000Z',
    ...overrides,
  };
}

const ENV_WITH_RC = (name: string): string | undefined => {
  switch (name) {
    case 'SUPABASE_URL':
      return 'https://test.supabase.test';
    case 'SUPABASE_ANON_KEY':
      return 'anon';
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return 'service-role';
    case 'CORS_ALLOW_ORIGINS':
      return '*';
    case 'REVENUECAT_SECRET_API_KEY':
      return 'sk_test_secret';
    default:
      return undefined;
  }
};

const ENV_WITHOUT_RC = (name: string): string | undefined => {
  switch (name) {
    case 'SUPABASE_URL':
      return 'https://test.supabase.test';
    case 'SUPABASE_ANON_KEY':
      return 'anon';
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return 'service-role';
    case 'CORS_ALLOW_ORIGINS':
      return '*';
    default:
      return undefined;
  }
};

function jsonFetch(body: unknown, status = 200): EdgeFetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }));
}

const PRO_SUBSCRIBER = { subscriber: { entitlements: { pro: { expires_date: null } } } };
const FREE_SUBSCRIBER = { subscriber: { entitlements: {} } };

function makeHandlerWith(
  getEnv: (name: string) => string | undefined,
  fake: ReturnType<typeof createFakeSupabase>,
  fetchImpl?: EdgeFetch,
) {
  return makeHandler({
    getEnv,
    routes: ROUTES,
    deps: {
      createClient: () => fake.client,
      ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
    },
  });
}

describe('normalizeCertNumber (unit)', () => {
  it('uppercases and strips separators', () => {
    expect(normalizeCertNumber('1234-5678')).toBe('12345678');
    expect(normalizeCertNumber('psa 12 34')).toBe('PSA1234');
    expect(normalizeCertNumber('abc/def')).toBe('ABCDEF');
  });
});

describe('POST /v1/me/community-submissions — auth', () => {
  it('returns 401 for an anonymous caller', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWith(ENV_WITH_RC, fake, jsonFetch(PRO_SUBSCRIBER));
    const response = await handler(buildRequest({ url: URL, method: 'POST', body: VALID_INPUT }));
    expect(response.status).toBe(401);
  });
});

describe('POST /v1/me/community-submissions — pro gate', () => {
  it('returns 403 for a free-tier user (RC has no pro entitlement)', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWith(ENV_WITH_RC, fake, jsonFetch(FREE_SUBSCRIBER));
    const response = await handler(
      buildRequest({ url: URL, method: 'POST', token: makeFakeJwt(), body: VALID_INPUT }),
    );
    expect(response.status).toBe(403);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('AUTH');
    // The insert must never have happened for a free user.
    expect(fake.calls.some((c) => c.method === 'insert')).toBe(false);
  });

  it('returns 403 on the fail-closed fallback (RC key unset)', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWith(ENV_WITHOUT_RC, fake, jsonFetch(PRO_SUBSCRIBER));
    const response = await handler(
      buildRequest({ url: URL, method: 'POST', token: makeFakeJwt(), body: VALID_INPUT }),
    );
    expect(response.status).toBe(403);
  });
});

describe('POST /v1/me/community-submissions — happy path (pro)', () => {
  it('inserts and returns the persisted submission with alreadySubmitted: false', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        community_submission: [{ data: submissionRowFixture(), error: null }],
      },
    });
    const handler = makeHandlerWith(ENV_WITH_RC, fake, jsonFetch(PRO_SUBSCRIBER));
    const response = await handler(
      buildRequest({ url: URL, method: 'POST', token: makeFakeJwt(), body: VALID_INPUT }),
    );
    expect(response.status).toBe(201);
    const data = await readSuccessBody<{
      submission: { id: string; overallGrade: number; certNumberNormalized: string };
      alreadySubmitted: boolean;
    }>(response);
    expect(data.submission.id).toBe(SUB_ID);
    expect(data.submission.overallGrade).toBe(9);
    expect(data.alreadySubmitted).toBe(false);
  });

  it('sets user_id from the session and computes cert_number_normalized', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        community_submission: [{ data: submissionRowFixture(), error: null }],
      },
    });
    const handler = makeHandlerWith(ENV_WITH_RC, fake, jsonFetch(PRO_SUBSCRIBER));
    await handler(
      buildRequest({ url: URL, method: 'POST', token: makeFakeJwt(), body: VALID_INPUT }),
    );
    const insertCall = fake.calls.find((c) => c.method === 'insert');
    const insertRow = insertCall?.args[0] as Record<string, unknown>;
    expect(insertRow['user_id']).toBe(FIXTURE_USER_ID);
    expect(insertRow['cert_number']).toBe('1234-5678');
    expect(insertRow['cert_number_normalized']).toBe('12345678');
    expect(insertRow['overall_grade']).toBe('9.0');
    expect(insertRow['consent']).toBe(true);
  });
});

describe('POST /v1/me/community-submissions — idempotent re-submit', () => {
  it('returns the existing row with alreadySubmitted: true on a unique violation', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        community_submission: [
          // INSERT .single() → unique violation
          { data: null, error: { code: '23505', message: 'duplicate key' } },
          // readExisting .maybeSingle() → the existing row
          { data: submissionRowFixture({ status: 'ingested' }), error: null },
        ],
      },
    });
    const handler = makeHandlerWith(ENV_WITH_RC, fake, jsonFetch(PRO_SUBSCRIBER));
    const response = await handler(
      buildRequest({ url: URL, method: 'POST', token: makeFakeJwt(), body: VALID_INPUT }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{
      submission: { id: string; status: string };
      alreadySubmitted: boolean;
    }>(response);
    expect(data.alreadySubmitted).toBe(true);
    expect(data.submission.status).toBe('ingested');
  });
});

describe('POST /v1/me/community-submissions — validation', () => {
  it('returns 400 when consent is not true', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWith(ENV_WITH_RC, fake, jsonFetch(PRO_SUBSCRIBER));
    const response = await handler(
      buildRequest({
        url: URL,
        method: 'POST',
        token: makeFakeJwt(),
        body: { ...VALID_INPUT, consent: false },
      }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('VALIDATION');
    expect(fake.calls.some((c) => c.method === 'insert')).toBe(false);
  });

  it('returns 400 when no grade signal is provided', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWith(ENV_WITH_RC, fake, jsonFetch(PRO_SUBSCRIBER));
    const { overallGrade, ...noGrade } = VALID_INPUT;
    void overallGrade;
    const response = await handler(
      buildRequest({ url: URL, method: 'POST', token: makeFakeJwt(), body: noGrade }),
    );
    expect(response.status).toBe(400);
  });

  it('exercises the handler directly (export smoke)', () => {
    expect(typeof handleSubmitCommunitySubmission).toBe('function');
  });
});
