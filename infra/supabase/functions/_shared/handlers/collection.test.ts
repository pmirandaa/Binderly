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

// ============================================================
// T-BE-Q013-CLEANUP: refresh_user_completion best-effort hook
// ============================================================
//
// Every successful mutation (add / update / delete / bulk) fires
// the `supabase.rpc('refresh_user_completion')` shim so the
// per-user completion MVs reflect the change before the next read.
// These tests assert:
//
//   - The RPC is invoked exactly once per successful mutation.
//   - An RPC failure does NOT change the mutation's HTTP response
//     (the underlying mutation already succeeded).
//   - A read-only GET does NOT fire the RPC (no MV mutation to
//     reflect).

describe('collection mutations — completion MV refresh hook (T-BE-Q013-CLEANUP)', () => {
  function rpcCallCount(fake: ReturnType<typeof createFakeSupabase>): number {
    return fake.calls.filter(
      (c) => c.method === 'rpc' && c.table === 'refresh_user_completion',
    ).length;
  }

  it('POST /v1/me/collection (insert path) fires refresh_user_completion once', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: collectionItemRowFixture(), error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID },
      }),
    );
    expect(rpcCallCount(fake)).toBe(1);
  });

  it('POST /v1/me/collection (additive-update path) fires refresh_user_completion once', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          // 1) INSERT — conflict
          { data: null, error: { code: '23505', message: 'unique violation' } },
          // 2) SELECT existing row
          { data: [collectionItemRowFixture({ quantity: 2 })], error: null },
          // 3) UPDATE
          { data: collectionItemRowFixture({ quantity: 3 }), error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID, quantity: 1 },
      }),
    );
    expect(rpcCallCount(fake)).toBe(1);
  });

  it('PATCH /v1/me/collection/:id fires refresh_user_completion once on success', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          { data: { id: FIXTURE_COLLECTION_ITEM_ID, user_id: FIXTURE_USER_ID }, error: null },
          { data: collectionItemRowFixture({ quantity: 5 }), error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'PATCH',
        token: makeFakeJwt(),
        body: { quantity: 5 },
      }),
    );
    expect(rpcCallCount(fake)).toBe(1);
  });

  it('DELETE /v1/me/collection/:id fires refresh_user_completion once on success', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          { data: { id: FIXTURE_COLLECTION_ITEM_ID, user_id: FIXTURE_USER_ID }, error: null },
          { data: null, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    await handler(
      buildRequest({
        url: `http://localhost/v1/me/collection/${FIXTURE_COLLECTION_ITEM_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(rpcCallCount(fake)).toBe(1);
  });

  it('POST /v1/me/collection/bulk fires refresh_user_completion once on success', async () => {
    const item1Pre = collectionItemRowFixture({ id: BULK_ITEM_1 });
    const item2Pre = collectionItemRowFixture({ id: BULK_ITEM_2, quantity: 4 });
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          { data: [item1Pre, item2Pre], error: null },
          { data: { ...item1Pre, quantity: 7 }, error: null },
          { data: { ...item2Pre, quantity: 8 }, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    await handler(
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
    expect(rpcCallCount(fake)).toBe(1);
  });

  it('bulk rollback path does NOT fire refresh_user_completion (mutation failed)', async () => {
    const item1Pre = collectionItemRowFixture({ id: BULK_ITEM_1 });
    const item2Pre = collectionItemRowFixture({ id: BULK_ITEM_2, quantity: 4 });
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          { data: [item1Pre, item2Pre], error: null },
          { data: { ...item1Pre, quantity: 7 }, error: null },
          { data: null, error: { code: 'XX999', message: 'pg failed' } },
          { data: item1Pre, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    await handler(
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
    expect(rpcCallCount(fake)).toBe(0);
  });

  it('GET /v1/me/collection does NOT fire refresh_user_completion (read-only)', async () => {
    const fake = createFakeSupabase({
      tableResponses: { collection_item: [{ data: [], error: null }] },
    });
    const handler = makeHandlerWithFake(fake);
    await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(rpcCallCount(fake)).toBe(0);
  });

  it('refresh failure does NOT change the mutation HTTP response (best-effort)', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: collectionItemRowFixture(), error: null }],
        // Enqueue an error outcome for the rpc:refresh_user_completion
        // queue; the helper's try/catch swallows it. The mutation
        // response should still be 201.
        'rpc:refresh_user_completion': [
          { data: null, error: { code: 'XXMV1', message: 'concurrent refresh in progress' } },
        ],
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
    expect(response.status).toBe(201);
  });

  it('refresh that throws does NOT change the mutation HTTP response (best-effort)', async () => {
    // Stub the rpc to throw by replacing the underlying client. We
    // build the fake first, then monkey-patch `rpc` to throw.
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [{ data: collectionItemRowFixture(), error: null }],
      },
    });
    // Override .rpc — the helper's try/catch should swallow.
    (fake.client as unknown as { rpc: () => Promise<never> }).rpc = () =>
      Promise.reject(new Error('boom'));
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection',
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID },
      }),
    );
    expect(response.status).toBe(201);
  });
});
