import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type { PublicShareableDto } from '@binderly/api-contracts';

import { apiToShareApi } from './api';
import { makeShareableDto } from './fixtures';

function makeFakeClient(
  overrides: Partial<BinderlyClient['shareables']>,
): BinderlyClient {
  // Only `client.shareables.getPublicShareablePayload` is
  // exercised by `apiToShareApi`; the rest of the resource graph
  // is left as a typed stub so a regression that reaches into
  // another method fails loudly.
  const shareables = {
    listShareables: vi.fn(),
    getShareable: vi.fn(),
    createShareable: vi.fn(),
    updateShareable: vi.fn(),
    deleteShareable: vi.fn(),
    getPublicShareable: vi.fn(),
    getPublicShareablePayload: vi.fn(),
    ...overrides,
  };
  return { shareables } as unknown as BinderlyClient;
}

function makeRichPayload(
  overrides: Partial<PublicShareableDto> = {},
): PublicShareableDto {
  return {
    shareable: makeShareableDto(),
    owner: {
      handle: 'pablo',
      displayName: 'Pablo Miranda',
      avatarUrl: 'https://images.binderly.app/avatars/pablo.webp',
      bio: 'Collecting since Base Set.',
      socialLinks: [],
    },
    collectionTitle: "Pablo's collection",
    description: 'My all-time favourites.',
    counts: {
      ownedUnique: 142,
      ownedTotalQuantity: 167,
      catalogTotal: 1832,
      completionPct: 7.75,
    },
    members: [
      {
        printingId: 'p-a1-holo',
        cardId: 'card-a1',
        cardName: 'Charizard',
        cardNumber: '4',
        setName: 'Base Set',
        setCode: 'base1',
        variantLabel: 'Holo',
        imageUrl: 'https://images.binderly.app/printings/base1-4-holo-sm.webp',
        quantity: 1,
      },
    ],
    lastUpdatedAt: '2026-05-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('apiToShareApi — V2 wiring (Q-012 closed)', () => {
  it('calls client.shareables.getPublicShareablePayload (not the bare endpoint)', async () => {
    const getPublicShareablePayload = vi.fn(async () => makeRichPayload());
    const getPublicShareable = vi.fn();
    const client = makeFakeClient({
      getPublicShareable,
      getPublicShareablePayload,
    });

    await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'binder',
    });

    expect(getPublicShareablePayload).toHaveBeenCalledTimes(1);
    expect(getPublicShareable).not.toHaveBeenCalled();
  });

  it('forwards handle + slug to the V2 method', async () => {
    const getPublicShareablePayload = vi.fn(async () => makeRichPayload());
    const client = makeFakeClient({ getPublicShareablePayload });

    await apiToShareApi(client).getPublicSharePayload({
      handle: 'with-dash',
      slug: 'cool-slug',
    });

    expect(getPublicShareablePayload).toHaveBeenCalledWith({
      handle: 'with-dash',
      slug: 'cool-slug',
    });
  });

  it('forwards the abort signal when provided', async () => {
    const getPublicShareablePayload = vi.fn(async () => makeRichPayload());
    const client = makeFakeClient({ getPublicShareablePayload });
    const controller = new AbortController();

    await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'starter',
      signal: controller.signal,
    });

    expect(getPublicShareablePayload).toHaveBeenCalledWith({
      handle: 'pablo',
      slug: 'starter',
      signal: controller.signal,
    });
  });

  it('omits the signal key when not provided', async () => {
    const getPublicShareablePayload = vi.fn(async () => makeRichPayload());
    const client = makeFakeClient({ getPublicShareablePayload });

    await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'starter',
    });

    expect(getPublicShareablePayload).toHaveBeenCalledWith({
      handle: 'pablo',
      slug: 'starter',
    });
  });
});

describe('apiToShareApi — payload pass-through', () => {
  it('returns the rich owner + counts + members verbatim (no degraded synthesis)', async () => {
    const dto = makeRichPayload();
    const client = makeFakeClient({
      getPublicShareablePayload: vi.fn(async () => dto),
    });

    const out = await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'binder',
    });

    expect(out).not.toBeNull();
    expect(out!.owner.handle).toBe('pablo');
    expect(out!.owner.displayName).toBe('Pablo Miranda');
    expect(out!.owner.avatarUrl).toBe(
      'https://images.binderly.app/avatars/pablo.webp',
    );
    expect(out!.owner.bio).toBe('Collecting since Base Set.');
    expect(out!.collectionTitle).toBe("Pablo's collection");
    expect(out!.description).toBe('My all-time favourites.');
    expect(out!.counts).toEqual({
      ownedUnique: 142,
      ownedTotalQuantity: 167,
      catalogTotal: 1832,
      completionPct: 7.75,
    });
    expect(out!.members).toHaveLength(1);
    expect(out!.members[0]?.cardName).toBe('Charizard');
    expect(out!.lastUpdatedAt).toBe('2026-05-01T12:00:00.000Z');
  });

  it('passes the shareable substructure through verbatim', async () => {
    const shareable = makeShareableDto({
      slug: 'starter',
      target: { kind: 'full' },
    });
    const dto = makeRichPayload({ shareable });
    const client = makeFakeClient({
      getPublicShareablePayload: vi.fn(async () => dto),
    });

    const out = await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'starter',
    });

    expect(out!.shareable).toBe(shareable);
  });

  it('preserves an empty members list (zero-members is a valid state, not 404)', async () => {
    const dto = makeRichPayload({ members: [] });
    const client = makeFakeClient({
      getPublicShareablePayload: vi.fn(async () => dto),
    });

    const out = await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'binder',
    });

    expect(out).not.toBeNull();
    expect(out!.members).toEqual([]);
  });

  it('preserves a null description on free-tier shareables', async () => {
    const dto = makeRichPayload({ description: null });
    const client = makeFakeClient({
      getPublicShareablePayload: vi.fn(async () => dto),
    });

    const out = await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'binder',
    });

    expect(out!.description).toBeNull();
  });

  it('passes a custom-target shareable through with the server-rendered title', async () => {
    const dto = makeRichPayload({
      shareable: makeShareableDto({
        target: {
          kind: 'custom',
          customCollectionId: '00000000-0000-0000-0000-000000000001',
        },
      }),
      collectionTitle: "Pablo's Charizard binder",
    });
    const client = makeFakeClient({
      getPublicShareablePayload: vi.fn(async () => dto),
    });

    const out = await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'charizard-binder',
    });

    expect(out!.collectionTitle).toBe("Pablo's Charizard binder");
    expect(out!.shareable.target.kind).toBe('custom');
  });
});

describe('apiToShareApi — error handling', () => {
  it('returns null on ApiNotFoundError so the page calls notFound()', async () => {
    const client = makeFakeClient({
      getPublicShareablePayload: vi.fn(async () => {
        throw new ApiNotFoundError('not found', { status: 404 });
      }),
    });

    const out = await apiToShareApi(client).getPublicSharePayload({
      handle: 'x',
      slug: 'y',
    });

    expect(out).toBeNull();
  });

  it('rethrows non-404 errors (no degraded synthesis fallback on 5xx)', async () => {
    const error = new Error('backend on fire');
    const client = makeFakeClient({
      getPublicShareablePayload: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(
      apiToShareApi(client).getPublicSharePayload({ handle: 'x', slug: 'y' }),
    ).rejects.toBe(error);
  });
});
