import { describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type { CollectionItemDto } from '@binderly/api-contracts';

import { apiToCollectionApi, ownedPrintingIds, rosterFromCardsWithPrintings } from './api';
import {
  FIXTURE_OWNED_ITEMS,
  fixtureSetContents,
} from './fixtures';
import {
  makeCardWithPrintings,
  makePrinting,
  makeSet,
} from '../browse/fixtures';

describe('rosterFromCardsWithPrintings', () => {
  it('projects card+printing DTOs into the narrow roster shape', () => {
    const contents = fixtureSetContents();
    const roster = rosterFromCardsWithPrintings(contents['set-a']!.cards);
    expect(roster.cards).toHaveLength(2);
    expect(roster.cards[0]).toEqual({ cardId: 'card-a1', setId: 'set-a' });
    expect(roster.printings).toHaveLength(4);
    expect(roster.printings[0]).toEqual({
      printingId: 'p-a1-holo',
      cardId: 'card-a1',
      setId: 'set-a',
      includeInMasterSet: true,
    });
    expect(
      roster.printings.find((p) => p.printingId === 'p-a2-promo')?.includeInMasterSet,
    ).toBe(false);
  });
});

describe('ownedPrintingIds', () => {
  it('maps collection items to their printing ids', () => {
    const ids = ownedPrintingIds(FIXTURE_OWNED_ITEMS);
    expect(ids).toEqual([
      'p-a1-holo',
      'p-b1-holo',
      'p-b1-alt',
      'p-b2-holo',
      'p-b2-fa',
    ]);
  });

  it('returns an empty array for no items', () => {
    expect(ownedPrintingIds([])).toEqual([]);
  });
});

function makeFakeClient(): {
  client: BinderlyClient;
  listSets: ReturnType<typeof vi.fn>;
  listCollectionItems: ReturnType<typeof vi.fn>;
  getCompletion: ReturnType<typeof vi.fn>;
} {
  const listSets = vi.fn();
  const getSet = vi.fn();
  const listCardsInSet = vi.fn();
  const listPrintingsForCard = vi.fn();
  const listCollectionItems = vi.fn();
  const getCompletion = vi.fn();
  const client = {
    cards: { listSets, getSet, listCardsInSet, listPrintingsForCard },
    collection: { listCollectionItems, getCompletion },
  } as unknown as BinderlyClient;
  return { client, listSets, listCollectionItems, getCompletion };
}

describe('apiToCollectionApi.listAllSets', () => {
  it('exhausts the cursor and returns every page', async () => {
    const { client, listSets } = makeFakeClient();
    listSets
      .mockResolvedValueOnce({ items: [makeSet({ id: '1' })], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [makeSet({ id: '2' })], nextCursor: null });
    const api = apiToCollectionApi(client);
    const out = await api.listAllSets();
    expect(out).toHaveLength(2);
    expect(listSets).toHaveBeenCalledTimes(2);
  });
});

describe('apiToCollectionApi.listOwnedItems', () => {
  it('exhausts the collection-items cursor', async () => {
    const { client, listCollectionItems } = makeFakeClient();
    const sample = (id: string): CollectionItemDto => ({
      id,
      userId: 'u',
      printingId: `p-${id}`,
      quantity: 1,
      condition: 'NEAR_MINT',
      gradeCompany: null,
      grade: null,
      acquiredAt: null,
      acquiredPrice: null,
      acquiredCurrency: null,
      notes: null,
      photoUrls: [],
      source: 'manual',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    listCollectionItems
      .mockResolvedValueOnce({ items: [sample('a'), sample('b')], nextCursor: 'cursor-x' })
      .mockResolvedValueOnce({ items: [sample('c')], nextCursor: null });
    const api = apiToCollectionApi(client);
    const out = await api.listOwnedItems();
    expect(out.map((it) => it.id)).toEqual(['a', 'b', 'c']);
    expect(listCollectionItems).toHaveBeenCalledTimes(2);
  });
});

describe('apiToCollectionApi.listSetContents', () => {
  it('returns set + cards with printings inlined', async () => {
    const { client } = makeFakeClient();
    const set = makeSet({ id: 'set-x' });
    const card = makeCardWithPrintings({ id: 'c1' }, [makePrinting({ id: 'p1' })]);
    (client.cards.getSet as ReturnType<typeof vi.fn>).mockResolvedValue(set);
    (client.cards.listCardsInSet as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ ...card, printings: undefined }],
      nextCursor: null,
    });
    (client.cards.listPrintingsForCard as ReturnType<typeof vi.fn>).mockResolvedValue(
      card.printings,
    );
    const api = apiToCollectionApi(client);
    const out = await api.listSetContents('set-x');
    expect(out.set.id).toBe('set-x');
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]!.printings[0]!.id).toBe('p1');
  });
});

describe('apiToCollectionApi.getCompletion', () => {
  it('delegates to client.collection.getCompletion and returns the DTO', async () => {
    const { client, getCompletion } = makeFakeClient();
    const dto = {
      global: {
        allPokemonPct: 12.5,
        masterPct: 7.3,
        uniqueCardsOwned: 42,
        uniqueCardsTotal: 336,
        masterOwned: 50,
        masterTotal: 690,
      },
      perSet: [],
      lastUpdatedAt: null,
    };
    getCompletion.mockResolvedValue(dto);
    const api = apiToCollectionApi(client);
    const out = await api.getCompletion();
    expect(out).toBe(dto);
    expect(getCompletion).toHaveBeenCalledTimes(1);
  });

  it('passes the abort signal through when provided', async () => {
    const { client, getCompletion } = makeFakeClient();
    getCompletion.mockResolvedValue({
      global: {
        allPokemonPct: 0,
        masterPct: 0,
        uniqueCardsOwned: 0,
        uniqueCardsTotal: 0,
        masterOwned: 0,
        masterTotal: 0,
      },
      perSet: [],
      lastUpdatedAt: null,
    });
    const controller = new AbortController();
    const api = apiToCollectionApi(client);
    await api.getCompletion(controller.signal);
    expect(getCompletion).toHaveBeenCalledWith({ signal: controller.signal });
  });

  it('does NOT include the signal key when omitted', async () => {
    const { client, getCompletion } = makeFakeClient();
    getCompletion.mockResolvedValue({
      global: {
        allPokemonPct: 0,
        masterPct: 0,
        uniqueCardsOwned: 0,
        uniqueCardsTotal: 0,
        masterOwned: 0,
        masterTotal: 0,
      },
      perSet: [],
      lastUpdatedAt: null,
    });
    const api = apiToCollectionApi(client);
    await api.getCompletion();
    expect(getCompletion).toHaveBeenCalledWith({});
  });

  it('propagates errors from the api-client', async () => {
    const { client, getCompletion } = makeFakeClient();
    getCompletion.mockRejectedValue(new Error('boom'));
    const api = apiToCollectionApi(client);
    await expect(api.getCompletion()).rejects.toThrow('boom');
  });
});

describe('apiToCollectionApi.catalogRoster', () => {
  it('walks every set + card + printing and projects them to the roster', async () => {
    const { client, listSets } = makeFakeClient();
    listSets.mockResolvedValue({
      items: [makeSet({ id: 'set-a' }), makeSet({ id: 'set-b' })],
      nextCursor: null,
    });
    (client.cards.listCardsInSet as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ setId }: { setId: string }) => ({
        items: [
          {
            ...makeCardWithPrintings({
              id: `c-${setId}-1`,
              setId,
              number: '1',
            }),
            printings: undefined,
          },
        ],
        nextCursor: null,
      }),
    );
    (client.cards.listPrintingsForCard as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ cardId }: { cardId: string }) => [
        makePrinting({
          id: `p-${cardId}-holo`,
          cardId,
          includeInMasterSet: true,
        }),
        makePrinting({
          id: `p-${cardId}-promo`,
          cardId,
          includeInMasterSet: false,
        }),
      ],
    );
    const api = apiToCollectionApi(client);
    const roster = await api.catalogRoster();
    expect(roster.cards).toHaveLength(2);
    expect(roster.printings).toHaveLength(4);
    expect(roster.printings.filter((p) => p.includeInMasterSet)).toHaveLength(2);
    const setIds = new Set(roster.cards.map((c) => c.setId));
    expect(setIds).toEqual(new Set(['set-a', 'set-b']));
  });
});
