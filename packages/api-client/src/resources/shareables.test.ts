// Tests for the shareables resource. The owner-CRUD methods
// require a JWT; the public-render path (`getPublicShareable`) is
// anonymous and must NOT call `getJwt`.

import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../client.js';
import {
  ApiConflictError,
  ApiNotFoundError,
  ApiUnauthorizedError,
  ApiValidationError,
} from '../error.js';
import { errEnvelope, mockFetch, okEnvelope } from '../test-helpers.js';
import {
  FIXTURE_IDS,
  VALID_PUBLIC_SHAREABLE_PAYLOAD,
  VALID_SHAREABLE,
} from './_fixtures.js';
import { makeShareablesResource } from './shareables.js';

function makeResource(
  fetch: ReturnType<typeof mockFetch>,
  getJwt: () => Promise<string | null> | string | null = () => 'jwt',
): {
  fetch: ReturnType<typeof mockFetch>;
  shareables: ReturnType<typeof makeShareablesResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt,
    fetch,
  });
  return { fetch, shareables: makeShareablesResource(http) };
}

describe('shareables.listShareables', () => {
  it('returns the array on happy path', async () => {
    const { shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope([VALID_SHAREABLE]) }),
    );
    const list = await shareables.listShareables();
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('my-binder');
  });

  it('hits GET /v1/me/shareables', async () => {
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope([VALID_SHAREABLE]) }),
    );
    await shareables.listShareables();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/shareables');
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const { shareables } = makeResource(mockFetch({ status: 401 }));
    await expect(shareables.listShareables()).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });
});

describe('shareables.getShareable', () => {
  it('hits GET /v1/me/shareables/{id}', async () => {
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await shareables.getShareable({ id: FIXTURE_IDS.shareableId });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/me/shareables/${FIXTURE_IDS.shareableId}`);
  });
});

describe('shareables.createShareable', () => {
  it('happy-path create round-trip', async () => {
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    const created = await shareables.createShareable({
      slug: 'my-binder',
      target: { kind: 'full' },
    });
    expect(created.slug).toBe('my-binder');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('throws ApiValidationError on a malformed slug', async () => {
    const { shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await expect(
      shareables.createShareable({
        slug: 'NOT VALID',
        target: { kind: 'full' },
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiValidationError when target.kind is unknown', async () => {
    const { shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await expect(
      shareables.createShareable({
        slug: 'valid',
        target: { kind: 'banana' as never },
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiConflictError on slug collision (HTTP 409)', async () => {
    const { shareables } = makeResource(
      mockFetch({
        status: 409,
        body: errEnvelope({ code: 'CONFLICT', message: 'slug taken' }),
      }),
    );
    await expect(
      shareables.createShareable({
        slug: 'my-binder',
        target: { kind: 'full' },
      }),
    ).rejects.toBeInstanceOf(ApiConflictError);
  });
});

describe('shareables.updateShareable', () => {
  it('hits PATCH /v1/me/shareables/{id}', async () => {
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await shareables.updateShareable({
      id: FIXTURE_IDS.shareableId,
      patch: { theme: 'gold' },
    });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('throws ApiValidationError on an empty patch', async () => {
    const { shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await expect(
      shareables.updateShareable({ id: FIXTURE_IDS.shareableId, patch: {} as never }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiValidationError on an unknown theme', async () => {
    const { shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await expect(
      shareables.updateShareable({
        id: FIXTURE_IDS.shareableId,
        patch: { theme: 'banana' as never },
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('shareables.deleteShareable', () => {
  it('hits DELETE /v1/me/shareables/{id} and resolves on 204', async () => {
    const { fetch, shareables } = makeResource(mockFetch({ status: 204, body: '' }));
    await shareables.deleteShareable({ id: FIXTURE_IDS.shareableId });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('throws ApiNotFoundError on 404', async () => {
    const { shareables } = makeResource(mockFetch({ status: 404 }));
    await expect(
      shareables.deleteShareable({ id: FIXTURE_IDS.shareableId }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

// ============================================================
// Public render path — anonymous, no JWT call
// ============================================================

describe('shareables.getPublicShareable', () => {
  it('returns a ShareableDto on happy path', async () => {
    const { shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    const sh = await shareables.getPublicShareable({ handle: 'pablo', slug: 'my-binder' });
    expect(sh.slug).toBe('my-binder');
  });

  it('hits GET /v1/c/{handle}/{slug}', async () => {
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await shareables.getPublicShareable({ handle: 'pablo', slug: 'my-binder' });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/c/pablo/my-binder');
  });

  it('does NOT call getJwt (anonymous request)', async () => {
    const getJwt = vi.fn(() => 'jwt-1');
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
      getJwt,
    );
    await shareables.getPublicShareable({ handle: 'pablo', slug: 'my-binder' });
    expect(getJwt).not.toHaveBeenCalled();
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBeUndefined();
    // apikey is still sent — Supabase requires it.
    expect(init?.headers).toMatchObject({ apikey: 'anon' });
  });

  it('URL-encodes special characters in handle / slug', async () => {
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SHAREABLE) }),
    );
    await shareables.getPublicShareable({ handle: 'pa blo', slug: 'my/binder' });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/c/pa%20blo/my%2Fbinder');
  });

  it('throws ApiNotFoundError when the public page does not exist', async () => {
    const { shareables } = makeResource(mockFetch({ status: 404 }));
    await expect(
      shareables.getPublicShareable({ handle: 'pablo', slug: 'gone' }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

// ============================================================
// getPublicShareablePayload (new — richer SSR payload)
// ============================================================

describe('shareables.getPublicShareablePayload', () => {
  it('returns the richer PublicShareableDto on happy path', async () => {
    const { shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PUBLIC_SHAREABLE_PAYLOAD) }),
    );
    const payload = await shareables.getPublicShareablePayload({
      handle: 'pablo',
      slug: 'my-binder',
    });
    expect(payload.owner.handle).toBe('pablo');
    expect(payload.members).toHaveLength(1);
    expect(payload.collectionTitle).toBe("Pablo's collection");
  });

  it('hits GET /v1/c/{handle}/{slug} with the share Accept header', async () => {
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PUBLIC_SHAREABLE_PAYLOAD) }),
    );
    await shareables.getPublicShareablePayload({ handle: 'pablo', slug: 'my-binder' });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/c/pablo/my-binder');
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.accept).toBe('application/vnd.binderly.share+json');
  });

  it('does NOT call getJwt (anonymous request)', async () => {
    const getJwt = vi.fn(() => 'jwt-1');
    const { fetch, shareables } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PUBLIC_SHAREABLE_PAYLOAD) }),
      getJwt,
    );
    await shareables.getPublicShareablePayload({ handle: 'pablo', slug: 'my-binder' });
    expect(getJwt).not.toHaveBeenCalled();
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBeUndefined();
  });

  it('parses a zero-members payload (empty array, NOT 404)', async () => {
    const { shareables } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ ...VALID_PUBLIC_SHAREABLE_PAYLOAD, members: [] }),
      }),
    );
    const payload = await shareables.getPublicShareablePayload({
      handle: 'pablo',
      slug: 'empty',
    });
    expect(payload.members).toHaveLength(0);
  });

  it('throws ApiNotFoundError when the public page does not exist', async () => {
    const { shareables } = makeResource(mockFetch({ status: 404 }));
    await expect(
      shareables.getPublicShareablePayload({ handle: 'pablo', slug: 'gone' }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});
