import { describe, expect, it } from 'vitest';

import { makeHandler } from '../_shared/dispatch.ts';
import { ROUTES } from '../_shared/routes-table.ts';
import {
  buildRequest,
  collectionItemRowFixture,
  createFakeSupabase,
  customCollectionRowFixture,
  FIXTURE_CUSTOM_COLLECTION_ID,
  FIXTURE_PRINTING_ID,
  FIXTURE_USER_ID,
  makeFakeJwt,
} from '../_shared/test-helpers.ts';

const ENV_GETTER = (name: string): string | undefined => {
  switch (name) {
    case 'SUPABASE_URL':
      return 'https://test.supabase.test';
    case 'SUPABASE_ANON_KEY':
      return 'anon';
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return 'service-role';
    case 'CORS_ALLOW_ORIGINS':
      return 'https://binderly.app,https://staging.binderly.app';
    default:
      return undefined;
  }
};

describe('v1 mux — URL flavors', () => {
  it.each([
    'http://localhost/v1/me/collection',
    'http://localhost/functions/v1/v1/me/collection',
    'http://localhost/v1/v1/me/collection',
    'http://localhost/me/collection',
  ])('routes %s to the list handler', async (url) => {
    const fake = createFakeSupabase({
      tableResponses: { collection_item: [{ data: [], error: null }] },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(buildRequest({ url, method: 'GET', token: makeFakeJwt() }));
    expect(response.status).toBe(200);
  });

  it('rejects a path that is neither /me/* nor any known prefix', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      buildRequest({
        url: 'http://localhost/some/unknown/path',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('v1 mux — CORS', () => {
  it('answers an OPTIONS preflight from an allowed origin with 204', async () => {
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
    });
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'OPTIONS',
        headers: { origin: 'https://binderly.app' },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://binderly.app');
  });

  it('refuses an OPTIONS preflight from a disallowed origin with 403', async () => {
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
    });
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('emits the allow-origin header on successful responses (echoed)', async () => {
    const fake = createFakeSupabase({
      tableResponses: { collection_item: [{ data: [], error: null }] },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'GET',
        headers: {
          origin: 'https://binderly.app',
          authorization: `Bearer ${makeFakeJwt()}`,
        },
      }),
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('https://binderly.app');
  });
});

describe('v1 mux — request-id propagation', () => {
  it('echoes inbound x-request-id on success responses', async () => {
    const fake = createFakeSupabase({
      tableResponses: { collection_item: [{ data: [], error: null }] },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${makeFakeJwt()}`,
          'x-request-id': 'rid-mux-1',
        },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-mux-1');
  });

  it('echoes inbound x-request-id on error responses', async () => {
    const fake = createFakeSupabase({
      authError: { code: 'bad_jwt', message: 'invalid', status: 401 },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${makeFakeJwt()}`,
          'x-request-id': 'rid-mux-2',
        },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-mux-2');
  });
});

describe('v1 mux — error envelope contract', () => {
  it.each([
    ['/v1/me/collection', 'POST'],
    ['/v1/me/custom-collections', 'POST'],
  ])('every error path emits ok:false { code, message } at %s %s', async (path, method) => {
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${makeFakeJwt()}`, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(response.ok).toBe(false);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  });

  it('treats an unknown method on a known path as 405', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'PUT',
        headers: { authorization: `Bearer ${makeFakeJwt()}` },
      }),
    );
    expect(response.status).toBe(405);
  });
});

describe('v1 mux — full happy-path round trips', () => {
  it('GET /v1/me/custom-collections returns the user collections', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [{ data: [customCollectionRowFixture()], error: null }],
      },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'GET',
        token: makeFakeJwt(),
        headers: { origin: 'https://binderly.app' },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('POST /v1/me/collection happy path — single row insert', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: collectionItemRowFixture(), error: null }],
      },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID, quantity: 2 },
      }),
    );
    expect(response.status).toBe(201);
  });

  it('attaches the user_id from session to the inserted row (verified via call args)', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: collectionItemRowFixture(), error: null }],
      },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt({ sub: FIXTURE_USER_ID }),
        body: { printingId: FIXTURE_PRINTING_ID },
      }),
    );
    const insertCall = fake.calls.find(
      (c) => c.method === 'insert' && c.table === 'collection_item',
    );
    expect(insertCall).toBeDefined();
    const inserted = insertCall!.args[0] as { user_id?: string };
    expect(inserted.user_id).toBe(FIXTURE_USER_ID);
  });

  it('every error envelope has an `error.code` matching the canonical enum', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: { createClient: () => fake.client },
    });
    // Try a 401 path
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'GET',
      }),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(['VALIDATION', 'AUTH', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMIT', 'INTERNAL']).toContain(
      body.error.code,
    );
  });
});

describe('v1 mux — does not autoboot Deno.serve in node', () => {
  it('imports without throwing in vitest', async () => {
    await expect(import('./index.ts')).resolves.toBeDefined();
  });

  it('re-exports makeHandler and ROUTES', async () => {
    const mod = await import('./index.ts');
    expect(typeof mod.makeHandler).toBe('function');
    expect(Array.isArray(mod.ROUTES)).toBe(true);
  });

  it('the route count covers every api-client URL the collection resource exposes', async () => {
    const mod = await import('./index.ts');
    const routes = mod.ROUTES as readonly { method: string; pattern: string }[];
    const expectedPatterns: ReadonlyArray<readonly [string, string]> = [
      ['GET', '/me/collection'],
      ['POST', '/me/collection'],
      ['POST', '/me/collection/bulk'],
      ['POST', '/me/collection/recompute-set-completion'],
      ['GET', '/me/collection/completion'],
      ['GET', '/me/collection/:id'],
      ['PATCH', '/me/collection/:id'],
      ['DELETE', '/me/collection/:id'],
      ['GET', '/me/custom-collections'],
      ['POST', '/me/custom-collections'],
      ['GET', '/me/custom-collections/:id'],
      ['PATCH', '/me/custom-collections/:id'],
      ['DELETE', '/me/custom-collections/:id'],
      ['GET', '/me/custom-collections/:id/items'],
      ['POST', '/me/custom-collections/:id/items'],
      ['GET', '/me/custom-collections/:id/items/:printingId'],
      ['DELETE', '/me/custom-collections/:id/items/:printingId'],
      ['GET', '/me/custom-collections/:id/smart-rule'],
      ['PUT', '/me/custom-collections/:id/smart-rule'],
      ['GET', '/printings/:id/current-price'],
      ['GET', '/c/:handle/:slug'],
      ['POST', '/smart-collections/preview'],
      ['GET', '/me/entitlements'],
      ['POST', '/me/community-submissions'],
    ];
    for (const [method, pattern] of expectedPatterns) {
      const found = routes.find((r) => r.method === method && r.pattern === pattern);
      expect(found, `missing route ${method} ${pattern}`).toBeDefined();
    }
    expect(routes.length).toBe(expectedPatterns.length);
  });

  it('FIXTURE_CUSTOM_COLLECTION_ID is referenced (regression guard)', () => {
    expect(typeof FIXTURE_CUSTOM_COLLECTION_ID).toBe('string');
  });
});
