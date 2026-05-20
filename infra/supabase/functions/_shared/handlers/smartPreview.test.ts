// Tests for `POST /v1/smart-collections/preview` (T-BE-Q013-CLEANUP /
// Surface 2 / #FU-27). The handler now delegates AST evaluation to
// the `smart_collection_preview` Postgres RPC, so the tests drive
// the fake `.rpc()` shim and assert on (a) the contract widening
// (`collection.*` is accepted now), (b) the RPC argument shape,
// (c) the wire response mapping, and (d) error-envelope mapping
// from `translatePostgrestError`.

import { describe, expect, it } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import {
  buildRequest,
  createFakeSupabase,
  FIXTURE_USER_ID,
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

// RPC row helpers. The RPC returns one row per matching printing
// + a window `total_count` (every row carries the same value).

interface RpcRowOpts {
  readonly id: string;
  readonly cardId: string;
  readonly setId: string;
  readonly cardName: string;
  readonly cardNumber: string;
  readonly setName: string;
  readonly setCode: string;
  readonly variantClass?: string;
  readonly variantFlags?: readonly string[];
  readonly imageSmallUrl?: string | null;
  readonly totalCount: number;
}

function makeRpcRow(opts: RpcRowOpts): Record<string, unknown> {
  return {
    printing_id: opts.id,
    card_id: opts.cardId,
    set_id: opts.setId,
    card_name: opts.cardName,
    card_number: opts.cardNumber,
    set_name: opts.setName,
    set_code: opts.setCode,
    variant_class: opts.variantClass ?? 'BASE',
    variant_flags: opts.variantFlags ?? [],
    image_small_url: opts.imageSmallUrl ?? null,
    total_count: opts.totalCount,
  };
}

const ROW_PIKACHU = makeRpcRow({
  id: 'pr-pik-1111111111111111111111111',
  cardId: 'card-pikachu-cccccccccccccccccccccccccc',
  setId: 'set-base-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  cardName: 'Pikachu',
  cardNumber: '058/102',
  setName: 'Base Set',
  setCode: 'BASE',
  imageSmallUrl: 'https://cdn.test/pik.png',
  totalCount: 2,
});
const ROW_CHARIZARD = makeRpcRow({
  id: 'pr-cha-2222222222222222222222222',
  cardId: 'card-charizard-dddddddddddddddddddddd',
  setId: 'set-base-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  cardName: 'Charizard',
  cardNumber: '004/102',
  setName: 'Base Set',
  setCode: 'BASE',
  imageSmallUrl: 'https://cdn.test/cha.png',
  totalCount: 2,
});

function makePreviewFake(rows: readonly Record<string, unknown>[]) {
  return createFakeSupabase({
    tableResponses: {
      'rpc:smart_collection_preview': [{ data: rows, error: null }],
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

function rpcCalls(fake: ReturnType<typeof createFakeSupabase>) {
  return fake.calls.filter(
    (c) => c.method === 'rpc' && c.table === 'smart_collection_preview',
  );
}

describe('POST /v1/smart-collections/preview — RPC integration (T-BE-Q013-CLEANUP)', () => {
  it('returns the typed response on happy path with a simple eq predicate', async () => {
    const fake = makePreviewFake([ROW_CHARIZARD, ROW_PIKACHU]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' } },
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(2);
    expect(body.items.map((i) => i.cardName)).toEqual(['Charizard', 'Pikachu']);
    expect(body.nextOffset).toBeNull();
  });

  it('passes ast, p_user_id, p_limit, p_offset to the RPC', async () => {
    const fake = makePreviewFake([]);
    const expression = { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' };
    await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression, limit: 25, offset: 50 },
      }),
    );
    const calls = rpcCalls(fake);
    expect(calls).toHaveLength(1);
    const args = calls[0]!.args[0] as Record<string, unknown>;
    expect(args.ast).toEqual(expression);
    expect(args.p_user_id).toBe(FIXTURE_USER_ID);
    expect(args.p_limit).toBe(25);
    expect(args.p_offset).toBe(50);
  });

  it('defaults limit to 200 and offset to 0 when the body omits them', async () => {
    const fake = makePreviewFake([]);
    await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'exists', field: 'card.illustrator', exists: true } },
      }),
    );
    const args = rpcCalls(fake)[0]!.args[0] as Record<string, unknown>;
    expect(args.p_limit).toBe(200);
    expect(args.p_offset).toBe(0);
  });

  it('clamps an over-default-but-under-cap limit to MAX_LIMIT (500)', async () => {
    // The schema allows up to 500; the handler additionally clamps
    // — defence in depth even though the schema already does.
    const fake = makePreviewFake([]);
    await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
          limit: 500,
        },
      }),
    );
    const args = rpcCalls(fake)[0]!.args[0] as Record<string, unknown>;
    expect(args.p_limit).toBe(500);
  });

  it('maps RPC row columns onto the wire `smartPreviewItemDto` shape', async () => {
    const fake = makePreviewFake([ROW_CHARIZARD]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.name', value: 'Charizard' } },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.items[0]).toEqual({
      printingId: 'pr-cha-2222222222222222222222222',
      cardId: 'card-charizard-dddddddddddddddddddddd',
      setId: 'set-base-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      cardName: 'Charizard',
      cardNumber: '004/102',
      setName: 'Base Set',
      setCode: 'BASE',
      variantLabel: '',
      imageSmallUrl: 'https://cdn.test/cha.png',
    });
  });

  it('computes variantLabel for non-BASE variants', async () => {
    const fake = makePreviewFake([
      makeRpcRow({
        id: 'pr-cha-holo-3333333333333333333333',
        cardId: 'card-charizard-dddddddddddddddddddddd',
        setId: 'set-base-aaaaaaaaaaaaaaaaaaaaaaaaaa',
        cardName: 'Charizard',
        cardNumber: '004/102',
        setName: 'Base Set',
        setCode: 'BASE',
        variantClass: 'PARALLEL',
        variantFlags: ['FIRST_EDITION', 'SHADOWLESS'],
        totalCount: 1,
      }),
    ]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.name', value: 'Charizard' } },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.items[0]!.variantLabel).toBe('PARALLEL (FIRST_EDITION, SHADOWLESS)');
  });

  it('reads totalCount off the first row (window aggregate semantics)', async () => {
    const fake = makePreviewFake([
      { ...ROW_CHARIZARD, total_count: 42 },
      { ...ROW_PIKACHU, total_count: 42 },
    ]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' } },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(42);
  });

  it('coerces a string-shaped total_count (bigint may arrive as string over PostgREST)', async () => {
    const fake = makePreviewFake([{ ...ROW_CHARIZARD, total_count: '17' }]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.name', value: 'Charizard' } },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(17);
  });

  it('returns totalCount=0 and nextOffset=null when the result set is empty', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.name', value: 'Nonexistent' } },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(0);
    expect(body.items).toEqual([]);
    expect(body.nextOffset).toBeNull();
  });

  it('computes nextOffset when more rows exist past the current page', async () => {
    // 2 rows returned out of 10 total; offset=0; nextOffset = 2.
    const fake = makePreviewFake([
      { ...ROW_CHARIZARD, total_count: 10 },
      { ...ROW_PIKACHU, total_count: 10 },
    ]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
          limit: 2,
          offset: 0,
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(10);
    expect(body.nextOffset).toBe(2);
  });

  it('returns nextOffset=null on the last page (offset + items.length == totalCount)', async () => {
    const fake = makePreviewFake([{ ...ROW_PIKACHU, total_count: 5 }]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
          limit: 2,
          offset: 4,
        },
      }),
    );
    const body = await readSuccessBody<PreviewResponse>(response);
    expect(body.totalCount).toBe(5);
    expect(body.nextOffset).toBeNull();
  });

  it('returns 401 envelope for an anonymous caller and does NOT hit the RPC', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        body: { expression: { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' } },
      }),
    );
    expect(response.status).toBe(401);
    expect(rpcCalls(fake)).toHaveLength(0);
  });

  it('rejects a missing expression with a 400 envelope before hitting the RPC', async () => {
    const fake = makePreviewFake([]);
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
    expect(rpcCalls(fake)).toHaveLength(0);
  });

  it('rejects an over-cap limit before hitting the RPC', async () => {
    const fake = makePreviewFake([]);
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
    expect(rpcCalls(fake)).toHaveLength(0);
  });

  it('rejects malformed leaf nodes (unknown type) at the schema boundary', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'NEVER', field: 'card.name', value: 'Pikachu' } },
      }),
    );
    expect(response.status).toBe(400);
    expect(rpcCalls(fake)).toHaveLength(0);
  });

  it('rejects a range with neither min nor max via the schema superRefine', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'range', field: 'card.hp' } },
      }),
    );
    expect(response.status).toBe(400);
    expect(rpcCalls(fake)).toHaveLength(0);
  });

  it('propagates x-request-id on the success response', async () => {
    const fake = makePreviewFake([ROW_CHARIZARD]);
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

describe('POST /v1/smart-collections/preview — collection.* contract widening (T-BE-Q013-CLEANUP)', () => {
  // Iter 21's mirror schema rejected `collection.*` fields outright
  // (the in-JS evaluator didn't load `collection_item` rows). The
  // RPC LEFT JOINs `collection_item` filtered by `p_user_id`, so
  // `collection.*` predicates resolve server-side — the schema is
  // widened to ACCEPT them now. This block is the positive
  // coverage for that widening.

  it('accepts collection.isOwned (synthetic boolean) and forwards it to the RPC', async () => {
    const fake = makePreviewFake([{ ...ROW_PIKACHU, total_count: 1 }]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'collection.isOwned', value: true } },
      }),
    );
    expect(response.status).toBe(200);
    const args = rpcCalls(fake)[0]!.args[0] as Record<string, unknown>;
    expect(args.ast).toEqual({
      type: 'eq',
      field: 'collection.isOwned',
      value: true,
    });
  });

  it('accepts collection.condition enum', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'collection.condition', value: 'NEAR_MINT' } },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('accepts collection.gradeCompany enum', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'in', field: 'collection.gradeCompany', values: ['PSA', 'BGS'] },
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('accepts collection.grade range', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: { type: 'range', field: 'collection.grade', min: 9, max: 10 },
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('accepts collection.quantity range', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'range', field: 'collection.quantity', min: 2 } },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('accepts collection.acquiredAt date range', async () => {
    const fake = makePreviewFake([]);
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: {
          expression: {
            type: 'range',
            field: 'collection.acquiredAt',
            min: '2024-01-01',
            max: '2024-12-31',
          },
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('accepts mixed catalog + collection predicates in a single expression', async () => {
    const fake = makePreviewFake([]);
    const expression = {
      type: 'and',
      children: [
        { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
        { type: 'eq', field: 'collection.isOwned', value: true },
        { type: 'range', field: 'collection.grade', min: 9 },
      ],
    };
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression },
      }),
    );
    expect(response.status).toBe(200);
    const args = rpcCalls(fake)[0]!.args[0] as Record<string, unknown>;
    expect(args.ast).toEqual(expression);
  });
});

describe('POST /v1/smart-collections/preview — RPC error mapping (T-BE-Q013-CLEANUP)', () => {
  it('maps RPC P0001 (raise_exception) to a VALIDATION envelope', async () => {
    // The PL/pgSQL compiler raises `P0001` on unknown fields /
    // malformed nodes (defence in depth — the mirror schema
    // already catches these). Verify the envelope translation.
    const fake = createFakeSupabase({
      tableResponses: {
        'rpc:smart_collection_preview': [
          {
            data: null,
            error: { code: 'P0001', message: '_smart_compile: unknown field "card.bogusField"' },
          },
        ],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.name', value: 'x' } },
      }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('maps RPC 42501 (insufficient_privilege) to a 403 AUTH envelope', async () => {
    // The RPC raises 42501 when `auth.uid() != p_user_id` or
    // when `p_user_id` is null. The Edge handler always passes
    // `session.user.id`, so this is defensive — but the envelope
    // mapping is still part of the contract.
    const fake = createFakeSupabase({
      tableResponses: {
        'rpc:smart_collection_preview': [
          {
            data: null,
            error: {
              code: '42501',
              message: 'smart_collection_preview: p_user_id must equal auth.uid()',
            },
          },
        ],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.name', value: 'x' } },
      }),
    );
    expect(response.status).toBe(403);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('AUTH');
  });

  it('maps an unknown RPC error code to an INTERNAL envelope', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        'rpc:smart_collection_preview': [
          {
            data: null,
            error: { code: 'XX000', message: 'something exploded in the planner' },
          },
        ],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/smart-collections/preview',
        method: 'POST',
        token: makeFakeJwt(),
        body: { expression: { type: 'eq', field: 'card.name', value: 'x' } },
      }),
    );
    expect(response.status).toBe(500);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('INTERNAL');
  });
});
