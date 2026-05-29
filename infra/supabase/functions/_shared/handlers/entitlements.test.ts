// Tests for the entitlements endpoint (`GET /v1/me/entitlements`).

import { describe, expect, it, vi } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import {
  buildRequest,
  createFakeSupabase,
  FIXTURE_USER_ID,
  makeFakeJwt,
  readSuccessBody,
} from '../test-helpers.ts';
import {
  isProEntitlementActive,
  PAID_FEATURES,
  resolveEntitlements,
} from './entitlements.ts';

import type { EdgeFetch } from '../db.ts';

const NOW_MS = Date.parse('2026-05-29T12:00:00.000Z');

interface EntitlementsResponse {
  tier: 'free' | 'pro';
  activeFeatures: string[];
  source: 'revenuecat' | 'fallback';
  checkedAt: string;
}

/** Env getter that DOES provide the RC secret key. */
const ENV_WITH_RC = (name: string): string | undefined => {
  switch (name) {
    case 'SUPABASE_URL':
      return 'https://test.supabase.test';
    case 'SUPABASE_ANON_KEY':
      return 'anon';
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return 'service-role';
    case 'CORS_ALLOW_ORIGINS':
      return '*';
    case 'REVENUECAT_SECRET_API_KEY':
      return 'sk_test_secret';
    default:
      return undefined;
  }
};

/** Env getter that does NOT provide the RC secret key (dev / unprovisioned). */
const ENV_WITHOUT_RC = (name: string): string | undefined => {
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

function jsonFetch(body: unknown, status = 200): EdgeFetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }));
}

function rawFetch(text: string, status = 200): EdgeFetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }));
}

function throwingFetch(message: string): EdgeFetch {
  return vi.fn(async () => {
    throw new Error(message);
  });
}

function subscriberWithPro(expiresDate: string | null): unknown {
  return { subscriber: { entitlements: { pro: { expires_date: expiresDate } } } };
}

function makeHandlerWith(
  getEnv: (name: string) => string | undefined,
  fetchImpl?: EdgeFetch,
) {
  const fake = createFakeSupabase();
  return makeHandler({
    getEnv,
    routes: ROUTES,
    deps: {
      createClient: () => fake.client,
      ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
    },
  });
}

describe('GET /v1/me/entitlements — auth', () => {
  it('returns 401 for an anonymous caller', async () => {
    const response = await makeHandlerWith(ENV_WITH_RC, jsonFetch(subscriberWithPro(null)))(
      buildRequest({ url: 'http://localhost/v1/me/entitlements', method: 'GET' }),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /v1/me/entitlements — env-missing fallback', () => {
  it('returns 200 free/fallback when REVENUECAT_SECRET_API_KEY is unset (never 500)', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    const response = await makeHandlerWith(ENV_WITHOUT_RC, fetchSpy)(
      buildRequest({
        url: 'http://localhost/v1/me/entitlements',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<EntitlementsResponse>(response);
    expect(body.tier).toBe('free');
    expect(body.source).toBe('fallback');
    expect(body.activeFeatures).toEqual([]);
    // RC must not be called at all when the key is missing.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /v1/me/entitlements — RC active', () => {
  it('returns 200 pro/revenuecat with all paid features for an active pro subscriber', async () => {
    const response = await makeHandlerWith(ENV_WITH_RC, jsonFetch(subscriberWithPro(null)))(
      buildRequest({
        url: 'http://localhost/v1/me/entitlements',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<EntitlementsResponse>(response);
    expect(body.tier).toBe('pro');
    expect(body.source).toBe('revenuecat');
    expect(body.activeFeatures).toEqual([...PAID_FEATURES]);
  });

  it('uses the authed user id as the RC app_user_id', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    await makeHandlerWith(ENV_WITH_RC, fetchSpy)(
      buildRequest({
        url: 'http://localhost/v1/me/entitlements',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const [url, init] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`https://api.revenuecat.com/v1/subscribers/${FIXTURE_USER_ID}`);
    expect(init.headers.Authorization).toBe('Bearer sk_test_secret');
  });

  it('returns free/revenuecat for a subscriber with no pro entitlement', async () => {
    const response = await makeHandlerWith(
      ENV_WITH_RC,
      jsonFetch({ subscriber: { entitlements: {} } }),
    )(
      buildRequest({
        url: 'http://localhost/v1/me/entitlements',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<EntitlementsResponse>(response);
    expect(body.tier).toBe('free');
    expect(body.source).toBe('revenuecat');
  });
});

describe('GET /v1/me/entitlements — RC errors fail-close to free (200)', () => {
  it('degrades to free/fallback on a non-200 from RC', async () => {
    const response = await makeHandlerWith(ENV_WITH_RC, jsonFetch({ message: 'bad key' }, 401))(
      buildRequest({
        url: 'http://localhost/v1/me/entitlements',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<EntitlementsResponse>(response);
    expect(body.tier).toBe('free');
    expect(body.source).toBe('fallback');
  });

  it('degrades to free/fallback on a network error', async () => {
    const response = await makeHandlerWith(ENV_WITH_RC, throwingFetch('ECONNRESET'))(
      buildRequest({
        url: 'http://localhost/v1/me/entitlements',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<EntitlementsResponse>(response);
    expect(body.tier).toBe('free');
    expect(body.source).toBe('fallback');
  });

  it('degrades to free/fallback on a malformed JSON body', async () => {
    const response = await makeHandlerWith(ENV_WITH_RC, rawFetch('<html>502</html>'))(
      buildRequest({
        url: 'http://localhost/v1/me/entitlements',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<EntitlementsResponse>(response);
    expect(body.tier).toBe('free');
    expect(body.source).toBe('fallback');
  });
});

describe('resolveEntitlements (unit)', () => {
  const baseCtx = {
    cors: { allowOrigins: ['*'] as readonly string[] },
    requestId: 'rid-test',
  };

  it('maps an expired pro entitlement to free/revenuecat', async () => {
    const result = await resolveEntitlements(
      FIXTURE_USER_ID,
      {
        ...baseCtx,
        env: {
          supabaseUrl: 'x',
          supabaseAnonKey: 'x',
          supabaseServiceRoleKey: 'x',
          corsAllowOrigins: ['*'],
          revenueCatSecretApiKey: 'sk',
        },
        deps: { fetch: jsonFetch(subscriberWithPro('2000-01-01T00:00:00Z')) },
      },
      () => NOW_MS,
    );
    expect(result.tier).toBe('free');
    expect(result.source).toBe('revenuecat');
    expect(result.checkedAt).toBe('2026-05-29T12:00:00.000Z');
  });

  it('honors a custom RC base URL', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    await resolveEntitlements(
      FIXTURE_USER_ID,
      {
        ...baseCtx,
        env: {
          supabaseUrl: 'x',
          supabaseAnonKey: 'x',
          supabaseServiceRoleKey: 'x',
          corsAllowOrigins: ['*'],
          revenueCatSecretApiKey: 'sk',
          revenueCatApiBaseUrl: 'https://rc.proxy.test/',
        },
        deps: { fetch: fetchSpy },
      },
      () => NOW_MS,
    );
    const [url] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`https://rc.proxy.test/v1/subscribers/${FIXTURE_USER_ID}`);
  });
});

describe('isProEntitlementActive (unit)', () => {
  it('true for null expiry', () => {
    expect(isProEntitlementActive(subscriberWithPro(null), NOW_MS)).toBe(true);
  });
  it('true for future expiry', () => {
    expect(isProEntitlementActive(subscriberWithPro('2099-01-01T00:00:00Z'), NOW_MS)).toBe(true);
  });
  it('false for past expiry', () => {
    expect(isProEntitlementActive(subscriberWithPro('2000-01-01T00:00:00Z'), NOW_MS)).toBe(false);
  });
  it('false for a non-object payload', () => {
    expect(isProEntitlementActive(null, NOW_MS)).toBe(false);
  });
  it('false when there is no pro entitlement', () => {
    expect(isProEntitlementActive({ subscriber: { entitlements: {} } }, NOW_MS)).toBe(false);
  });
});

describe('PAID_FEATURES mirror — pinned to PROJECT.md § 16', () => {
  it('matches the canonical 9-entry list', () => {
    expect([...PAID_FEATURES]).toEqual([
      'stack_scanner',
      'grading_prediction',
      'unlimited_custom_collections',
      'save_smart_collections',
      'unlimited_shareables',
      'shareable_themes',
      'pricing_history',
      'export_data',
      'cloud_ai_scan',
    ]);
  });
});
