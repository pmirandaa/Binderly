// Tests for the profile resource.

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import {
  ApiNotFoundError,
  ApiRateLimitError,
  ApiResponseDecodeError,
  ApiUnauthorizedError,
  ApiValidationError,
} from '../error.js';
import { errEnvelope, mockFetch, okEnvelope } from '../test-helpers.js';
import { VALID_PROFILE, VALID_SUBSCRIPTION } from './_fixtures.js';
import { makeProfileResource } from './profile.js';

function makeResource(fetch: ReturnType<typeof mockFetch>): {
  fetch: ReturnType<typeof mockFetch>;
  profile: ReturnType<typeof makeProfileResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => 'jwt',
    fetch,
  });
  return { fetch, profile: makeProfileResource(http) };
}

describe('profile.getMyProfile', () => {
  it('returns a ProfileDto on happy path', async () => {
    const { profile } = makeResource(mockFetch({ status: 200, body: okEnvelope(VALID_PROFILE) }));
    const p = await profile.getMyProfile();
    expect(p.handle).toBe('pablo');
  });

  it('hits GET /v1/me/profile', async () => {
    const { fetch, profile } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PROFILE) }),
    );
    await profile.getMyProfile();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/profile');
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const { profile } = makeResource(mockFetch({ status: 401 }));
    await expect(profile.getMyProfile()).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });
});

describe('profile.updateMyProfile', () => {
  it('happy-path PATCH with handle change', async () => {
    const { fetch, profile } = makeResource(
      mockFetch({ status: 200, body: okEnvelope({ ...VALID_PROFILE, handle: 'newhandle' }) }),
    );
    const p = await profile.updateMyProfile({ handle: 'newhandle' });
    expect(p.handle).toBe('newhandle');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('throws ApiValidationError on a bad handle (whitespace)', async () => {
    const { profile } = makeResource(mockFetch({ status: 200, body: okEnvelope(VALID_PROFILE) }));
    await expect(profile.updateMyProfile({ handle: 'has space' })).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });

  it('throws ApiValidationError on an empty patch', async () => {
    const { profile } = makeResource(mockFetch({ status: 200, body: okEnvelope(VALID_PROFILE) }));
    await expect(profile.updateMyProfile({} as never)).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiValidationError on an unknown preference key (.strict() mode)', async () => {
    const { profile } = makeResource(mockFetch({ status: 200, body: okEnvelope(VALID_PROFILE) }));
    await expect(
      profile.updateMyProfile({
        preferences: { unknownField: 'x' } as never,
      }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('profile.getMySubscription', () => {
  it('returns a SubscriptionDto on happy path', async () => {
    const { profile } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SUBSCRIPTION) }),
    );
    const sub = await profile.getMySubscription();
    expect(sub.tier).toBe('free');
  });

  it('hits GET /v1/me/subscription', async () => {
    const { fetch, profile } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SUBSCRIPTION) }),
    );
    await profile.getMySubscription();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/subscription');
  });

  it('throws ApiResponseDecodeError when tier enum is unknown (backend drift)', async () => {
    const { profile } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ ...VALID_SUBSCRIPTION, tier: 'enterprise' }),
      }),
    );
    await expect(profile.getMySubscription()).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });
});

describe('profile.checkHandleAvailability', () => {
  it('returns available=true on a happy path response', async () => {
    const { profile } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ handle: 'pablo', available: true }),
      }),
    );
    const res = await profile.checkHandleAvailability({ handle: 'pablo' });
    expect(res.available).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('returns available=false with reason on a taken handle', async () => {
    const { profile } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ handle: 'pablo', available: false, reason: 'taken' }),
      }),
    );
    const res = await profile.checkHandleAvailability({ handle: 'pablo' });
    expect(res.available).toBe(false);
    expect(res.reason).toBe('taken');
  });

  it('hits GET /v1/me/handle-available with the handle query param', async () => {
    const { fetch, profile } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ handle: 'pablo', available: true }),
      }),
    );
    await profile.checkHandleAvailability({ handle: 'pablo' });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/handle-available');
    expect(url).toContain('handle=pablo');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('rejects locally (ApiValidationError) on an invalid handle without hitting the network', async () => {
    const fetch = mockFetch({
      status: 200,
      body: okEnvelope({ handle: 'pablo', available: true }),
    });
    const { profile } = makeResource(fetch);
    await expect(
      profile.checkHandleAvailability({ handle: 'Bad Handle' }),
    ).rejects.toBeInstanceOf(ApiValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects locally on a too-short handle', async () => {
    const { profile } = makeResource(mockFetch({ status: 200, body: okEnvelope({}) }));
    await expect(
      profile.checkHandleAvailability({ handle: 'pa' }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiUnauthorizedError on 401 (no rate-limit budget without a session)', async () => {
    const { profile } = makeResource(mockFetch({ status: 401 }));
    await expect(profile.checkHandleAvailability({ handle: 'pablo' })).rejects.toBeInstanceOf(
      ApiUnauthorizedError,
    );
  });

  it('throws ApiNotFoundError until the backend endpoint ships', async () => {
    const { profile } = makeResource(
      mockFetch({ status: 404, body: errEnvelope({ code: 'NOT_FOUND', message: 'no route' }) }),
    );
    await expect(profile.checkHandleAvailability({ handle: 'pablo' })).rejects.toBeInstanceOf(
      ApiNotFoundError,
    );
  });

  it('throws ApiRateLimitError on 429 (per-user rate limit tripped)', async () => {
    const { profile } = makeResource(mockFetch({ status: 429 }));
    await expect(profile.checkHandleAvailability({ handle: 'pablo' })).rejects.toBeInstanceOf(
      ApiRateLimitError,
    );
  });

  it('throws ApiResponseDecodeError on a malformed envelope', async () => {
    const { profile } = makeResource(
      mockFetch({
        status: 200,
        // available:false missing reason - violates the contract refine
        body: okEnvelope({ handle: 'pablo', available: false }),
      }),
    );
    await expect(profile.checkHandleAvailability({ handle: 'pablo' })).rejects.toBeInstanceOf(
      ApiResponseDecodeError,
    );
  });

  it('forwards AbortSignal to the underlying fetch', async () => {
    const fetch = mockFetch({
      status: 200,
      body: okEnvelope({ handle: 'pablo', available: true }),
    });
    const { profile } = makeResource(fetch);
    const controller = new AbortController();
    await profile.checkHandleAvailability({ handle: 'pablo', signal: controller.signal });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
