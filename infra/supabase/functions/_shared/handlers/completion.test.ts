// Tests for the completion handler.
//
// As of T-BE-Q013-CLEANUP the handler reads from the user-scoped
// wrapper views (`v_my_set_completion` / `v_my_global_completion`)
// rather than computing from canonical tables. The fake supabase
// client returns whatever rows the test enqueues per view; the
// handler merges them with the catalog set list to produce the
// `completionDto` envelope.
//
// Drift-control note: the iter-21 tests proved the wire shape
// against an on-the-fly computation. This rewrite preserves the
// same envelope assertions (shape, sort order, zero-fallbacks) so
// any client coupled to the previous handler continues to work.

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

// Tiny set catalog the handler will UNION with the MV per-set rows
// so perSet entries exist for sets the user has no progress in.
const SET_ALPHA = {
  id: 'set-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  code: 'AAA',
  name: 'Alpha',
};
const SET_BETA = {
  id: 'set-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  code: 'BBB',
  name: 'Beta',
};

interface MvSetRow {
  user_id: string;
  set_id: string;
  set_code: string;
  set_name: string;
  owned_unique: number;
  total_unique: number;
  owned_master: number;
  total_master: number;
  set_pct: string;
  master_pct: string;
}

interface MvGlobalRow {
  user_id: string;
  unique_cards_owned: number;
  total_cards: number;
  master_owned: number;
  master_total: number;
  all_pokemon_pct: string;
  master_pct: string;
}

function makeCompletionFake(opts: {
  readonly setRows?: readonly Partial<MvSetRow>[];
  readonly globalRow?: Partial<MvGlobalRow> | null;
  readonly catalogSets?: readonly { id: string; code: string; name: string }[];
}) {
  const setRows = opts.setRows ?? [];
  const globalRow = opts.globalRow === undefined ? null : opts.globalRow;
  const catalogSets = opts.catalogSets ?? [SET_ALPHA, SET_BETA];
  return createFakeSupabase({
    tableResponses: {
      v_my_set_completion: [{ data: setRows, error: null }],
      v_my_global_completion: [
        { data: globalRow === null ? [] : [globalRow], error: null },
      ],
      set: [{ data: catalogSets, error: null }],
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
  it('returns 200 and an all-zero envelope when the MVs have no rows for the caller', async () => {
    const fake = makeCompletionFake({ setRows: [], globalRow: null });
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
    expect(body.perSet[0]?.totalNumbered).toBe(0);
    expect(body.lastUpdatedAt).toBeNull();
  });

  it('returns 401 envelope for missing JWT', async () => {
    const fake = makeCompletionFake({});
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

  it('returns 100% set + master when every MV row is fully populated', async () => {
    const fake = makeCompletionFake({
      setRows: [
        {
          user_id: 'u1',
          set_id: SET_ALPHA.id,
          set_code: SET_ALPHA.code,
          set_name: SET_ALPHA.name,
          owned_unique: 2,
          total_unique: 2,
          owned_master: 2,
          total_master: 2,
          set_pct: '100.0',
          master_pct: '100.0',
        },
        {
          user_id: 'u1',
          set_id: SET_BETA.id,
          set_code: SET_BETA.code,
          set_name: SET_BETA.name,
          owned_unique: 2,
          total_unique: 2,
          owned_master: 2,
          total_master: 2,
          set_pct: '100.0',
          master_pct: '100.0',
        },
      ],
      globalRow: {
        user_id: 'u1',
        unique_cards_owned: 4,
        total_cards: 4,
        master_owned: 4,
        master_total: 4,
        all_pokemon_pct: '100.0',
        master_pct: '100.0',
      },
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

  it('renders partial set completion from the MV row', async () => {
    const fake = makeCompletionFake({
      setRows: [
        {
          user_id: 'u1',
          set_id: SET_ALPHA.id,
          set_code: SET_ALPHA.code,
          set_name: SET_ALPHA.name,
          owned_unique: 1,
          total_unique: 2,
          owned_master: 1,
          total_master: 2,
          set_pct: '50.0',
          master_pct: '50.0',
        },
      ],
      globalRow: {
        user_id: 'u1',
        unique_cards_owned: 1,
        total_cards: 4,
        master_owned: 1,
        master_total: 4,
        all_pokemon_pct: '25.0',
        master_pct: '25.0',
      },
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
    const setB = body.perSet.find((s) => s.setCode === 'BBB');
    expect(setB?.setPct).toBe(0);
    expect(setB?.ownedNumbered).toBe(0);
  });

  it('coerces numeric-string percentages (PostgREST `numeric` wire form) into numbers', async () => {
    const fake = makeCompletionFake({
      setRows: [
        {
          user_id: 'u1',
          set_id: SET_ALPHA.id,
          set_code: SET_ALPHA.code,
          set_name: SET_ALPHA.name,
          owned_unique: 1,
          total_unique: 3,
          owned_master: 1,
          total_master: 3,
          // PostgREST returns Postgres `numeric` as a string. The
          // handler must coerce.
          set_pct: '33.3333',
          master_pct: '33.3333',
        },
      ],
      globalRow: {
        user_id: 'u1',
        unique_cards_owned: 1,
        total_cards: 6,
        master_owned: 1,
        master_total: 6,
        all_pokemon_pct: '16.6667',
        master_pct: '16.6667',
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(typeof body.perSet[0]?.setPct).toBe('number');
    expect(body.perSet.find((s) => s.setCode === 'AAA')?.setPct).toBeCloseTo(33.3333);
    expect(body.global.allPokemonPct).toBeCloseTo(16.6667);
  });

  it('sorts perSet entries by setName ascending', async () => {
    const fake = makeCompletionFake({ setRows: [], globalRow: null });
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

  it('emits perSet entries for catalog sets the user has zero progress in', async () => {
    // Only Alpha has a per-set MV row; Beta should still appear in
    // perSet with zero counts (matches the iter-21 wire shape).
    const fake = makeCompletionFake({
      setRows: [
        {
          user_id: 'u1',
          set_id: SET_ALPHA.id,
          set_code: SET_ALPHA.code,
          set_name: SET_ALPHA.name,
          owned_unique: 2,
          total_unique: 2,
          owned_master: 2,
          total_master: 2,
          set_pct: '100.0',
          master_pct: '100.0',
        },
      ],
      globalRow: {
        user_id: 'u1',
        unique_cards_owned: 2,
        total_cards: 4,
        master_owned: 2,
        master_total: 4,
        all_pokemon_pct: '50.0',
        master_pct: '50.0',
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.perSet).toHaveLength(2);
    expect(body.perSet.find((s) => s.setCode === 'AAA')?.ownedNumbered).toBe(2);
    expect(body.perSet.find((s) => s.setCode === 'BBB')?.ownedNumbered).toBe(0);
    expect(body.perSet.find((s) => s.setCode === 'BBB')?.totalNumbered).toBe(0);
  });

  it('returns lastUpdatedAt as null (MV does not carry the column yet)', async () => {
    const fake = makeCompletionFake({
      setRows: [],
      globalRow: {
        user_id: 'u1',
        unique_cards_owned: 1,
        total_cards: 4,
        master_owned: 1,
        master_total: 4,
        all_pokemon_pct: '25.0',
        master_pct: '25.0',
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CompletionResponse>(response);
    expect(body.lastUpdatedAt).toBeNull();
  });

  it('clamps an unexpected non-numeric `set_pct` value to 0', async () => {
    const fake = makeCompletionFake({
      setRows: [
        {
          user_id: 'u1',
          set_id: SET_ALPHA.id,
          set_code: SET_ALPHA.code,
          set_name: SET_ALPHA.name,
          owned_unique: 0,
          total_unique: 0,
          owned_master: 0,
          total_master: 0,
          set_pct: 'NaN',
          master_pct: 'NaN',
        },
      ],
      globalRow: null,
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
    expect(setA?.setPct).toBe(0);
    expect(setA?.masterPct).toBe(0);
  });

  it('translates a PostgREST error into an INTERNAL envelope', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        v_my_set_completion: [
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

  it('does NOT pass an explicit user_id filter (wrapper view qual already filters by auth.uid())', async () => {
    const fake = makeCompletionFake({ setRows: [], globalRow: null });
    const handler = makeHandlerWithFake(fake);
    await handler(
      buildRequest({
        url: 'http://localhost/v1/me/collection/completion',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    // The view's WHERE clause does the gating; an explicit
    // `.eq('user_id', ...)` here would be redundant and would
    // shadow the qual.
    const setEqCall = fake.calls.find(
      (c) =>
        c.method === 'eq' &&
        c.table === 'v_my_set_completion' &&
        (c.args[0] as string) === 'user_id',
    );
    expect(setEqCall).toBeUndefined();
  });

  it('propagates x-request-id on the success response', async () => {
    const fake = makeCompletionFake({ setRows: [], globalRow: null });
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
