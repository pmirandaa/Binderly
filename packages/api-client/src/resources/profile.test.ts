// Tests for the profile resource.

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import { ApiResponseDecodeError, ApiUnauthorizedError, ApiValidationError } from '../error.js';
import { mockFetch, okEnvelope } from '../test-helpers.js';
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
