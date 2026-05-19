import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';

import { apiToBrowseApi } from './api';
import {
  makeCard,
  makePrinting,
  makePrintingCurrentPrice,
  makeSet,
} from './fixtures';


function makeClient(
  overrides: {
    cards?: Partial<BinderlyClient['cards']>;
    pricing?: Partial<BinderlyClient['pricing']>;
  } = {},
): BinderlyClient {
  const cards = {
    listSets: vi.fn(),
    getSet: vi.fn(),
    listCardsInSet: vi.fn(),
    getCard: vi.fn(),
    listPrintingsForCard: vi.fn(),
    getPrinting: vi.fn(),
    ...(overrides.cards ?? {}),
  };
  const pricing = {
    listMarkets: vi.fn(),
    getCurrentPrice: vi.fn(),
    getPrintingCurrentPrice: vi.fn(),
    getPriceHistory: vi.fn(),
    getFxRate: vi.fn(),
    ...(overrides.pricing ?? {}),
  };
  return { cards, pricing } as unknown as BinderlyClient;
}

describe('apiToBrowseApi.listAllSets', () => {
  it('exhausts the cursor and concatenates pages', async () => {
    const client = makeClient({
      cards: {
        listSets: vi
          .fn()
          .mockResolvedValueOnce({
            items: [makeSet({ id: 's1' })],
            nextCursor: 'page-2',
          })
          .mockResolvedValueOnce({
            items: [makeSet({ id: 's2' }), makeSet({ id: 's3' })],
            nextCursor: null,
          }),
      },
    });
    const api = apiToBrowseApi(client);
    const sets = await api.listAllSets();
    expect(sets.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(client.cards.listSets).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array when the catalog is empty', async () => {
    const client = makeClient({
      cards: {
        listSets: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      },
    });
    const api = apiToBrowseApi(client);
    expect(await api.listAllSets()).toEqual([]);
  });

  it('forwards the abort signal to the underlying request', async () => {
    const listSets = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const client = makeClient({ cards: { listSets } });
    const controller = new AbortController();
    await apiToBrowseApi(client).listAllSets(controller.signal);
    expect(listSets).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe('apiToBrowseApi.listPrintingsInSet', () => {
  it('joins the set, its cards, and per-card printings into one payload', async () => {
    const set = makeSet({ id: 'set-x' });
    const cardA = makeCard({ id: 'card-a', name: 'Alpha', number: '1' });
    const cardB = makeCard({ id: 'card-b', name: 'Beta', number: '2' });
    const client = makeClient({
      cards: {
        getSet: vi.fn().mockResolvedValue(set),
        listCardsInSet: vi.fn().mockResolvedValue({
          items: [cardA, cardB],
          nextCursor: null,
        }),
        listPrintingsForCard: vi
          .fn()
          .mockImplementation(async ({ cardId }: { cardId: string }) => {
            if (cardId === 'card-a') {
              return [makePrinting({ id: 'p-a-1' }), makePrinting({ id: 'p-a-2' })];
            }
            return [makePrinting({ id: 'p-b-1' })];
          }),
      },
    });
    const result = await apiToBrowseApi(client).listPrintingsInSet('set-x');
    expect(result.set.id).toBe('set-x');
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]?.printings.map((p) => p.id)).toEqual(['p-a-1', 'p-a-2']);
    expect(result.cards[1]?.printings.map((p) => p.id)).toEqual(['p-b-1']);
  });

  it('paginates through cards-in-set as needed', async () => {
    const set = makeSet({ id: 'set-x' });
    const card1 = makeCard({ id: 'c1' });
    const card2 = makeCard({ id: 'c2' });
    const client = makeClient({
      cards: {
        getSet: vi.fn().mockResolvedValue(set),
        listCardsInSet: vi
          .fn()
          .mockResolvedValueOnce({ items: [card1], nextCursor: 'next' })
          .mockResolvedValueOnce({ items: [card2], nextCursor: null }),
        listPrintingsForCard: vi.fn().mockResolvedValue([makePrinting()]),
      },
    });
    const result = await apiToBrowseApi(client).listPrintingsInSet('set-x');
    expect(result.cards.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(client.cards.listCardsInSet).toHaveBeenCalledTimes(2);
  });
});

describe('apiToBrowseApi.getPrintingDetail', () => {
  it('proxies to client.cards.getPrinting', async () => {
    const getPrinting = vi.fn().mockResolvedValue({ id: 'pr-1' });
    const client = makeClient({ cards: { getPrinting } });
    const result = await apiToBrowseApi(client).getPrintingDetail('pr-1');
    expect(getPrinting).toHaveBeenCalledWith({ id: 'pr-1' });
    expect((result as { id: string }).id).toBe('pr-1');
  });
});

describe('apiToBrowseApi.getSet', () => {
  it('proxies to client.cards.getSet', async () => {
    const getSet = vi.fn().mockResolvedValue(makeSet({ id: 's-1' }));
    const client = makeClient({ cards: { getSet } });
    const set = await apiToBrowseApi(client).getSet('s-1');
    expect(getSet).toHaveBeenCalledWith({ id: 's-1' });
    expect(set.id).toBe('s-1');
  });
});

describe('apiToBrowseApi.getCurrentPrice', () => {
  it('proxies to client.pricing.getPrintingCurrentPrice and returns the DTO', async () => {
    const dto = makePrintingCurrentPrice({ printingId: 'pr-1' });
    const getPrintingCurrentPrice = vi.fn().mockResolvedValue(dto);
    const client = makeClient({ pricing: { getPrintingCurrentPrice } });
    const out = await apiToBrowseApi(client).getCurrentPrice('pr-1');
    expect(out).toBe(dto);
    expect(getPrintingCurrentPrice).toHaveBeenCalledWith({ printingId: 'pr-1' });
  });

  it('forwards the abort signal when provided', async () => {
    const getPrintingCurrentPrice = vi
      .fn()
      .mockResolvedValue(makePrintingCurrentPrice());
    const client = makeClient({ pricing: { getPrintingCurrentPrice } });
    const controller = new AbortController();
    await apiToBrowseApi(client).getCurrentPrice('pr-1', controller.signal);
    expect(getPrintingCurrentPrice).toHaveBeenCalledWith({
      printingId: 'pr-1',
      signal: controller.signal,
    });
  });

  it('returns null instead of throwing on ApiNotFoundError', async () => {
    const getPrintingCurrentPrice = vi
      .fn()
      .mockRejectedValue(new ApiNotFoundError('no row', { status: 404 }));
    const client = makeClient({ pricing: { getPrintingCurrentPrice } });
    const out = await apiToBrowseApi(client).getCurrentPrice('pr-missing');
    expect(out).toBeNull();
  });

  it('propagates non-404 errors so the view can render its error state', async () => {
    const error = new Error('upstream down');
    const getPrintingCurrentPrice = vi.fn().mockRejectedValue(error);
    const client = makeClient({ pricing: { getPrintingCurrentPrice } });
    await expect(
      apiToBrowseApi(client).getCurrentPrice('pr-1'),
    ).rejects.toBe(error);
  });
});
