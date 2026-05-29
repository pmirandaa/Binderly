// Tests for the handle-availability endpoint
// (`GET /v1/me/handle-available?handle=…`, #FU-52).

import { describe, expect, it } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import {
  buildRequest,
  createFakeSupabase,
  FIXTURE_USER_ID,
  FIXTURE_OTHER_USER_ID,
  makeFakeJwt,
  readErrorBody,
  readSuccessBody,
} from '../test-helpers.ts';

const ENV_GETTER = (name: string): string | undefined => {
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

interface AvailabilityBody {
  handle: string;
  available: boolean;
  reason?: string;
}

function makeHandlerWithFake(fake: ReturnType<typeof createFakeSupabase>) {
  return makeHandler({
    getEnv: ENV_GETTER,
    routes: ROUTES,
    deps: { createClient: () => fake.client },
  });
}

function url(handle?: string): string {
  const base = 'http://localhost/v1/me/handle-available';
  return handle === undefined ? base : `${base}?handle=${encodeURIComponent(handle)}`;
}

describe('GET /v1/me/handle-available — auth', () => {
  it('returns 401 for an anonymous caller', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url('newname'), method: 'GET' }),
    );
    expect(response.status).toBe(401);
    // The existence probe must never run for an unauthenticated caller.
    expect(fake.calls.some((c) => c.method === 'from')).toBe(false);
  });
});

describe('GET /v1/me/handle-available — validation', () => {
  it('returns 400 when the handle param is missing', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url(), method: 'GET', token: makeFakeJwt() }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('returns 400 for a malformed handle', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url('-bad-'), method: 'GET', token: makeFakeJwt() }),
    );
    expect(response.status).toBe(400);
    // No DB round-trip for a shape failure.
    expect(fake.calls.some((c) => c.method === 'from')).toBe(false);
  });
});

describe('GET /v1/me/handle-available — reserved handles', () => {
  it('reports a reserved handle as unavailable without a DB read', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url('admin'), method: 'GET', token: makeFakeJwt() }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<AvailabilityBody>(response);
    expect(body.available).toBe(false);
    expect(body.reason).toBe('reserved');
    expect(fake.calls.some((c) => c.method === 'from')).toBe(false);
  });
});

describe('GET /v1/me/handle-available — existence probe', () => {
  it('returns available:true when no profile holds the handle', async () => {
    const fake = createFakeSupabase({
      tableResponses: { profile: [{ data: null, error: null }] },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url('brandnew'), method: 'GET', token: makeFakeJwt() }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<AvailabilityBody>(response);
    expect(body.handle).toBe('brandnew');
    expect(body.available).toBe(true);
    expect(body.reason).toBeUndefined();
  });

  it('returns reason:taken when another user owns the handle', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: { user_id: FIXTURE_OTHER_USER_ID, handle: 'pablo' }, error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url('pablo'), method: 'GET', token: makeFakeJwt() }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<AvailabilityBody>(response);
    expect(body.available).toBe(false);
    expect(body.reason).toBe('taken');
  });

  it('returns available:true when the caller already owns the handle', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: { user_id: FIXTURE_USER_ID, handle: 'pablo' }, error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url('pablo'), method: 'GET', token: makeFakeJwt() }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<AvailabilityBody>(response);
    expect(body.available).toBe(true);
  });

  it('lower-cases the candidate before the citext lookup', async () => {
    const fake = createFakeSupabase({
      tableResponses: { profile: [{ data: null, error: null }] },
    });
    await makeHandlerWithFake(fake)(
      buildRequest({ url: url('MixedCase'), method: 'GET', token: makeFakeJwt() }),
    );
    const eqCall = fake.calls.find((c) => c.method === 'eq');
    expect(eqCall?.args).toEqual(['handle', 'mixedcase']);
  });

  it('translates a PostgREST error into an INTERNAL envelope', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: null, error: { code: 'XX000', message: 'db down' } }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: url('whatever'), method: 'GET', token: makeFakeJwt() }),
    );
    expect(response.status).toBe(500);
  });
});
