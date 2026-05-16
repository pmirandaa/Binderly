import { describe, expect, it } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import { buildRequest, createFakeSupabase, makeFakeJwt, readErrorBody } from '../test-helpers.ts';

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

describe('POST /v1/me/collection/recompute-set-completion', () => {
  it('returns 202 + deferred envelope when called by an authenticated user', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/recompute-set-completion',
        method: 'POST',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(202);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.details).toMatchObject({ deferred: true });
  });

  it('returns 401 envelope for an anonymous caller', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/recompute-set-completion',
        method: 'POST',
      }),
    );
    expect(response.status).toBe(401);
  });

  it('honors x-request-id propagation on the deferred response', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      new Request('http://localhost/v1/me/collection/recompute-set-completion', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${makeFakeJwt()}`,
          'x-request-id': 'rid-recompute-1',
        },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-recompute-1');
  });

  it('does NOT 404 for the URL — the path is recognized', async () => {
    // Regression guard: confirm the route table has the recompute
    // path so a future refactor that drops it gets caught here.
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/recompute-set-completion',
        method: 'POST',
        token: makeFakeJwt(),
      }),
    );
    // 202 is the deferred-stub status; 404 would mean the route is missing.
    expect(response.status).toBe(202);
  });
});
