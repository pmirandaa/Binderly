// Tests for the entitlements resource.

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import { ApiResponseDecodeError, ApiUnauthorizedError } from '../error.js';
import { mockFetch, okEnvelope } from '../test-helpers.js';
import { VALID_ENTITLEMENTS_FREE, VALID_ENTITLEMENTS_PRO } from './_fixtures.js';
import { makeEntitlementsResource } from './entitlements.js';

function makeResource(fetch: ReturnType<typeof mockFetch>): {
  fetch: ReturnType<typeof mockFetch>;
  entitlements: ReturnType<typeof makeEntitlementsResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => 'jwt',
    fetch,
  });
  return { fetch, entitlements: makeEntitlementsResource(http) };
}

describe('entitlements.getMyEntitlements', () => {
  it('returns a pro EntitlementsDto on the happy path', async () => {
    const { entitlements } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_ENTITLEMENTS_PRO) }),
    );
    const dto = await entitlements.getMyEntitlements();
    expect(dto.tier).toBe('pro');
    expect(dto.source).toBe('revenuecat');
    expect(dto.activeFeatures).toContain('stack_scanner');
  });

  it('returns a free EntitlementsDto', async () => {
    const { entitlements } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_ENTITLEMENTS_FREE) }),
    );
    const dto = await entitlements.getMyEntitlements();
    expect(dto.tier).toBe('free');
    expect(dto.activeFeatures).toEqual([]);
  });

  it('hits GET /v1/me/entitlements', async () => {
    const { fetch, entitlements } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_ENTITLEMENTS_FREE) }),
    );
    await entitlements.getMyEntitlements();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/me/entitlements');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('accepts a fail-closed fallback envelope (200 + free + fallback)', async () => {
    const { entitlements } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({
          tier: 'free',
          activeFeatures: [],
          source: 'fallback',
          checkedAt: '2026-05-05T12:00:00Z',
        }),
      }),
    );
    const dto = await entitlements.getMyEntitlements();
    expect(dto.tier).toBe('free');
    expect(dto.source).toBe('fallback');
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const { entitlements } = makeResource(mockFetch({ status: 401 }));
    await expect(entitlements.getMyEntitlements()).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });

  it('throws ApiResponseDecodeError when tier enum is unknown (backend drift)', async () => {
    const { entitlements } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ ...VALID_ENTITLEMENTS_PRO, tier: 'enterprise' }),
      }),
    );
    await expect(entitlements.getMyEntitlements()).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });

  it('forwards AbortSignal to the underlying fetch', async () => {
    const { fetch, entitlements } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_ENTITLEMENTS_FREE) }),
    );
    const controller = new AbortController();
    await entitlements.getMyEntitlements({ signal: controller.signal });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
