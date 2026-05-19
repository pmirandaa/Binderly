// Tests for the completion handler. The handler computes
// per-set + global completion from the canonical tables; we drive
// the fake supabase client with hand-crafted catalog rosters so the
// math is exercised end-to-end through the dispatcher.

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

// Tiny catalog fixture: 2 sets, 4 cards (2 per set), 5 printings.
// Set A: cards A1 / A2 → 3 printings (A1 master, A1 alt-art non-master, A2 master).
// Set B: cards B1 / B2 → 2 printings (B1 master, B2 master).
const CATALOG = {
  sets: [
    { id: 'set-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa', code: 'AAA', name: 'Alpha' },
    { id: 'set-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb', code: 'BBB', name: 'Beta' },
  ],
  cards: [
    { id: 'card-a1', set_id: 'set-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { id: 'card-a2', set_id: 'set-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { id: 'card-b1', set_id: 'set-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    { id: 'card-b2', set_id: 'set-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  ],
  printings: [
    { id: 'pr-a1-base', card_id: 'card-a1', include_in_master_set: true },
    { id: 'pr-a1-alt', card_id: 'card-a1', include_in_master_set: false },
    { id: 'pr-a2-base', card_id: 'card-a2', include_in_master_set: true },
    { id: 'pr-b1-base', card_id: 'card-b1', include_in_master_set: true },
    { id: 'pr-b2-base', card_id: 'card-b2', include_in_master_set: true },
  ],
};

function makeCompletionFake(opts: {
  readonly owned: readonly { readonly printing_id: string; readonly updated_at: string }[];
  readonly cards?: readonly { readonly id: string; readonly set_id: string }[];
  readonly printings?: readonly {
    readonly id: string;
    readonly card_id: string;
    readonly include_in_master_set: boolean;
  }[];
  readonly sets?: readonly { readonly id: string; readonly code: string; readonly name: string }[];
}) {
  return createFakeSupabase({
    tableResponses: {
      collection_item: [{ data: opts.owned, error: null }],
      card: [{ data: opts.cards ?? CATALOG.cards, error: null }],
      printing: [{ data: opts.printings ?? CATALOG.printings, error: null }],
      set: [{ data: opts.sets ?? CATALOG.sets, error: null }],
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

interface CompletionResponse {
  global: {
    allPokemonPct: number;
    masterPct: number;
    uniqueCardsOwned: number;
    uniqueCardsTotal: number;
    masterOwned: number;
    masterTotal: number;
  };
  perSet: ReadonlyArray<{
    setId: string;
    setCode: string;
    setName: string;
    setPct: number;
    masterPct: number;
    ownedNumbered: number;
    totalNumbered: number;
    ownedMaster: number;
    totalMaster: number;
  }>;
  lastUpdatedAt: string | null;
}

describe('GET /v1/me/collection/completion', () => {
  it('returns 200 and a fully-zero envelope for an empty collection', async () => {
    const fake = makeCompletionFake({ owned: [] });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.global.uniqueCardsOwned).toBe(0);
    expect(body.global.allPokemonPct).toBe(0);
    expect(body.perSet).toHaveLength(2);
    expect(body.perSet[0]?.setPct).toBe(0);
    expect(body.lastUpdatedAt).toBeNull();
  });

  it('returns 401 envelope for missing JWT', async () => {
    const fake = makeCompletionFake({ owned: [] });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({ url: 'http://localhost/v1/me/collection/completion', method: 'GET' }),
    );
    expect(response.status).toBe(401);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('AUTH');
  });

  it('returns 401 envelope when JWT validation fails at supabase', async () => {
    const fake = createFakeSupabase({
      authError: { code: 'bad_jwt', message: 'invalid', status: 401 },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('computes 100% set + master when every printing is owned', async () => {
    const fake = makeCompletionFake({
      owned: [
        { printing_id: 'pr-a1-base', updated_at: '2026-05-19T10:00:00.000Z' },
        { printing_id: 'pr-a1-alt', updated_at: '2026-05-19T10:00:00.000Z' },
        { printing_id: 'pr-a2-base', updated_at: '2026-05-19T10:00:00.000Z' },
        { printing_id: 'pr-b1-base', updated_at: '2026-05-19T10:00:00.000Z' },
        { printing_id: 'pr-b2-base', updated_at: '2026-05-19T10:00:00.000Z' },
      ],
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.global.allPokemonPct).toBe(100);
    expect(body.global.masterPct).toBe(100);
    expect(body.global.uniqueCardsOwned).toBe(4);
    expect(body.global.uniqueCardsTotal).toBe(4);
    expect(body.perSet.every((s) => s.setPct === 100)).toBe(true);
    expect(body.perSet.every((s) => s.masterPct === 100)).toBe(true);
  });

  it('computes partial set completion correctly', async () => {
    // Own A1 only — set A has 1/2 cards numbered (50%); 1/2 master (50%).
    const fake = makeCompletionFake({
      owned: [{ printing_id: 'pr-a1-base', updated_at: '2026-05-19T09:00:00.000Z' }],
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    const setA = body.perSet.find((s) => s.setCode === 'AAA');
    expect(setA?.setPct).toBe(50);
    expect(setA?.masterPct).toBe(50);
    expect(setA?.ownedNumbered).toBe(1);
    expect(setA?.totalNumbered).toBe(2);
    expect(setA?.ownedMaster).toBe(1);
    expect(setA?.totalMaster).toBe(2);
  });

  it('owning the alt-art printing alone still counts the card as numbered', async () => {
    // pr-a1-alt is NOT in master set but its card_id (a1) IS numbered.
    const fake = makeCompletionFake({
      owned: [{ printing_id: 'pr-a1-alt', updated_at: '2026-05-19T09:00:00.000Z' }],
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    const setA = body.perSet.find((s) => s.setCode === 'AAA');
    expect(setA?.ownedNumbered).toBe(1);
    expect(setA?.ownedMaster).toBe(0);
  });

  it('dedupes owned printings across multiple collection_item rows', async () => {
    // The same printing in different conditions / grades shows up as
    // multiple `collection_item` rows; the math should count it once.
    const fake = makeCompletionFake({
      owned: [
        { printing_id: 'pr-a1-base', updated_at: '2026-05-19T08:00:00.000Z' },
        { printing_id: 'pr-a1-base', updated_at: '2026-05-19T09:00:00.000Z' },
      ],
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.global.uniqueCardsOwned).toBe(1);
    expect(body.global.masterOwned).toBe(1);
  });

  it('sorts perSet entries by setName ascending', async () => {
    const fake = makeCompletionFake({ owned: [] });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.perSet.map((s) => s.setName)).toEqual(['Alpha', 'Beta']);
  });

  it('returns lastUpdatedAt as the max updated_at across collection_item rows', async () => {
    const fake = makeCompletionFake({
      owned: [
        { printing_id: 'pr-a1-base', updated_at: '2026-05-19T08:00:00.000Z' },
        { printing_id: 'pr-a2-base', updated_at: '2026-05-19T12:30:00.000Z' },
        { printing_id: 'pr-b1-base', updated_at: '2026-05-19T09:00:00.000Z' },
      ],
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.lastUpdatedAt).toBe('2026-05-19T12:30:00.000Z');
  });

  it('clamps NaN to 0 when a set has zero numbered cards', async () => {
    const fake = makeCompletionFake({
      owned: [],
      cards: [], // no cards anywhere
      printings: [],
      sets: [{ id: 'set-empty-eeeeeeeeeeeeeeee', code: 'EMP', name: 'Empty' }],
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.perSet[0]?.setPct).toBe(0);
    expect(body.perSet[0]?.masterPct).toBe(0);
    expect(body.global.allPokemonPct).toBe(0);
  });

  it('translates a PostgREST error into an INTERNAL envelope', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        collection_item: [
          {
            data: null,
            error: { code: 'XX000', message: 'upstream blew up' },
          },
        ],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(500);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('INTERNAL');
  });

  it('propagates x-request-id on the success response', async () => {
    const fake = makeCompletionFake({ owned: [] });
    const handler = makeHandlerWithFake(fake);
    const response = await handler(
      new Request('http://localhost/v1/me/collection/completion', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${makeFakeJwt()}`,
          'x-request-id': 'rid-completion-1',
        },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-completion-1');
  });
});
