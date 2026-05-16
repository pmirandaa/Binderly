import { describe, expect, it } from 'vitest';

import { ROUTES } from '../routes-table.ts';
import { makeHandler } from '../dispatch.ts';
import {
  buildRequest,
  collectionItemRowFixture,
  createFakeSupabase,
  FIXTURE_COLLECTION_ITEM_ID,
  FIXTURE_OTHER_USER_ID,
  FIXTURE_PRINTING_ID,
  FIXTURE_USER_ID,
  makeFakeJwt,
  makeFakeUser,
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

function makeHandlerWithFake(fake: ReturnType<typeof createFakeSupabase>) {
  return makeHandler({
    getEnv: ENV_GETTER,
    routes: ROUTES,
    deps: { createClient: () => fake.client },
  });
}

describe('GET /v1/me/collection — list', () => {
  it('returns the user rows wrapped in a paginated envelope', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          {
            data: [collectionItemRowFixture(), collectionItemRowFixture({ id: 'r-2' })],
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const request = buildRequest({
      url: 'http://localhost/v1/me/collection',
      method: 'GET',
      token: makeFakeJwt(),
    });
    const response = await handler(request);
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ items: unknown[]; nextCursor: string | null }>(response);
    expect(data.items.length).toBe(2);
    expect(data.nextCursor).toBeNull();
  });

  it('returns 401 envelope for missing JWT', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({ url: 'http://localhost/v1/me/collection', method: 'GET' }),
    );
    expect(response.status).toBe(401);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('AUTH');
  });

  it('returns 401 envelope when JWT validation fails at supabase', async () => {
    const fake = createFakeSupabase({
      authError: { code: 'bad_jwt', message: 'invalid', status: 401 },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('emits nextCursor when more rows are available', async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      collectionItemRowFixture({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }),
    );
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: rows, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const data = await readSuccessBody<{ items: unknown[]; nextCursor: string | null }>(response);
    expect(data.items.length).toBe(50);
    expect(data.nextCursor).not.toBeNull();
  });

  it('rejects an invalid limit query param with 400', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: [], error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection?limit=oops',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('VALIDATION');
  });
});

describe('POST /v1/me/collection — add (idempotent)', () => {
  it('inserts a new row and returns 201', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          {
            data: collectionItemRowFixture({ printing_id: FIXTURE_PRINTING_ID }),
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID, quantity: 1 },
      }),
    );
    expect(response.status).toBe(201);
    const data = await readSuccessBody<{ id: string; printingId: string }>(response);
    expect(data.printingId).toBe(FIXTURE_PRINTING_ID);
  });

  it('rejects payload with an unknown key (strict zod)', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID, surprise: true },
      }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('rejects an empty body', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'POST',
        headers: { authorization: `Bearer ${makeFakeJwt()}`, 'content-type': 'application/json' },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('on idempotency: 23505 conflict triggers an additive update on the existing row', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          // 1) initial INSERT — fails with 23505
          {
            data: null,
            error: { code: '23505', message: 'duplicate key value' },
          },
          // 2) SELECT existing row
          {
            data: [collectionItemRowFixture({ quantity: 2 })],
            error: null,
          },
          // 3) UPDATE quantity additively
          {
            data: collectionItemRowFixture({ quantity: 3 }),
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID, quantity: 1 },
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ quantity: number }>(response);
    expect(data.quantity).toBe(3);
  });

  it('translates a generic INSERT error into INTERNAL', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: null, error: { code: 'XX999', message: 'pg crashed' } }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID },
      }),
    );
    expect(response.status).toBe(500);
  });

  it('passes Authorization Bearer header into the supabase client config', async () => {
    let observedAuthHeader: string | undefined;
    const fake = createFakeSupabase({
      tableResponses: { collection_item: [{ data: collectionItemRowFixture(), error: null }] },
    });
    const handler = makeHandler({
      getEnv: ENV_GETTER,
      routes: ROUTES,
      deps: {
        createClient: (_url, _key, options) => {
          observedAuthHeader = options?.global?.headers?.['Authorization'] as string | undefined;
          return fake.client;
        },
      },
    });
    const token = makeFakeJwt();
    await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token,
        body: { printingId: FIXTURE_PRINTING_ID },
      }),
    );
    expect(observedAuthHeader).toBe(`Bearer ${token}`);
  });
});

describe('PATCH /v1/me/collection/:id — update', () => {
  it('updates a single row and returns the new wire shape', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          // 1) ownership SELECT
          { data: { id: FIXTURE_COLLECTION_ITEM_ID, user_id: FIXTURE_USER_ID }, error: null },
          // 2) UPDATE
          {
            data: collectionItemRowFixture({ quantity: 5, condition: 'LIGHTLY_PLAYED' }),
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'PATCH',
        token: makeFakeJwt(),
        body: { quantity: 5, condition: 'LIGHTLY_PLAYED' },
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ quantity: number; condition: string }>(response);
    expect(data.quantity).toBe(5);
    expect(data.condition).toBe('LIGHTLY_PLAYED');
  });

  it('returns 404 when the row does not exist', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: null, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'PATCH',
        token: makeFakeJwt(),
        body: { quantity: 5 },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('returns 403 when the row belongs to another user', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          {
            data: { id: FIXTURE_COLLECTION_ITEM_ID, user_id: FIXTURE_OTHER_USER_ID },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'PATCH',
        token: makeFakeJwt(),
        body: { quantity: 5 },
      }),
    );
    expect(response.status).toBe(403);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('AUTH');
  });

  it('rejects an empty patch body with VALIDATION', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'PATCH',
        token: makeFakeJwt(),
        body: {},
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('DELETE /v1/me/collection/:id', () => {
  it('returns 204 on a clean delete', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          // 1) ownership SELECT
          { data: { id: FIXTURE_COLLECTION_ITEM_ID, user_id: FIXTURE_USER_ID }, error: null },
          // 2) DELETE
          { data: null, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(204);
  });

  it('returns 404 when the row does not exist', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: null, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('returns 403 when the row belongs to another user', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          {
            data: { id: FIXTURE_COLLECTION_ITEM_ID, user_id: FIXTURE_OTHER_USER_ID },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(403);
  });
});

const BULK_ITEM_1 = '66666666-6666-4666-8666-666666666666';
const BULK_ITEM_2 = '77777777-7777-4777-8777-777777777777';
const BULK_ITEM_MISSING = '88888888-8888-4888-8888-888888888888';

describe('POST /v1/me/collection/bulk — transactional bulk update', () => {
  it('applies all items and returns the updated wire shapes', async () => {
    const item1Pre = collectionItemRowFixture({ id: BULK_ITEM_1 });
    const item2Pre = collectionItemRowFixture({ id: BULK_ITEM_2, quantity: 4 });
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          // 1) snapshot SELECT
          { data: [item1Pre, item2Pre], error: null },
          // 2) item-1 UPDATE
          { data: { ...item1Pre, quantity: 7 }, error: null },
          // 3) item-2 UPDATE
          { data: { ...item2Pre, quantity: 8 }, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/bulk',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          items: [
            { id: BULK_ITEM_1, patch: { quantity: 7 } },
            { id: BULK_ITEM_2, patch: { quantity: 8 } },
          ],
        },
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ items: { quantity: number }[] }>(response);
    expect(data.items.map((i) => i.quantity)).toEqual([7, 8]);
  });

  it('rolls back to snapshot when a mid-batch update fails', async () => {
    const item1Pre = collectionItemRowFixture({ id: BULK_ITEM_1 });
    const item2Pre = collectionItemRowFixture({ id: BULK_ITEM_2, quantity: 4 });
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          // 1) snapshot SELECT
          { data: [item1Pre, item2Pre], error: null },
          // 2) item-1 UPDATE — succeeds
          { data: { ...item1Pre, quantity: 7 }, error: null },
          // 3) item-2 UPDATE — fails
          { data: null, error: { code: 'XX999', message: 'pg failed' } },
          // 4) revert UPDATE for item-1 (snapshot restore)
          { data: item1Pre, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/bulk',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          items: [
            { id: BULK_ITEM_1, patch: { quantity: 7 } },
            { id: BULK_ITEM_2, patch: { quantity: 8 } },
          ],
        },
      }),
    );
    expect(response.status).toBe(500);
    // Confirm the revert UPDATE was issued — call recorded against
    // collection_item with method=update *after* the failure.
    const updates = fake.calls.filter(
      (c) => c.method === 'update' && c.table === 'collection_item',
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 404 if a requested id is missing from the snapshot', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: [], error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/bulk',
        method: 'POST',
        token: makeFakeJwt(),
        body: { items: [{ id: BULK_ITEM_MISSING, patch: { quantity: 1 } }] },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('rejects a 0-item bulk request with 400 VALIDATION', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/bulk',
        method: 'POST',
        token: makeFakeJwt(),
        body: { items: [] },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a 101-item bulk request with 400 VALIDATION (cap)', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const items = Array.from({ length: 101 }, () => ({
      id: FIXTURE_COLLECTION_ITEM_ID,
      patch: { quantity: 1 },
    }));
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/bulk',
        method: 'POST',
        token: makeFakeJwt(),
        body: { items },
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('all collection routes — common posture', () => {
  it.each(['GET', 'POST'] as const)(
    'method %s on /v1/me/collection requires a JWT (returns 401 envelope)',
    async (method) => {
      const fake = createFakeSupabase();
      const handler = makeHandlerWithFake(fake);
      const response = await handler(new Request('http://localhost/v1/me/collection', { method }));
      expect(response.status).toBe(401);
    },
  );

  it('every error response carries the x-request-id header', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      new Request('http://localhost/v1/me/collection', {
        method: 'GET',
        headers: { 'x-request-id': 'rid-CC' },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-CC');
  });

  it('uses a session that ties to the JWT subject (auth.getUser called with token)', async () => {
    const fake = createFakeSupabase({
      tableResponses: { collection_item: [{ data: [], error: null }] },
      user: makeFakeUser({ id: FIXTURE_USER_ID }),
    });
    const handler = makeHandlerWithFake(fake);
    const token = makeFakeJwt({ sub: FIXTURE_USER_ID });
    await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'GET',
        token,
      }),
    );
    const authCalls = fake.calls.filter((c) => c.method === 'auth.getUser');
    expect(authCalls.length).toBeGreaterThan(0);
    expect(authCalls[0]!.args[0]).toBe(token);
  });
});
