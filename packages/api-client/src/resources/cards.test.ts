// Tests for the cards resource. Each method gets at least one
// happy-path round-trip + at least one sad-path mapping.

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import { ApiNetworkError, ApiNotFoundError, ApiResponseDecodeError } from '../error.js';
import { errEnvelope, mockFetch, mockFetchReject, okEnvelope } from '../test-helpers.js';
import {
  FIXTURE_IDS,
  VALID_CARD,
  VALID_CARD_WITH_PRINTINGS,
  VALID_PAGE,
  VALID_PRINTING,
  VALID_PRINTING_WITH_CONTEXT,
  VALID_SET,
} from './_fixtures.js';
import { makeCardsResource } from './cards.js';

function makeResource(fetch: ReturnType<typeof mockFetch>): {
  fetch: ReturnType<typeof mockFetch>;
  cards: ReturnType<typeof makeCardsResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => null,
    fetch,
  });
  return { fetch, cards: makeCardsResource(http) };
}

describe('cards.listSets', () => {
  it('returns a paginated list of sets on happy path', async () => {
    const { cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_SET])) }),
    );
    const page = await cards.listSets();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.code).toBe('swsh9');
    expect(page.nextCursor).toBeNull();
  });

  it('hits GET /v1/sets', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_SET])) }),
    );
    await cards.listSets();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/sets');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('forwards cursor + limit query params', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_SET])) }),
    );
    await cards.listSets({ cursor: 'cur1', limit: 10, language: 'en' });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('cursor=cur1');
    expect(url).toContain('limit=10');
    expect(url).toContain('language=en');
  });

  it('throws ApiResponseDecodeError when items shape is wrong', async () => {
    const { cards } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ items: [{ broken: true }], nextCursor: null }),
      }),
    );
    await expect(cards.listSets()).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });

  it('throws ApiNetworkError on fetch reject', async () => {
    const { cards } = makeResource(mockFetchReject(new Error('dns fail')));
    await expect(cards.listSets()).rejects.toBeInstanceOf(ApiNetworkError);
  });
});

describe('cards.getSet', () => {
  it('returns a SetDto on happy path', async () => {
    const { cards } = makeResource(mockFetch({ status: 200, body: okEnvelope(VALID_SET) }));
    const set = await cards.getSet({ id: FIXTURE_IDS.setId });
    expect(set.id).toBe(FIXTURE_IDS.setId);
    expect(set.code).toBe('swsh9');
  });

  it('hits GET /v1/sets/{id} with URL-encoded id', async () => {
    const { fetch, cards } = makeResource(mockFetch({ status: 200, body: okEnvelope(VALID_SET) }));
    await cards.getSet({ id: FIXTURE_IDS.setId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/sets/${FIXTURE_IDS.setId}`);
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { cards } = makeResource(
      mockFetch({ status: 404, body: errEnvelope({ code: 'NOT_FOUND', message: 'gone' }) }),
    );
    await expect(cards.getSet({ id: FIXTURE_IDS.setId })).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

describe('cards.getSetBySlug', () => {
  it('resolves a set by canonicalKey on the first page', async () => {
    const { cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_SET])) }),
    );
    const set = await cards.getSetBySlug({ slug: 'en-swsh9' });
    expect(set.id).toBe(FIXTURE_IDS.setId);
    expect(set.canonicalKey).toBe('en-swsh9');
  });

  it('hits GET /v1/sets to scan the catalog', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_SET])) }),
    );
    await cards.getSetBySlug({ slug: 'en-swsh9' });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/sets');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('walks pages via the cursor until it finds the slug', async () => {
    const target = {
      ...VALID_SET,
      id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
      canonicalKey: 'en-target',
    };
    const { fetch, cards } = makeResource(
      mockFetch(
        { status: 200, body: okEnvelope({ items: [VALID_SET], nextCursor: 'cur1' }) },
        { status: 200, body: okEnvelope({ items: [target], nextCursor: null }) },
      ),
    );
    const set = await cards.getSetBySlug({ slug: 'en-target' });
    expect(set.canonicalKey).toBe('en-target');
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondUrl = fetch.mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain('cursor=cur1');
  });

  it('throws ApiNotFoundError when no set matches the slug', async () => {
    const { cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope({ items: [VALID_SET], nextCursor: null }) }),
    );
    await expect(cards.getSetBySlug({ slug: 'en-nonexistent' })).rejects.toBeInstanceOf(
      ApiNotFoundError,
    );
  });
});

describe('cards.listCardsInSet', () => {
  it('returns a paginated list on happy path', async () => {
    const { cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_CARD])) }),
    );
    const page = await cards.listCardsInSet({ setId: FIXTURE_IDS.setId });
    expect(page.items[0]?.id).toBe(FIXTURE_IDS.cardId);
  });

  it('hits GET /v1/sets/{id}/cards', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_CARD])) }),
    );
    await cards.listCardsInSet({ setId: FIXTURE_IDS.setId, cursor: 'c', limit: 5 });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/sets/${FIXTURE_IDS.setId}/cards`);
    expect(url).toContain('cursor=c');
    expect(url).toContain('limit=5');
  });

  it('throws ApiNotFoundError when the parent set does not exist (404)', async () => {
    const { cards } = makeResource(mockFetch({ status: 404 }));
    await expect(cards.listCardsInSet({ setId: FIXTURE_IDS.setId })).rejects.toBeInstanceOf(
      ApiNotFoundError,
    );
  });
});

describe('cards.getCard', () => {
  it('returns a card with printings inlined', async () => {
    const { cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CARD_WITH_PRINTINGS) }),
    );
    const card = await cards.getCard({ id: FIXTURE_IDS.cardId });
    expect(card.id).toBe(FIXTURE_IDS.cardId);
    expect(card.printings).toHaveLength(1);
    expect(card.printings[0]?.variantClass).toBe('HOLO');
  });

  it('hits GET /v1/cards/{id}', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CARD_WITH_PRINTINGS) }),
    );
    await cards.getCard({ id: FIXTURE_IDS.cardId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/cards/${FIXTURE_IDS.cardId}`);
  });

  it('forwards an AbortSignal', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CARD_WITH_PRINTINGS) }),
    );
    const controller = new AbortController();
    await cards.getCard({ id: FIXTURE_IDS.cardId, signal: controller.signal });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe('cards.listPrintingsForCard', () => {
  it('returns the array of printings on happy path', async () => {
    const { cards } = makeResource(mockFetch({ status: 200, body: okEnvelope([VALID_PRINTING]) }));
    const printings = await cards.listPrintingsForCard({ cardId: FIXTURE_IDS.cardId });
    expect(printings).toHaveLength(1);
    expect(printings[0]?.variantKey).toBe('en-swsh9-018-holo');
  });

  it('hits GET /v1/cards/{cardId}/printings', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope([VALID_PRINTING]) }),
    );
    await cards.listPrintingsForCard({ cardId: FIXTURE_IDS.cardId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/cards/${FIXTURE_IDS.cardId}/printings`);
  });
});

describe('cards.getPrinting', () => {
  it('returns a printing with context on happy path', async () => {
    const { cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PRINTING_WITH_CONTEXT) }),
    );
    const printing = await cards.getPrinting({ id: FIXTURE_IDS.printingId });
    expect(printing.id).toBe(FIXTURE_IDS.printingId);
    expect(printing.card.id).toBe(FIXTURE_IDS.cardId);
    expect(printing.set.id).toBe(FIXTURE_IDS.setId);
  });

  it('hits GET /v1/printings/{id}', async () => {
    const { fetch, cards } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PRINTING_WITH_CONTEXT) }),
    );
    await cards.getPrinting({ id: FIXTURE_IDS.printingId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/printings/${FIXTURE_IDS.printingId}`);
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { cards } = makeResource(mockFetch({ status: 404 }));
    await expect(cards.getPrinting({ id: FIXTURE_IDS.printingId })).rejects.toBeInstanceOf(
      ApiNotFoundError,
    );
  });
});

describe('cards — anonymous reads', () => {
  it('does not require a JWT (anonymous getJwt returns null)', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope(VALID_SET) });
    const http = new HttpClient({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      getJwt: () => null,
      fetch,
    });
    const cards = makeCardsResource(http);
    await cards.getSet({ id: FIXTURE_IDS.setId });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBeUndefined();
    expect(init?.headers).toMatchObject({ apikey: 'anon' });
  });
});
