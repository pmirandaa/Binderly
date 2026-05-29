// Tests for the public barrel — verify the createClient factory
// wires up every resource with the same underlying HttpClient and
// that the public surface re-exports stay stable.

import { describe, expect, it } from 'vitest';

import {
  ApiError,
  ApiNetworkError,
  ApiUnauthorizedError,
  ApiValidationError,
  createClient,
  HttpClient,
  loadClientEnv,
} from './index.js';
import { FIXTURE_IDS, VALID_PROFILE, VALID_SET } from './resources/_fixtures.js';
import { mockFetch, okEnvelope } from './test-helpers.js';

describe('createClient', () => {
  it('returns an object with every resource namespace', () => {
    const client = createClient({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      getJwt: () => null,
      fetch: mockFetch(),
    });
    expect(client.cards).toBeDefined();
    expect(client.collection).toBeDefined();
    expect(client.pricing).toBeDefined();
    expect(client.grading).toBeDefined();
    expect(client.shareables).toBeDefined();
    expect(client.profile).toBeDefined();
    expect(client.auth).toBeDefined();
    expect(client.smartCollections).toBeDefined();
    expect(client.entitlements).toBeDefined();
    expect(client.http).toBeInstanceOf(HttpClient);
  });

  it('returns a frozen object (mutation throws / no-ops)', () => {
    const client = createClient({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      getJwt: () => null,
    });
    expect(Object.isFrozen(client)).toBe(true);
  });

  it('cards resource works end-to-end via the factory', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope(VALID_SET) });
    const client = createClient({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      getJwt: () => null,
      fetch,
    });
    const set = await client.cards.getSet({ id: FIXTURE_IDS.setId });
    expect(set.code).toBe('swsh9');
  });

  it('profile resource works end-to-end via the factory', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope(VALID_PROFILE) });
    const client = createClient({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      getJwt: () => 'jwt-1',
      fetch,
    });
    const profile = await client.profile.getMyProfile();
    expect(profile.handle).toBe('pablo');
    expect(fetch.mock.calls[0]?.[1]?.headers?.authorization).toBe('Bearer jwt-1');
  });

  it('passes default headers through on every call', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope(VALID_SET) });
    const client = createClient({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      getJwt: () => null,
      fetch,
      defaultHeaders: { 'x-binderly-app': 'web' },
    });
    await client.cards.getSet({ id: FIXTURE_IDS.setId });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-binderly-app': 'web' });
  });

  it('exports the full error hierarchy', () => {
    expect(typeof ApiError).toBe('function');
    expect(typeof ApiValidationError).toBe('function');
    expect(typeof ApiUnauthorizedError).toBe('function');
    expect(typeof ApiNetworkError).toBe('function');
  });

  it('exports loadClientEnv', () => {
    expect(typeof loadClientEnv).toBe('function');
  });
});
