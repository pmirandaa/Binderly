import { describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';

import { apiToCustomCollectionApi, manualOnly } from './api';
import { makeCustomCollection } from './fixtures';

describe('manualOnly', () => {
  it('keeps only manual-kind rows', () => {
    const rows = [
      makeCustomCollection({ id: 'cc-manual', kind: 'manual' }),
      makeCustomCollection({ id: 'cc-smart', kind: 'smart' }),
    ];
    const filtered = manualOnly(rows);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('cc-manual');
  });
});

describe('apiToCustomCollectionApi', () => {
  function makeFakeClient(): {
    client: BinderlyClient;
    collection: {
      listCustomCollections: ReturnType<typeof vi.fn>;
      getCustomCollection: ReturnType<typeof vi.fn>;
      createCustomCollection: ReturnType<typeof vi.fn>;
      updateCustomCollection: ReturnType<typeof vi.fn>;
      deleteCustomCollection: ReturnType<typeof vi.fn>;
      listCustomCollectionItems: ReturnType<typeof vi.fn>;
      addPrintingToCustomCollection: ReturnType<typeof vi.fn>;
      removePrintingFromCustomCollection: ReturnType<typeof vi.fn>;
    };
    cards: {
      listSets: ReturnType<typeof vi.fn>;
      getPrinting: ReturnType<typeof vi.fn>;
      listCardsInSet: ReturnType<typeof vi.fn>;
      listPrintingsForCard: ReturnType<typeof vi.fn>;
    };
  } {
    const collection = {
      listCustomCollections: vi.fn(async () => []),
      getCustomCollection: vi.fn(async () => ({}) as never),
      createCustomCollection: vi.fn(async () => ({}) as never),
      updateCustomCollection: vi.fn(async () => ({}) as never),
      deleteCustomCollection: vi.fn(async () => undefined),
      listCustomCollectionItems: vi.fn(async () => []),
      addPrintingToCustomCollection: vi.fn(async () => ({}) as never),
      removePrintingFromCustomCollection: vi.fn(async () => undefined),
    };
    const cards = {
      listSets: vi.fn(async () => ({ items: [], nextCursor: null })),
      getPrinting: vi.fn(async (input: { id: string }) => ({ id: input.id }) as never),
      listCardsInSet: vi.fn(async () => ({ items: [], nextCursor: null })),
      listPrintingsForCard: vi.fn(async () => []),
    };
    const client = {
      collection,
      cards,
    } as unknown as BinderlyClient;
    return { client, collection, cards };
  }

  it('passes manual kind on create', async () => {
    const { client, collection } = makeFakeClient();
    const api = apiToCustomCollectionApi(client);
    await api.createCustomCollection({
      name: 'New',
      slug: 'new',
      description: null,
    });
    expect(collection.createCustomCollection).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual', name: 'New', slug: 'new' }),
      {},
    );
  });

  it('forwards updateCustomCollection arguments through', async () => {
    const { client, collection } = makeFakeClient();
    const api = apiToCustomCollectionApi(client);
    await api.updateCustomCollection({
      id: 'cc-1',
      patch: { name: 'Renamed' },
    });
    expect(collection.updateCustomCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cc-1', patch: { name: 'Renamed' } }),
    );
  });

  it('forwards deleteCustomCollection through', async () => {
    const { client, collection } = makeFakeClient();
    const api = apiToCustomCollectionApi(client);
    await api.deleteCustomCollection('cc-1');
    expect(collection.deleteCustomCollection).toHaveBeenCalledWith({ id: 'cc-1' });
  });

  it('fans out getPrintingsByIds sequentially', async () => {
    const { client, cards } = makeFakeClient();
    const api = apiToCustomCollectionApi(client);
    const out = await api.getPrintingsByIds(['p1', 'p2']);
    expect(cards.getPrinting).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2);
  });
});
