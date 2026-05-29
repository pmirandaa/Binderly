// server-fetcher.test.ts — entity-ref parsing + per-table fetching +
// error classification.

import { describe, expect, it, vi } from 'vitest';

import {
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiServerError,
  ApiValidationError,
  type CollectionResource,
} from '@binderly/api-client';

import {
  canonicalEntityId,
  makeDefaultServerFetcher,
  parseEntityRef,
} from '../server-fetcher.js';
import {
  ccPayload,
  cciPayload,
  makeDeadLetterEvent,
  scPayload,
  serverCc,
  serverCci,
  serverSc,
  serverUci,
  uciPayload,
} from './_helpers.js';

function stubCollection(overrides: Record<string, unknown> = {}): CollectionResource {
  // Loosely-typed overrides so test fixtures can return
  // Record<string, unknown> without satisfying the strict DTO contract.
  // Same posture T-OF-QUEUE's tests take.
  const base: Record<string, unknown> = {
    listCollectionItems: vi.fn(async () => ({ items: [], nextCursor: null })),
    getCollectionItem: vi.fn(async () => {
      throw new ApiNotFoundError('not found');
    }),
    getCompletion: vi.fn(),
    addCollectionItem: vi.fn(),
    updateCollectionItem: vi.fn(),
    deleteCollectionItem: vi.fn(),
    listCustomCollections: vi.fn(),
    getCustomCollection: vi.fn(),
    createCustomCollection: vi.fn(),
    updateCustomCollection: vi.fn(),
    deleteCustomCollection: vi.fn(),
    listCustomCollectionItems: vi.fn(async () => []),
    getCustomCollectionItem: vi.fn(async () => {
      throw new ApiNotFoundError('not found');
    }),
    addPrintingToCustomCollection: vi.fn(),
    removePrintingFromCustomCollection: vi.fn(),
    getSmartCollectionRule: vi.fn(),
    updateSmartCollectionExpression: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as CollectionResource;
}

describe('parseEntityRef', () => {
  it('user_collection_item → primary id from payload.id', () => {
    const event = makeDeadLetterEvent({
      tableName: 'user_collection_item',
      payloadJson: JSON.stringify(uciPayload({ id: 'uci-42' })),
    });
    expect(parseEntityRef(event)).toEqual({
      table: 'user_collection_item',
      primaryId: 'uci-42',
      printingId: null,
    });
  });

  it('custom_collection → primary id from payload.id', () => {
    const event = makeDeadLetterEvent({
      tableName: 'custom_collection',
      payloadJson: JSON.stringify(ccPayload({ id: 'cc-xyz' })),
    });
    expect(parseEntityRef(event)).toEqual({
      table: 'custom_collection',
      primaryId: 'cc-xyz',
      printingId: null,
    });
  });

  it('smart_collection → primary id from payload.id', () => {
    const event = makeDeadLetterEvent({
      tableName: 'smart_collection',
      payloadJson: JSON.stringify(scPayload({ id: 'sc-xyz' })),
    });
    expect(parseEntityRef(event)).toEqual({
      table: 'smart_collection',
      primaryId: 'sc-xyz',
      printingId: null,
    });
  });

  it('custom_collection_item → composite from customCollectionId + printingId', () => {
    const event = makeDeadLetterEvent({
      tableName: 'custom_collection_item',
      payloadJson: JSON.stringify(
        cciPayload({ customCollectionId: 'cc-1', printingId: 'p-9' }),
      ),
    });
    expect(parseEntityRef(event)).toEqual({
      table: 'custom_collection_item',
      primaryId: 'cc-1',
      printingId: 'p-9',
    });
  });
});

describe('canonicalEntityId', () => {
  it('returns the primary id for non-membership tables', () => {
    expect(
      canonicalEntityId(
        makeDeadLetterEvent({
          tableName: 'user_collection_item',
          payloadJson: JSON.stringify(uciPayload({ id: 'uci-42' })),
        }),
      ),
    ).toBe('uci-42');
  });

  it('returns the composite "cc:printing" id for custom_collection_item', () => {
    expect(
      canonicalEntityId(
        makeDeadLetterEvent({
          tableName: 'custom_collection_item',
          payloadJson: JSON.stringify(
            cciPayload({ customCollectionId: 'cc-1', printingId: 'p-9' }),
          ),
        }),
      ),
    ).toBe('cc-1:p-9');
  });
});

describe('makeDefaultServerFetcher — user_collection_item', () => {
  it('found: returns the single-GET item (#FU-59)', async () => {
    const target = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' });
    const getCollectionItem = vi.fn(async () => target);
    const collection = stubCollection({ getCollectionItem });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'user_collection_item',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
      }),
    );
    expect(result).toEqual({
      kind: 'found',
      payload: target,
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    // Direct single-GET keyed on the id — no page-walk.
    expect(getCollectionItem).toHaveBeenCalledWith({ id: 'uci-1' });
  });

  it('not_found: maps ApiNotFoundError (404) → not_found', async () => {
    const getCollectionItem = vi.fn(async () => {
      throw new ApiNotFoundError('not found');
    });
    const collection = stubCollection({ getCollectionItem });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'user_collection_item',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-missing' })),
      }),
    );
    expect(result).toEqual({ kind: 'not_found' });
    expect(getCollectionItem).toHaveBeenCalledWith({ id: 'uci-missing' });
  });

  it('transient_error: classifies ApiNetworkError as transient', async () => {
    const collection = stubCollection({
      getCollectionItem: vi.fn(async () => {
        throw new ApiNetworkError('connect ECONNREFUSED');
      }),
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'user_collection_item',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(result.kind).toBe('transient_error');
    if (result.kind === 'transient_error') {
      expect(result.error).toContain('ECONNREFUSED');
    }
  });

  it('transient_error: classifies ApiServerError (5xx) as transient', async () => {
    const collection = stubCollection({
      getCollectionItem: vi.fn(async () => {
        throw new ApiServerError('upstream 503');
      }),
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'user_collection_item',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(result.kind).toBe('transient_error');
  });

  it('transient_error: classifies ApiRateLimitError (429) as transient', async () => {
    const collection = stubCollection({
      getCollectionItem: vi.fn(async () => {
        throw new ApiRateLimitError('rate limited');
      }),
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'user_collection_item',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(result.kind).toBe('transient_error');
  });

  it('transient_error: classifies unexpected ApiValidationError defensively as transient', async () => {
    const collection = stubCollection({
      getCollectionItem: vi.fn(async () => {
        throw new ApiValidationError('bad shape');
      }),
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'user_collection_item',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(result.kind).toBe('transient_error');
  });
});

describe('makeDefaultServerFetcher — custom_collection', () => {
  it('found: returns getCustomCollection result', async () => {
    const dto = serverCc({ id: 'cc-1', updatedAt: '2026-06-01T13:00:00.000Z' });
    const getCustomCollection = vi.fn(async () => dto);
    const collection = stubCollection({
      getCustomCollection,
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'custom_collection',
        payloadJson: JSON.stringify(ccPayload({ id: 'cc-1' })),
      }),
    );
    expect(result).toEqual({
      kind: 'found',
      payload: dto,
      updatedAt: '2026-06-01T13:00:00.000Z',
    });
    expect(getCustomCollection).toHaveBeenCalledWith({ id: 'cc-1' });
  });

  it('not_found: maps ApiNotFoundError → not_found', async () => {
    const collection = stubCollection({
      getCustomCollection: vi.fn(async () => {
        throw new ApiNotFoundError('not found');
      }),
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'custom_collection',
        payloadJson: JSON.stringify(ccPayload()),
      }),
    );
    expect(result).toEqual({ kind: 'not_found' });
  });
});

describe('makeDefaultServerFetcher — smart_collection', () => {
  it('found: uses the same getCustomCollection endpoint', async () => {
    const dto = serverSc({ id: 'sc-1' });
    const getCustomCollection = vi.fn(async () => dto);
    const collection = stubCollection({ getCustomCollection });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'smart_collection',
        payloadJson: JSON.stringify(scPayload({ id: 'sc-1' })),
      }),
    );
    expect(result.kind).toBe('found');
    expect(getCustomCollection).toHaveBeenCalledWith({ id: 'sc-1' });
  });

  it('not_found maps cleanly for smart collections too', async () => {
    const collection = stubCollection({
      getCustomCollection: vi.fn(async () => {
        throw new ApiNotFoundError('gone');
      }),
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'smart_collection',
        payloadJson: JSON.stringify(scPayload()),
      }),
    );
    expect(result).toEqual({ kind: 'not_found' });
  });
});

describe('makeDefaultServerFetcher — custom_collection_item', () => {
  it('found: single-GET by (customCollectionId, printingId) (#FU-59)', async () => {
    const target = serverCci({ customCollectionId: 'cc-1', printingId: 'p-target' });
    const getCustomCollectionItem = vi.fn(async () => target);
    const collection = stubCollection({ getCustomCollectionItem });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'custom_collection_item',
        payloadJson: JSON.stringify(
          cciPayload({ customCollectionId: 'cc-1', printingId: 'p-target' }),
        ),
      }),
    );
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.payload).toEqual(target);
      // No `updated_at` on the membership row → null.
      expect(result.updatedAt).toBeNull();
    }
    expect(getCustomCollectionItem).toHaveBeenCalledWith({
      customCollectionId: 'cc-1',
      printingId: 'p-target',
    });
  });

  it('not_found: maps ApiNotFoundError (404) → not_found', async () => {
    const getCustomCollectionItem = vi.fn(async () => {
      throw new ApiNotFoundError('not found');
    });
    const collection = stubCollection({ getCustomCollectionItem });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'custom_collection_item',
        payloadJson: JSON.stringify(
          cciPayload({ customCollectionId: 'cc-1', printingId: 'p-missing' }),
        ),
      }),
    );
    expect(result).toEqual({ kind: 'not_found' });
    expect(getCustomCollectionItem).toHaveBeenCalledWith({
      customCollectionId: 'cc-1',
      printingId: 'p-missing',
    });
  });

  it('transient_error on getCustomCollectionItem failure', async () => {
    const collection = stubCollection({
      getCustomCollectionItem: vi.fn(async () => {
        throw new ApiServerError('boom');
      }),
    });
    const fetcher = makeDefaultServerFetcher(collection);
    const result = await fetcher.fetch(
      makeDeadLetterEvent({
        tableName: 'custom_collection_item',
        payloadJson: JSON.stringify(cciPayload()),
      }),
    );
    expect(result.kind).toBe('transient_error');
  });
});
