// Tests for the collection resource. Covers CRUD on
// collection_item, custom_collection (manual + smart), manual-
// collection items, and smart-rule expression replacement.
//
// Outbound validation is tested per write method (bad payload →
// ApiValidationError thrown synchronously, never reaches fetch).

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import {
  ApiNetworkError,
  ApiNotFoundError,
  ApiResponseDecodeError,
  ApiUnauthorizedError,
  ApiValidationError,
} from '../error.js';
import { errEnvelope, mockFetch, mockFetchReject, okEnvelope } from '../test-helpers.js';
import {
  FIXTURE_IDS,
  VALID_COLLECTION_ITEM,
  VALID_COMPLETION,
  VALID_CUSTOM_COLLECTION,
  VALID_CUSTOM_COLLECTION_ITEM,
  VALID_PAGE,
  VALID_SMART_RULE,
} from './_fixtures.js';
import { makeCollectionResource } from './collection.js';

function makeResource(fetch: ReturnType<typeof mockFetch>): {
  fetch: ReturnType<typeof mockFetch>;
  collection: ReturnType<typeof makeCollectionResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => 'jwt-1',
    fetch,
  });
  return { fetch, collection: makeCollectionResource(http) };
}

// ============================================================
// listCollectionItems
// ============================================================

describe('collection.listCollectionItems', () => {
  it('returns a paginated list on happy path', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_COLLECTION_ITEM])) }),
    );
    const page = await collection.listCollectionItems();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(FIXTURE_IDS.collectionItemId);
  });

  it('hits GET /v1/me/collection', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_COLLECTION_ITEM])) }),
    );
    await collection.listCollectionItems();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/collection');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const { collection } = makeResource(mockFetch({ status: 401 }));
    await expect(collection.listCollectionItems()).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });
});

// ============================================================
// getCollectionItem (single-GET, #FU-49)
// ============================================================

describe('collection.getCollectionItem', () => {
  it('returns the single collection item on happy path', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    const item = await collection.getCollectionItem({ id: FIXTURE_IDS.collectionItemId });
    expect(item.id).toBe(FIXTURE_IDS.collectionItemId);
  });

  it('hits GET /v1/me/collection/:id with the id encoded into the path', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    await collection.getCollectionItem({ id: FIXTURE_IDS.collectionItemId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/collection/${FIXTURE_IDS.collectionItemId}`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 404, body: errEnvelope({ code: 'NOT_FOUND', message: 'nope' }) }),
    );
    await expect(
      collection.getCollectionItem({ id: FIXTURE_IDS.collectionItemId }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const { collection } = makeResource(mockFetch({ status: 401 }));
    await expect(
      collection.getCollectionItem({ id: FIXTURE_IDS.collectionItemId }),
    ).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });
});

// ============================================================
// addCollectionItem (write — outbound validation)
// ============================================================

describe('collection.addCollectionItem', () => {
  it('happy-path round-trip returns the new collection item', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    const item = await collection.addCollectionItem({ printingId: FIXTURE_IDS.printingId });
    expect(item.id).toBe(FIXTURE_IDS.collectionItemId);
  });

  it('hits POST /v1/me/collection with the body JSON-encoded', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    await collection.addCollectionItem({ printingId: FIXTURE_IDS.printingId, quantity: 3 });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toContain('"printingId"');
    expect(init?.body).toContain('"quantity":3');
  });

  it('throws ApiValidationError synchronously when printingId is not a UUID', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    await expect(
      collection.addCollectionItem({ printingId: 'not-a-uuid' } as never),
    ).rejects.toBeInstanceOf(ApiValidationError);
    // Did NOT round-trip — the wire was never touched.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws ApiValidationError when quantity is < 1', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    await expect(
      collection.addCollectionItem({
        printingId: FIXTURE_IDS.printingId,
        quantity: 0,
      } as never),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiValidationError when condition is an unknown enum value', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    await expect(
      collection.addCollectionItem({
        printingId: FIXTURE_IDS.printingId,
        condition: 'BANANA' as never,
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('ApiValidationError carries the zod issues + label', async () => {
    expect.assertions(2);
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    try {
      await collection.addCollectionItem({ printingId: 'bad' } as never);
    } catch (error) {
      expect((error as ApiValidationError).message).toContain('addCollectionItemRequest');
      expect((error as ApiValidationError).zodIssues?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// updateCollectionItem
// ============================================================

describe('collection.updateCollectionItem', () => {
  it('hits PATCH /v1/me/collection/{id} with the patch body', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    await collection.updateCollectionItem({
      id: FIXTURE_IDS.collectionItemId,
      patch: { quantity: 2 },
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/collection/${FIXTURE_IDS.collectionItemId}`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('throws ApiValidationError on a fully-empty patch', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COLLECTION_ITEM) }),
    );
    await expect(
      collection.updateCollectionItem({
        id: FIXTURE_IDS.collectionItemId,
        patch: {} as never,
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { collection } = makeResource(mockFetch({ status: 404 }));
    await expect(
      collection.updateCollectionItem({
        id: FIXTURE_IDS.collectionItemId,
        patch: { quantity: 2 },
      }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

// ============================================================
// deleteCollectionItem
// ============================================================

describe('collection.deleteCollectionItem', () => {
  it('hits DELETE /v1/me/collection/{id} and resolves on 204', async () => {
    const { fetch, collection } = makeResource(mockFetch({ status: 204, body: '' }));
    await collection.deleteCollectionItem({ id: FIXTURE_IDS.collectionItemId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/collection/${FIXTURE_IDS.collectionItemId}`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { collection } = makeResource(mockFetch({ status: 404 }));
    await expect(
      collection.deleteCollectionItem({ id: FIXTURE_IDS.collectionItemId }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

// ============================================================
// custom_collection CRUD
// ============================================================

describe('collection.listCustomCollections', () => {
  it('returns the array on happy path', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope([VALID_CUSTOM_COLLECTION]) }),
    );
    const list = await collection.listCustomCollections();
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('charizard-hunters');
  });
});

describe('collection.getCustomCollection', () => {
  it('hits GET /v1/me/custom-collections/{id}', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION) }),
    );
    await collection.getCustomCollection({ id: FIXTURE_IDS.customCollectionId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/custom-collections/${FIXTURE_IDS.customCollectionId}`);
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { collection } = makeResource(mockFetch({ status: 404 }));
    await expect(
      collection.getCustomCollection({ id: FIXTURE_IDS.customCollectionId }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

describe('collection.createCustomCollection', () => {
  it('happy-path manual create round-trip', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION) }),
    );
    const created = await collection.createCustomCollection({
      kind: 'manual',
      name: 'Charizard Hunters',
      slug: 'charizard-hunters',
    });
    expect(created.slug).toBe('charizard-hunters');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('happy-path smart create with expression', async () => {
    const { collection } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ ...VALID_CUSTOM_COLLECTION, kind: 'smart' }),
      }),
    );
    const created = await collection.createCustomCollection({
      kind: 'smart',
      name: 'Fire Types',
      slug: 'fire-types',
      expression: { op: 'has_type', value: 'FIRE' },
    });
    expect(created.slug).toBe('charizard-hunters');
  });

  it('throws ApiValidationError on a bad slug', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION) }),
    );
    await expect(
      collection.createCustomCollection({
        kind: 'manual',
        name: 'X',
        slug: 'NOT VALID',
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiValidationError when smart create is missing expression', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION) }),
    );
    await expect(
      collection.createCustomCollection({
        kind: 'smart',
        name: 'X',
        slug: 'x',
      } as never),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('collection.updateCustomCollection', () => {
  it('hits PATCH /v1/me/custom-collections/{id}', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION) }),
    );
    await collection.updateCustomCollection({
      id: FIXTURE_IDS.customCollectionId,
      patch: { name: 'Renamed' },
    });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('throws ApiValidationError on an empty patch', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION) }),
    );
    await expect(
      collection.updateCustomCollection({
        id: FIXTURE_IDS.customCollectionId,
        patch: {} as never,
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('collection.deleteCustomCollection', () => {
  it('resolves on 204', async () => {
    const { collection } = makeResource(mockFetch({ status: 204, body: '' }));
    await expect(
      collection.deleteCustomCollection({ id: FIXTURE_IDS.customCollectionId }),
    ).resolves.toBeUndefined();
  });
});

// ============================================================
// custom_collection_item (manual collection membership)
// ============================================================

describe('collection.listCustomCollectionItems', () => {
  it('returns the array on happy path', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope([VALID_CUSTOM_COLLECTION_ITEM]) }),
    );
    const list = await collection.listCustomCollectionItems({
      customCollectionId: FIXTURE_IDS.customCollectionId,
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.printingId).toBe(FIXTURE_IDS.printingId);
  });
});

describe('collection.getCustomCollectionItem', () => {
  it('returns the single membership row on happy path', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION_ITEM) }),
    );
    const item = await collection.getCustomCollectionItem({
      customCollectionId: FIXTURE_IDS.customCollectionId,
      printingId: FIXTURE_IDS.printingId,
    });
    expect(item.printingId).toBe(FIXTURE_IDS.printingId);
  });

  it('hits GET /v1/me/custom-collections/:id/items/:printingId', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION_ITEM) }),
    );
    await collection.getCustomCollectionItem({
      customCollectionId: FIXTURE_IDS.customCollectionId,
      printingId: FIXTURE_IDS.printingId,
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(
      `/v1/me/custom-collections/${FIXTURE_IDS.customCollectionId}/items/${FIXTURE_IDS.printingId}`,
    );
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 404, body: errEnvelope({ code: 'NOT_FOUND', message: 'nope' }) }),
    );
    await expect(
      collection.getCustomCollectionItem({
        customCollectionId: FIXTURE_IDS.customCollectionId,
        printingId: FIXTURE_IDS.printingId,
      }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

describe('collection.addPrintingToCustomCollection', () => {
  it('happy path adds a printing', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION_ITEM) }),
    );
    await collection.addPrintingToCustomCollection({
      customCollectionId: FIXTURE_IDS.customCollectionId,
      body: { printingId: FIXTURE_IDS.printingId },
    });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('throws ApiValidationError on a bad printingId', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CUSTOM_COLLECTION_ITEM) }),
    );
    await expect(
      collection.addPrintingToCustomCollection({
        customCollectionId: FIXTURE_IDS.customCollectionId,
        body: { printingId: 'bad' } as never,
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('collection.removePrintingFromCustomCollection', () => {
  it('hits DELETE /v1/me/custom-collections/{id}/items/{printingId}', async () => {
    const { fetch, collection } = makeResource(mockFetch({ status: 204, body: '' }));
    await collection.removePrintingFromCustomCollection({
      customCollectionId: FIXTURE_IDS.customCollectionId,
      printingId: FIXTURE_IDS.printingId,
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(
      `/v1/me/custom-collections/${FIXTURE_IDS.customCollectionId}/items/${FIXTURE_IDS.printingId}`,
    );
  });
});

// ============================================================
// smart_collection_rule
// ============================================================

describe('collection.getSmartCollectionRule', () => {
  it('returns the smart rule on happy path', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_RULE) }),
    );
    const rule = await collection.getSmartCollectionRule({
      customCollectionId: FIXTURE_IDS.customCollectionId,
    });
    expect(rule.customCollectionId).toBe(FIXTURE_IDS.customCollectionId);
  });
});

describe('collection.updateSmartCollectionExpression', () => {
  it('hits PUT /v1/me/custom-collections/{id}/smart-rule', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_RULE) }),
    );
    await collection.updateSmartCollectionExpression({
      customCollectionId: FIXTURE_IDS.customCollectionId,
      body: { expression: { op: 'has_type', value: 'FIRE' } },
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/custom-collections/${FIXTURE_IDS.customCollectionId}/smart-rule`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PUT');
  });

  it('throws ApiValidationError when expression is missing', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_RULE) }),
    );
    await expect(
      collection.updateSmartCollectionExpression({
        customCollectionId: FIXTURE_IDS.customCollectionId,
        body: {} as never,
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

// ============================================================
// Cross-cutting
// ============================================================

// ============================================================
// getCompletion (new — `/v1/me/collection/completion`)
// ============================================================

describe('collection.getCompletion', () => {
  it('returns the typed completion payload on happy path', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COMPLETION) }),
    );
    const result = await collection.getCompletion();
    expect(result.perSet).toHaveLength(1);
    expect(result.global.uniqueCardsOwned).toBe(100);
  });

  it('hits GET /v1/me/collection/completion', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COMPLETION) }),
    );
    await collection.getCompletion();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/collection/completion');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('sends the Authorization header (authed endpoint)', async () => {
    const { fetch, collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_COMPLETION) }),
    );
    await collection.getCompletion();
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBe('Bearer jwt-1');
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const { collection } = makeResource(mockFetch({ status: 401 }));
    await expect(collection.getCompletion()).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });

  it('throws ApiResponseDecodeError when the payload is malformed', async () => {
    const { collection } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ global: VALID_COMPLETION.global, perSet: 'not-an-array' }),
      }),
    );
    await expect(collection.getCompletion()).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });
});

describe('collection — cross-cutting', () => {
  it('returns ApiResponseDecodeError on a bad shape', async () => {
    const { collection } = makeResource(
      mockFetch({ status: 200, body: okEnvelope({ wrong: 'shape' }) }),
    );
    await expect(
      collection.getCustomCollection({ id: FIXTURE_IDS.customCollectionId }),
    ).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });

  it('returns ApiNetworkError on fetch reject', async () => {
    const { collection } = makeResource(mockFetchReject(new Error('boom')));
    await expect(collection.listCollectionItems()).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it('returns ApiUnauthorizedError when the envelope code is AUTH', async () => {
    const { collection } = makeResource(
      mockFetch({
        status: 401,
        body: errEnvelope({ code: 'AUTH', message: 'no token' }),
      }),
    );
    await expect(collection.listCollectionItems()).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });
});
