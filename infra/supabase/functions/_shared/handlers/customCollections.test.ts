import { describe, expect, it } from 'vitest';

import { ROUTES } from '../routes-table.ts';
import { makeHandler } from '../dispatch.ts';
import {
  buildRequest,
  createFakeSupabase,
  customCollectionRowFixture,
  FIXTURE_CUSTOM_COLLECTION_ID,
  FIXTURE_OTHER_USER_ID,
  FIXTURE_PRINTING_ID,
  FIXTURE_USER_ID,
  makeFakeJwt,
  readErrorBody,
  readSuccessBody,
} from '../test-helpers.ts';
import { checkFreemiumLimits } from './customCollections.ts';

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

describe('GET /v1/me/custom-collections', () => {
  it('returns the user collections', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          {
            data: [
              customCollectionRowFixture(),
              customCollectionRowFixture({ id: 'cc-2', slug: 'binder-2' }),
            ],
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<unknown[]>(response);
    expect(data.length).toBe(2);
  });

  it('returns 401 envelope when no token', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({ url: 'http://localhost/v1/me/custom-collections', method: 'GET' }),
    );
    expect(response.status).toBe(401);
  });
});

describe('POST /v1/me/custom-collections', () => {
  it('creates a manual collection and returns 201', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          {
            data: customCollectionRowFixture({ kind: 'manual' }),
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'POST',
        token: makeFakeJwt(),
        body: { kind: 'manual', name: 'Gym Leaders', slug: 'gym-leaders' },
      }),
    );
    expect(response.status).toBe(201);
    const data = await readSuccessBody<{ name: string }>(response);
    expect(data.name).toBe('Gym Leaders');
  });

  it('creates a smart collection (insert + smart_collection_rule)', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          {
            data: customCollectionRowFixture({ kind: 'smart' }),
            error: null,
          },
        ],
        smart_collection_rule: [{ data: null, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          kind: 'smart',
          name: 'Holos',
          slug: 'holos',
          expression: { rule: 'variantClass=HOLO' },
        },
      }),
    );
    expect(response.status).toBe(201);
    const ruleInserts = fake.calls.filter(
      (c) => c.method === 'insert' && c.table === 'smart_collection_rule',
    );
    expect(ruleInserts.length).toBe(1);
  });

  it('rolls back the parent insert if the smart-rule insert fails', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          {
            data: customCollectionRowFixture({ kind: 'smart' }),
            error: null,
          },
          // delete (cleanup)
          { data: null, error: null },
        ],
        smart_collection_rule: [{ data: null, error: { code: 'XX999', message: 'rule failed' } }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          kind: 'smart',
          name: 'Holos',
          slug: 'holos',
          expression: { rule: 'variantClass=HOLO' },
        },
      }),
    );
    expect(response.status).toBe(500);
    const cleanupDeletes = fake.calls.filter(
      (c) => c.method === 'delete' && c.table === 'custom_collection',
    );
    expect(cleanupDeletes.length).toBe(1);
  });

  it('rejects unknown kind with VALIDATION', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'POST',
        token: makeFakeJwt(),
        body: { kind: 'enchanted', name: 'X', slug: 'x' },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects bad slug with VALIDATION', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'POST',
        token: makeFakeJwt(),
        body: { kind: 'manual', name: 'X', slug: 'Bad Slug' },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('translates a 23505 unique violation on slug into CONFLICT', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [{ data: null, error: { code: '23505', message: 'duplicate slug' } }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: 'http://localhost/v1/me/custom-collections',
        method: 'POST',
        token: makeFakeJwt(),
        body: { kind: 'manual', name: 'X', slug: 'gym-leaders' },
      }),
    );
    expect(response.status).toBe(409);
  });
});

describe('GET /v1/me/custom-collections/:id', () => {
  it('returns 200 for an owned collection', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [{ data: customCollectionRowFixture(), error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('returns 403 for another user`s collection', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          {
            data: customCollectionRowFixture({ user_id: FIXTURE_OTHER_USER_ID }),
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 when not present', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [{ data: null, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('PATCH /v1/me/custom-collections/:id', () => {
  it('updates an owned collection and returns 200', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          // ownership check
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
          // update
          {
            data: customCollectionRowFixture({ name: 'Renamed' }),
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}`,
        method: 'PATCH',
        token: makeFakeJwt(),
        body: { name: 'Renamed' },
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ name: string }>(response);
    expect(data.name).toBe('Renamed');
  });

  it('rejects an empty patch with VALIDATION', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}`,
        method: 'PATCH',
        token: makeFakeJwt(),
        body: {},
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('DELETE /v1/me/custom-collections/:id', () => {
  it('returns 204 on a clean delete', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
          { data: null, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(204);
  });

  it('returns 403 for another user`s collection', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          {
            data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_OTHER_USER_ID },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('GET /v1/me/custom-collections/:id/items', () => {
  it('returns the membership rows', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        custom_collection_item: [
          {
            data: [
              {
                custom_collection_id: FIXTURE_CUSTOM_COLLECTION_ID,
                printing_id: FIXTURE_PRINTING_ID,
                added_at: '2024-06-02T12:00:00.000Z',
              },
            ],
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<Array<{ printingId: string }>>(response);
    expect(data[0]!.printingId).toBe(FIXTURE_PRINTING_ID);
  });
});

describe('GET /v1/me/custom-collections/:id/items/:printingId — single-GET (#FU-49)', () => {
  it('returns the single membership row', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        custom_collection_item: [
          {
            data: {
              custom_collection_id: FIXTURE_CUSTOM_COLLECTION_ID,
              printing_id: FIXTURE_PRINTING_ID,
              added_at: '2024-06-02T12:00:00.000Z',
            },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items/${FIXTURE_PRINTING_ID}`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ customCollectionId: string; printingId: string }>(
      response,
    );
    expect(data.customCollectionId).toBe(FIXTURE_CUSTOM_COLLECTION_ID);
    expect(data.printingId).toBe(FIXTURE_PRINTING_ID);
  });

  it('returns 404 when the membership row is absent', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        custom_collection_item: [{ data: null, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items/${FIXTURE_PRINTING_ID}`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(404);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when the caller does not own the parent collection', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          {
            data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_OTHER_USER_ID },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items/${FIXTURE_PRINTING_ID}`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('POST /v1/me/custom-collections/:id/items', () => {
  it('adds a printing and returns 201', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        custom_collection_item: [
          {
            data: {
              custom_collection_id: FIXTURE_CUSTOM_COLLECTION_ID,
              printing_id: FIXTURE_PRINTING_ID,
              added_at: '2024-06-02T12:00:00.000Z',
            },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items`,
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID },
      }),
    );
    expect(response.status).toBe(201);
  });

  it('translates 23505 (already-in-collection) into CONFLICT', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        custom_collection_item: [{ data: null, error: { code: '23505', message: 'duplicate' } }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items`,
        method: 'POST',
        token: makeFakeJwt(),
        body: { printingId: FIXTURE_PRINTING_ID },
      }),
    );
    expect(response.status).toBe(409);
  });
});

describe('DELETE /v1/me/custom-collections/:id/items/:printingId', () => {
  it('returns 204 when the row exists and gets deleted', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        custom_collection_item: [
          {
            data: {
              custom_collection_id: FIXTURE_CUSTOM_COLLECTION_ID,
              printing_id: FIXTURE_PRINTING_ID,
              added_at: '2024-06-02T12:00:00.000Z',
            },
            error: null,
          },
          { data: null, error: null },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items/${FIXTURE_PRINTING_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(204);
  });

  it('returns 404 when the printing is not in the collection', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        custom_collection_item: [{ data: null, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/items/${FIXTURE_PRINTING_ID}`,
        method: 'DELETE',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /v1/me/custom-collections/:id/smart-rule', () => {
  it('returns the rule', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        smart_collection_rule: [
          {
            data: {
              custom_collection_id: FIXTURE_CUSTOM_COLLECTION_ID,
              expression: { rule: 'variantClass=HOLO' },
              last_evaluated_at: null,
            },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/smart-rule`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ expression: { rule: string } }>(response);
    expect(data.expression).toEqual({ rule: 'variantClass=HOLO' });
  });

  it('returns 404 when the rule is not present', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        smart_collection_rule: [{ data: null, error: null }],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/smart-rule`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('PUT /v1/me/custom-collections/:id/smart-rule', () => {
  it('replaces the expression', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        custom_collection: [
          { data: { id: FIXTURE_CUSTOM_COLLECTION_ID, user_id: FIXTURE_USER_ID }, error: null },
        ],
        smart_collection_rule: [
          {
            data: {
              custom_collection_id: FIXTURE_CUSTOM_COLLECTION_ID,
              expression: { rule: 'variantClass=GOLD' },
              last_evaluated_at: null,
            },
            error: null,
          },
        ],
      },
    });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/smart-rule`,
        method: 'PUT',
        token: makeFakeJwt(),
        body: { expression: { rule: 'variantClass=GOLD' } },
      }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccessBody<{ expression: { rule: string } }>(response);
    expect(data.expression).toEqual({ rule: 'variantClass=GOLD' });
  });

  it('rejects an empty body', async () => {
    const fake = createFakeSupabase();
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      buildRequest({
        url: `http://localhost/v1/me/custom-collections/${FIXTURE_CUSTOM_COLLECTION_ID}/smart-rule`,
        method: 'PUT',
        token: makeFakeJwt(),
        body: {},
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('checkFreemiumLimits — TODO marker', () => {
  it('is a no-op for manual collections (until T-BE-AUTH wires entitlements)', async () => {
    await expect(
      checkFreemiumLimits({ user: { id: FIXTURE_USER_ID } }, 'manual'),
    ).resolves.toBeUndefined();
  });

  it('is a no-op for smart collections', async () => {
    await expect(
      checkFreemiumLimits({ user: { id: FIXTURE_USER_ID } }, 'smart'),
    ).resolves.toBeUndefined();
  });
});
