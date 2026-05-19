// Tests for the smart-collections preview handler.

import { describe, expect, it } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import {
  buildRequest,
  createFakeSupabase,
  makeFakeJwt,
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

// Tiny catalog: two sets with two cards each, one printing per card.
const SET_BASE = {
  id: 'set-base-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  code: 'BASE',
  name: 'Base Set',
  series: 'Base',
  language: 'en',
  release_date: '1999-01-09',
  printed_total: 102,
  total: 102,
};

const SET_JUNGLE = {
  id: 'set-jungle-bbbbbbbbbbbbbbbbbbbbbbbb',
  code: 'JUNGLE',
  name: 'Jungle',
  series: 'Base',
  language: 'en',
  release_date: '1999-06-16',
  printed_total: 64,
  total: 64,
};

const CARD_PIKACHU = {
  id: 'card-pikachu-cccccccccccccccccccccccccc',
  set_id: SET_BASE.id,
  name: 'Pikachu',
  number: '058/102',
  illustrator: 'Mitsuhiro Arita',
  language: 'en',
  type: 'Lightning',
  subtype: 'BASIC',
  rarity: 'COMMON',
  hp: 60,
  retreat_cost: 1,
};
const CARD_CHARIZARD = {
  id: 'card-charizard-dddddddddddddddddddddd',
  set_id: SET_BASE.id,
  name: 'Charizard',
  number: '004/102',
  illustrator: 'Mitsuhiro Arita',
  language: 'en',
  type: 'Fire',
  subtype: 'STAGE_2',
  rarity: 'HOLO_RARE',
  hp: 120,
  retreat_cost: 3,
};
const CARD_FLAREON = {
  id: 'card-flareon-eeeeeeeeeeeeeeeeeeeeeeeeee',
  set_id: SET_JUNGLE.id,
  name: 'Flareon',
  number: '003/64',
  illustrator: 'Kagemaru Himeno',
  language: 'en',
  type: 'Fire',
  subtype: 'STAGE_1',
  rarity: 'HOLO_RARE',
  hp: 70,
  retreat_cost: 1,
};
const CARD_VAPOREON = {
  id: 'card-vaporeon-ffffffffffffffffffffffff',
  set_id: SET_JUNGLE.id,
  name: 'Vaporeon',
  number: '012/64',
  illustrator: 'Kagemaru Himeno',
  language: 'en',
  type: 'Water',
  subtype: 'STAGE_1',
  rarity: 'HOLO_RARE',
  hp: 80,
  retreat_cost: 2,
};

const PRINTING_PIKACHU = {
  id: 'pr-pik-1111111111111111111111111',
  card_id: CARD_PIKACHU.id,
  variant_class: 'BASE',
  variant_code: 'BASE',
  variant_flags: [],
  include_in_master_set: true,
  image_small_url: 'https://cdn.test/pik.png',
};
const PRINTING_CHARIZARD = {
  id: 'pr-cha-2222222222222222222222222',
  card_id: CARD_CHARIZARD.id,
  variant_class: 'BASE',
  variant_code: 'BASE',
  variant_flags: [],
  include_in_master_set: true,
  image_small_url: 'https://cdn.test/cha.png',
};
const PRINTING_FLAREON = {
  id: 'pr-fla-3333333333333333333333333',
  card_id: CARD_FLAREON.id,
  variant_class: 'BASE',
  variant_code: 'BASE',
  variant_flags: [],
  include_in_master_set: true,
  image_small_url: 'https://cdn.test/fla.png',
};
const PRINTING_VAPOREON = {
  id: 'pr-vap-4444444444444444444444444',
  card_id: CARD_VAPOREON.id,
  variant_class: 'BASE',
  variant_code: 'BASE',
  variant_flags: [],
  include_in_master_set: true,
  image_small_url: 'https://cdn.test/vap.png',
};

function makeCatalogFake() {
  return createFakeSupabase({
    tableResponses: {
      printing: [
        {
          data: [PRINTING_PIKACHU, PRINTING_CHARIZARD, PRINTING_FLAREON, PRINTING_VAPOREON],
          error: null,
        },
      ],
      card: [
        { data: [CARD_PIKACHU, CARD_CHARIZARD, CARD_FLAREON, CARD_VAPOREON], error: null },
      ],
      set: [{ data: [SET_BASE, SET_JUNGLE], error: null }],
    },
  });
}

function makeHandlerWithFake(fake: ReturnType<typeof createFakeSupabase>) {
  return makeHandler({
    getEnv: ENV_GETTER,
    routes: ROUTES,
    deps: { createClient: () => fake.client },
  });
}

interface PreviewResponse {
  items: ReadonlyArray<{
    printingId: string;
    cardId: string;
    setId: string;
    cardName: string;
    cardNumber: string;
    setName: string;
    setCode: string;
    variantLabel: string;
    imageSmallUrl: string | null;
  }>;
  totalCount: number;
  nextOffset: number | null;
}

describe('POST /v1/smart-collections/preview', () => {
  it('returns the typed response on happy path with a simple eq predicate', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(3);
    expect(body.items.map((i) => i.cardName).sort()).toEqual([
      'Charizard',
      'Flareon',
      'Vaporeon',
    ]);
  });

  it('returns 401 envelope for an anonymous caller', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        body: { expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' } },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a missing expression with a 400 envelope', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { limit: 50 },
      }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('rejects collection.* field references at the preview boundary', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'eq', field: 'collection.quantity', value: 1 },
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects an over-cap limit', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
          limit: 5000,
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('evaluates AND of two leaves correctly', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'and',
            children: [
              { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
              { type: 'eq', field: 'set.code', value: 'JUNGLE' },
            ],
          },
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(2);
    expect(body.items.map((i) => i.cardName).sort()).toEqual(['Flareon', 'Vaporeon']);
  });

  it('evaluates OR of two leaves correctly', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'or',
            children: [
              { type: 'eq', field: 'card.name', value: 'Pikachu' },
              { type: 'eq', field: 'card.name', value: 'Vaporeon' },
            ],
          },
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(2);
  });

  it('evaluates NOT correctly', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'not',
            child: { type: 'eq', field: 'card.rarity', value: 'COMMON' },
          },
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(3); // everything except Pikachu (COMMON)
  });

  it('evaluates IN correctly', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'in',
            field: 'card.type',
            values: ['Fire', 'Water'],
          },
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(3); // Charizard + Flareon + Vaporeon
  });

  it('evaluates RANGE on a numeric field correctly', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'range',
            field: 'card.hp',
            min: 70,
            max: 100,
          },
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    // Flareon (70) + Vaporeon (80) — Charizard (120) and Pikachu (60) excluded.
    expect(body.totalCount).toBe(2);
  });

  it('evaluates RANGE on a date field correctly', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'range',
            field: 'set.releaseDate',
            min: '1999-06-01',
          },
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    // Jungle set (1999-06-16) is after the min; Base (1999-01-09) is not.
    expect(body.totalCount).toBe(2);
    expect(body.items.every((i) => i.setCode === 'JUNGLE')).toBe(true);
  });

  it('evaluates EXISTS on a nullable field correctly', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'exists',
            field: 'card.illustrator',
            exists: true,
          },
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(4);
  });

  it('paginates with limit + offset and returns nextOffset', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'exists', field: 'card.illustrator', exists: true },
          limit: 2,
          offset: 0,
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.items).toHaveLength(2);
    expect(body.totalCount).toBe(4);
    expect(body.nextOffset).toBe(2);
  });

  it('returns nextOffset = null on the last page', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'exists', field: 'card.illustrator', exists: true },
          limit: 2,
          offset: 2,
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.items).toHaveLength(2);
    expect(body.nextOffset).toBeNull();
  });

  it('sorts results by set release_date desc then card number asc', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'exists', field: 'card.illustrator', exists: true } },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    // Jungle (1999-06-16) cards first, sorted by number ('003/64' < '012/64'),
    // then Base Set (1999-01-09), sorted by number ('004/102' < '058/102').
    expect(body.items.map((i) => i.cardName)).toEqual([
      'Flareon',
      'Vaporeon',
      'Charizard',
      'Pikachu',
    ]);
  });

  it('rejects malformed leaf nodes (unknown type)', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'NEVER', field: 'card.name', value: 'Pikachu' } },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('propagates x-request-id on the success response', async () => {
    const fake = makeCatalogFake();
    const response = await makeHandlerWithFake(fake)(
      new Request('http://localhost/v1/smart-collections/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${makeFakeJwt()}`,
          'x-request-id': 'rid-smart-1',
        },
        body: JSON.stringify({
          expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
        }),
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-smart-1');
  });
});
