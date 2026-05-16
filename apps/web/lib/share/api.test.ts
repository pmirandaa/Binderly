import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';

import { apiToShareApi } from './api';
import { makeShareableDto } from './fixtures';

function makeFakeClient(
  overrides: Partial<BinderlyClient['shareables']>,
): BinderlyClient {
  // We only exercise `client.shareables.getPublicShareable` from
  // the runtime adapter; the rest of the resource graph is
  // deliberately left as `unknown as never` so a regression that
  // accidentally reaches into another resource fails loudly.
  const shareables = {
    listShareables: vi.fn(),
    getShareable: vi.fn(),
    createShareable: vi.fn(),
    updateShareable: vi.fn(),
    deleteShareable: vi.fn(),
    getPublicShareable: vi.fn(),
    ...overrides,
  };
  return { shareables } as unknown as BinderlyClient;
}

describe('apiToShareApi', () => {
  it('returns a degraded payload synthesised from the bare ShareableDto', async () => {
    const shareable = makeShareableDto({ slug: 'starter', target: { kind: 'full' } });
    const client = makeFakeClient({
      getPublicShareable: vi.fn(async () => shareable),
    });

    const api = apiToShareApi(client);
    const payload = await api.getPublicSharePayload({ handle: 'pablo', slug: 'starter' });

    expect(payload).not.toBeNull();
    expect(payload!.shareable).toBe(shareable);
    expect(payload!.owner.handle).toBe('pablo');
    expect(payload!.owner.displayName).toBeNull();
    expect(payload!.collectionTitle).toBe('Full collection');
    expect(payload!.members).toEqual([]);
    expect(payload!.counts).toEqual({
      ownedUnique: 0,
      ownedTotalQuantity: 0,
      catalogTotal: 0,
      completionPct: 0,
    });
    expect(payload!.lastUpdatedAt).toBe(shareable.updatedAt);
  });

  it('forwards handle + slug to the api-client', async () => {
    const getPublicShareable = vi.fn(async () => makeShareableDto());
    const client = makeFakeClient({ getPublicShareable });

    await apiToShareApi(client).getPublicSharePayload({
      handle: 'with-dash',
      slug: 'cool slug',
    });

    expect(getPublicShareable).toHaveBeenCalledWith({ handle: 'with-dash', slug: 'cool slug' });
  });

  it('forwards an AbortSignal when provided', async () => {
    const getPublicShareable = vi.fn(async () => makeShareableDto());
    const client = makeFakeClient({ getPublicShareable });
    const controller = new AbortController();

    await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'starter',
      signal: controller.signal,
    });

    expect(getPublicShareable).toHaveBeenCalledWith({
      handle: 'pablo',
      slug: 'starter',
      signal: controller.signal,
    });
  });

  it('returns null on ApiNotFoundError so the page calls notFound()', async () => {
    const getPublicShareable = vi.fn(async () => {
      throw new ApiNotFoundError('not found', { status: 404 });
    });
    const client = makeFakeClient({ getPublicShareable });

    const payload = await apiToShareApi(client).getPublicSharePayload({
      handle: 'x',
      slug: 'y',
    });

    expect(payload).toBeNull();
  });

  it('rethrows non-404 errors so the page can render its error state', async () => {
    const error = new Error('backend on fire');
    const getPublicShareable = vi.fn(async () => {
      throw error;
    });
    const client = makeFakeClient({ getPublicShareable });

    await expect(
      apiToShareApi(client).getPublicSharePayload({ handle: 'x', slug: 'y' }),
    ).rejects.toBe(error);
  });

  it('labels custom-target shareables as "Custom collection"', async () => {
    const shareable = makeShareableDto({
      target: { kind: 'custom', customCollectionId: '00000000-0000-0000-0000-000000000001' },
    });
    const client = makeFakeClient({
      getPublicShareable: vi.fn(async () => shareable),
    });

    const payload = await apiToShareApi(client).getPublicSharePayload({
      handle: 'pablo',
      slug: 'binder',
    });

    expect(payload!.collectionTitle).toBe('Custom collection');
  });
});
