// Tests for the public shareable handler.
//
// The handler is anonymous (no JWT) and uses the service-role
// client. Its response shape branches on the `Accept` header:
// the default request returns the bare `shareableDto` envelope;
// `application/vnd.binderly.share+json` returns the richer
// `publicShareableDto` payload the SSR page reads.

import { describe, expect, it } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import { createFakeSupabase, readErrorBody, readSuccessBody } from '../test-helpers.ts';

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

const HANDLE = 'pablo';
const SLUG = 'my-binder';
const OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const PRINTING_ID_1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PRINTING_ID_2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CARD_ID_1 = 'cccccccc-3333-4333-8333-cccccccccccc';
const CARD_ID_2 = 'dddddddd-4444-4444-8444-dddddddddddd';
const SET_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const SHAREABLE_ID = 'ffffffff-6666-4666-8666-ffffffffffff';
const CUSTOM_COLLECTION_ID = '88888888-7777-4777-8777-888888888888';

function profileRow(): Record<string, unknown> {
  return {
    user_id: OWNER_USER_ID,
    handle: HANDLE,
    display_name: 'Pablo',
    avatar_url: 'https://cdn.test/avatar.png',
    bio: null,
  };
}

function shareableRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SHAREABLE_ID,
    user_id: OWNER_USER_ID,
    slug: SLUG,
    target: { kind: 'full' },
    theme: 'default',
    show_values: false,
    show_missing: true,
    show_photos: false,
    created_at: '2026-05-19T10:00:00.000Z',
    updated_at: '2026-05-19T10:00:00.000Z',
    ...overrides,
  };
}

function collectionItemRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    user_id: OWNER_USER_ID,
    printing_id: PRINTING_ID_1,
    quantity: 1,
    updated_at: '2026-05-19T09:00:00.000Z',
    ...overrides,
  };
}

function printingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRINTING_ID_1,
    card_id: CARD_ID_1,
    variant_class: 'BASE',
    variant_code: 'BASE',
    variant_flags: [],
    image_small_url: 'https://cdn.test/img1.png',
    include_in_master_set: true,
    ...overrides,
  };
}

function cardRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CARD_ID_1,
    set_id: SET_ID,
    name: 'Pikachu',
    number: '025/100',
    ...overrides,
  };
}

function setRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SET_ID,
    code: 'BASE',
    name: 'Base Set',
    ...overrides,
  };
}

function makeFullShareFake(opts: {
  readonly profile?: Record<string, unknown> | null;
  readonly shareable?: Record<string, unknown> | null;
  readonly collectionItems?: ReadonlyArray<Record<string, unknown>>;
  readonly printings?: ReadonlyArray<Record<string, unknown>>;
  readonly cards?: ReadonlyArray<Record<string, unknown>>;
  readonly sets?: ReadonlyArray<Record<string, unknown>>;
  /** count() catalog master total — number of master-set printings */
  readonly catalogMasterTotal?: ReadonlyArray<Record<string, unknown>>;
} = {}) {
  const items = opts.collectionItems ?? [collectionItemRow()];
  const printings = opts.printings ?? [printingRow()];
  const cards = opts.cards ?? [cardRow()];
  const sets = opts.sets ?? [setRow()];
  const catalogTotal = opts.catalogMasterTotal ?? [{ id: '1' }, { id: '2' }];
  return createFakeSupabase({
    tableResponses: {
      profile: [
        opts.profile === null
          ? { data: null, error: null }
          : { data: opts.profile ?? profileRow(), error: null },
      ],
      shareable: [
        opts.shareable === null
          ? { data: null, error: null }
          : { data: opts.shareable ?? shareableRow(), error: null },
      ],
      collection_item: [{ data: items, error: null }],
      printing: [
        { data: printings, error: null },
        // catalog master total (the count query)
        { data: catalogTotal, error: null },
      ],
      card: [{ data: cards, error: null }],
      set: [{ data: sets, error: null }],
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

interface ShareableWire {
  id: string;
  userId: string;
  slug: string;
  target: { kind: string };
}

interface PublicShareableWire {
  shareable: ShareableWire;
  owner: {
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
  };
  collectionTitle: string;
  description: string | null;
  counts: {
    ownedUnique: number;
    ownedTotalQuantity: number;
    catalogTotal: number;
    completionPct: number;
  };
  members: ReadonlyArray<{
    printingId: string;
    cardId: string;
    cardName: string;
    quantity: number;
  }>;
  lastUpdatedAt: string;
}

describe('GET /v1/c/:handle/:slug (default Accept)', () => {
  it('returns the bare shareableDto envelope on happy path', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: profileRow(), error: null }],
        shareable: [{ data: shareableRow(), error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<ShareableWire>(response);
    expect(body.id).toBe(SHAREABLE_ID);
    expect(body.slug).toBe(SLUG);
    expect(body.target.kind).toBe('full');
  });

  it('does NOT call auth.getUser — anonymous endpoint', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: profileRow(), error: null }],
        shareable: [{ data: shareableRow(), error: null }],
      },
    });
    await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, { method: 'GET' }),
    );
    expect(fake.calls.some((c) => c.method === 'auth.getUser')).toBe(false);
  });

  it('returns 404 when the handle is unknown', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: null, error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/ghost/${SLUG}`, { method: 'GET' }),
    );
    expect(response.status).toBe(404);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 when the slug is unknown', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: profileRow(), error: null }],
        shareable: [{ data: null, error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/gone`, { method: 'GET' }),
    );
    expect(response.status).toBe(404);
  });

  it('honors x-request-id propagation', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: profileRow(), error: null }],
        shareable: [{ data: shareableRow(), error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { 'x-request-id': 'rid-share-1' },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-share-1');
  });
});

describe('GET /v1/c/:handle/:slug (rich Accept header)', () => {
  const RICH_ACCEPT = 'application/vnd.binderly.share+json';

  it('returns the richer publicShareableDto when Accept opts in', async () => {
    const fake = makeFullShareFake({
      collectionItems: [
        collectionItemRow({ printing_id: PRINTING_ID_1, quantity: 1 }),
        collectionItemRow({ id: 'item-2', printing_id: PRINTING_ID_2, quantity: 2 }),
      ],
      printings: [
        printingRow({ id: PRINTING_ID_1, card_id: CARD_ID_1 }),
        printingRow({ id: PRINTING_ID_2, card_id: CARD_ID_2 }),
      ],
      cards: [
        cardRow({ id: CARD_ID_1, name: 'Pikachu' }),
        cardRow({ id: CARD_ID_2, name: 'Bulbasaur', number: '001/100' }),
      ],
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.owner.handle).toBe(HANDLE);
    expect(body.owner.displayName).toBe('Pablo');
    expect(body.members).toHaveLength(2);
    expect(body.collectionTitle).toBe("Pablo's collection");
    expect(body.counts.ownedUnique).toBe(2);
    expect(body.counts.ownedTotalQuantity).toBe(3);
  });

  it('computes completionPct = ownedUnique / catalogTotal * 100', async () => {
    const fake = makeFullShareFake({
      collectionItems: [collectionItemRow({ quantity: 1 })], // 1 unique
      printings: [printingRow()],
      cards: [cardRow()],
      sets: [setRow()],
      catalogMasterTotal: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }], // 4 master
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.counts.catalogTotal).toBe(4);
    expect(body.counts.completionPct).toBe(25);
  });

  it('returns completionPct = 0 when catalogTotal is 0 (no NaN)', async () => {
    const fake = makeFullShareFake({
      collectionItems: [],
      printings: [],
      cards: [],
      sets: [],
      catalogMasterTotal: [],
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.counts.completionPct).toBe(0);
  });

  it('returns an empty members array when the owner owns nothing', async () => {
    const fake = makeFullShareFake({
      collectionItems: [],
      printings: [],
      cards: [],
      sets: [],
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.members).toHaveLength(0);
    expect(body.counts.ownedUnique).toBe(0);
  });

  it('sums duplicate printing quantities across condition/grade rows', async () => {
    const fake = makeFullShareFake({
      collectionItems: [
        collectionItemRow({ id: 'a', printing_id: PRINTING_ID_1, quantity: 2 }),
        collectionItemRow({ id: 'b', printing_id: PRINTING_ID_1, quantity: 3 }),
      ],
      printings: [printingRow()],
      cards: [cardRow()],
      sets: [setRow()],
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.quantity).toBe(5);
    expect(body.counts.ownedUnique).toBe(1);
    expect(body.counts.ownedTotalQuantity).toBe(5);
  });

  it('uses handle as the title fallback when display_name is null', async () => {
    const fake = makeFullShareFake({
      profile: { ...profileRow(), display_name: null },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.collectionTitle).toBe(`${HANDLE}'s collection`);
  });

  it('returns lastUpdatedAt = max(collection_item.updated_at, shareable.updated_at)', async () => {
    const fake = makeFullShareFake({
      shareable: shareableRow({ updated_at: '2026-05-01T00:00:00.000Z' }),
      collectionItems: [collectionItemRow({ updated_at: '2026-05-15T12:00:00.000Z' })],
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.lastUpdatedAt).toBe('2026-05-15T12:00:00.000Z');
  });

  it('returns 404 when the handle is unknown (rich)', async () => {
    const fake = createFakeSupabase({
      tableResponses: { profile: [{ data: null, error: null }] },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/ghost/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('translates a PostgREST error into an INTERNAL envelope', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: null, error: { code: 'XX000', message: 'db went down' } }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    expect(response.status).toBe(500);
  });
});

describe('GET /v1/c/:handle/:slug — custom_collection target', () => {
  const RICH_ACCEPT = 'application/vnd.binderly.share+json';

  it('reads custom_collection_item membership for the member roster', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: profileRow(), error: null }],
        shareable: [
          {
            data: shareableRow({
              target: { kind: 'custom', custom_collection_id: CUSTOM_COLLECTION_ID },
            }),
            error: null,
          },
        ],
        custom_collection: [
          {
            data: {
              id: CUSTOM_COLLECTION_ID,
              user_id: OWNER_USER_ID,
              name: 'Gym Leaders',
              description: 'My favorites',
            },
            error: null,
          },
        ],
        custom_collection_item: [
          {
            data: [
              {
                custom_collection_id: CUSTOM_COLLECTION_ID,
                printing_id: PRINTING_ID_1,
                added_at: '2026-05-01T00:00:00.000Z',
              },
              {
                custom_collection_id: CUSTOM_COLLECTION_ID,
                printing_id: PRINTING_ID_2,
                added_at: '2026-05-02T00:00:00.000Z',
              },
            ],
            error: null,
          },
        ],
        collection_item: [
          {
            data: [collectionItemRow({ printing_id: PRINTING_ID_1, quantity: 2 })],
            error: null,
          },
        ],
        printing: [
          {
            data: [
              printingRow({ id: PRINTING_ID_1, card_id: CARD_ID_1 }),
              printingRow({ id: PRINTING_ID_2, card_id: CARD_ID_2 }),
            ],
            error: null,
          },
        ],
        card: [
          {
            data: [
              cardRow({ id: CARD_ID_1, name: 'Brock Pikachu' }),
              cardRow({ id: CARD_ID_2, name: 'Misty Bulbasaur', number: '001/100' }),
            ],
            error: null,
          },
        ],
        set: [{ data: [setRow()], error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<PublicShareableWire>(response);
    expect(body.collectionTitle).toBe("Pablo's Gym Leaders");
    expect(body.description).toBe('My favorites');
    expect(body.members).toHaveLength(2);
    // catalogTotal = number of custom members (2); ownedUnique = 1
    expect(body.counts.catalogTotal).toBe(2);
    expect(body.counts.ownedUnique).toBe(1);
    expect(body.counts.completionPct).toBe(50);
  });

  it('returns 404 when the referenced custom_collection is missing', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        profile: [{ data: profileRow(), error: null }],
        shareable: [
          {
            data: shareableRow({
              target: { kind: 'custom', custom_collection_id: CUSTOM_COLLECTION_ID },
            }),
            error: null,
          },
        ],
        custom_collection: [{ data: null, error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/c/${HANDLE}/${SLUG}`, {
        method: 'GET',
        headers: { accept: RICH_ACCEPT },
      }),
    );
    expect(response.status).toBe(404);
  });
});
