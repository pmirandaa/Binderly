import { describe, expect, it, vi } from 'vitest';

import { ALL_PAID_FEATURES } from './model.js';
import {
  featuresForTier,
  isProEntitlementActive,
  readEntitlement,
  REVENUECAT_API_BASE_URL,
  type RevenueCatFetch,
} from './revenuecat-client.js';

const NOW_MS = Date.parse('2026-05-29T12:00:00.000Z');
const fixedNow = (): number => NOW_MS;

const APP_USER_ID = '11111111-1111-4111-8111-111111111111';
const API_KEY = 'sk_test_secret';

/** Build a fetch stub that resolves a given status + JSON-serializable body. */
function jsonFetch(body: unknown, status = 200): RevenueCatFetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }));
}

/** Build a fetch stub that resolves a raw (possibly malformed) text body. */
function rawFetch(text: string, status = 200): RevenueCatFetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }));
}

/** Build a fetch stub that rejects (network error). */
function throwingFetch(message: string): RevenueCatFetch {
  return vi.fn(async () => {
    throw new Error(message);
  });
}

function subscriberWithPro(expiresDate: string | null): unknown {
  return {
    subscriber: {
      entitlements: {
        pro: {
          expires_date: expiresDate,
          product_identifier: 'pro_monthly',
          purchase_date: '2026-05-01T00:00:00Z',
        },
      },
    },
  };
}

describe('readEntitlement — RC active pro', () => {
  it('maps a non-expiring (null expiry) pro entitlement to pro tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch(subscriberWithPro(null)),
      now: fixedNow,
    });
    expect(result.tier).toBe('pro');
    expect(result.source).toBe('revenuecat');
    expect(result.activeFeatures).toEqual([...ALL_PAID_FEATURES]);
    expect(result.error).toBeUndefined();
  });

  it('maps a future-dated expiry to pro tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch(subscriberWithPro('2099-01-01T00:00:00Z')),
      now: fixedNow,
    });
    expect(result.tier).toBe('pro');
    expect(result.source).toBe('revenuecat');
  });

  it('maps an absent expires_date to pro tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch({ subscriber: { entitlements: { pro: { product_identifier: 'x' } } } }),
      now: fixedNow,
    });
    expect(result.tier).toBe('pro');
  });

  it('reports checkedAt as the ISO of now()', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch(subscriberWithPro(null)),
      now: fixedNow,
    });
    expect(result.checkedAt).toBe('2026-05-29T12:00:00.000Z');
  });
});

describe('readEntitlement — RC free / expired / absent entitlement', () => {
  it('maps an expired (past) pro entitlement to free tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch(subscriberWithPro('2020-01-01T00:00:00Z')),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('revenuecat');
    expect(result.activeFeatures).toEqual([]);
  });

  it('maps an unparseable expires_date to free tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch(subscriberWithPro('not-a-date')),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
  });

  it('maps a subscriber with no pro entitlement to free tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch({ subscriber: { entitlements: { other: { expires_date: null } } } }),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('revenuecat');
  });

  it('maps an empty entitlements map (brand-new subscriber) to free tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch({ subscriber: { entitlements: {} } }),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('revenuecat');
  });

  it('maps a payload with no entitlements key to free tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch({ subscriber: { original_app_user_id: APP_USER_ID } }),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
  });

  it('maps a payload with no subscriber key to free tier', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch({ request_date_ms: 123 }),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
  });
});

describe('readEntitlement — fail-closed on errors', () => {
  it('falls back to free on a malformed JSON body', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: rawFetch('<html>502 Bad Gateway</html>'),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('fallback');
    expect(result.error).toMatch(/not valid JSON/i);
    expect(result.activeFeatures).toEqual([]);
  });

  it('falls back to free on a 401 (bad key)', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch({ message: 'Invalid API key' }, 401),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('fallback');
    expect(result.error).toMatch(/401/);
  });

  it('falls back to free on a 500', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: jsonFetch({ message: 'server error' }, 500),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('fallback');
  });

  it('falls back to free on a network error (fetch rejects)', async () => {
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: throwingFetch('ECONNRESET'),
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('fallback');
    expect(result.error).toMatch(/ECONNRESET/);
  });

  it('falls back without calling fetch when the API key is empty', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    const result = await readEntitlement({
      apiKey: '',
      appUserId: APP_USER_ID,
      fetch: fetchSpy,
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('fallback');
    expect(result.error).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back without calling fetch when the app_user_id is empty', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    const result = await readEntitlement({
      apiKey: API_KEY,
      appUserId: '',
      fetch: fetchSpy,
      now: fixedNow,
    });
    expect(result.tier).toBe('free');
    expect(result.source).toBe('fallback');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('readEntitlement — request shape', () => {
  it('GETs the subscriber endpoint with a bearer Authorization header', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      fetch: fetchSpy,
      now: fixedNow,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${REVENUECAT_API_BASE_URL}/v1/subscribers/${APP_USER_ID}`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('honors a custom base URL and trims a trailing slash', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    await readEntitlement({
      apiKey: API_KEY,
      appUserId: APP_USER_ID,
      baseUrl: 'https://rc.proxy.test/',
      fetch: fetchSpy,
      now: fixedNow,
    });
    const [url] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`https://rc.proxy.test/v1/subscribers/${APP_USER_ID}`);
  });

  it('url-encodes a non-uuid app_user_id', async () => {
    const fetchSpy = jsonFetch(subscriberWithPro(null));
    await readEntitlement({
      apiKey: API_KEY,
      appUserId: 'user/with space',
      fetch: fetchSpy,
      now: fixedNow,
    });
    const [url] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('user%2Fwith%20space');
  });
});

describe('isProEntitlementActive (unit)', () => {
  it('true for a null-expiry pro entitlement', () => {
    expect(isProEntitlementActive(subscriberWithPro(null), NOW_MS)).toBe(true);
  });

  it('true for a future-dated pro entitlement', () => {
    expect(isProEntitlementActive(subscriberWithPro('2099-01-01T00:00:00Z'), NOW_MS)).toBe(true);
  });

  it('false for a past-dated pro entitlement', () => {
    expect(isProEntitlementActive(subscriberWithPro('2000-01-01T00:00:00Z'), NOW_MS)).toBe(false);
  });

  it('false at the exact expiry instant (strictly-future required)', () => {
    const at = new Date(NOW_MS).toISOString();
    expect(isProEntitlementActive(subscriberWithPro(at), NOW_MS)).toBe(false);
  });

  it('false for a null payload', () => {
    expect(isProEntitlementActive(null, NOW_MS)).toBe(false);
  });

  it('false for an array payload', () => {
    expect(isProEntitlementActive([1, 2, 3], NOW_MS)).toBe(false);
  });

  it('false for a non-object expires_date', () => {
    const payload = { subscriber: { entitlements: { pro: { expires_date: 12345 } } } };
    expect(isProEntitlementActive(payload, NOW_MS)).toBe(false);
  });

  it('false when pro is not an object', () => {
    const payload = { subscriber: { entitlements: { pro: 'active' } } };
    expect(isProEntitlementActive(payload, NOW_MS)).toBe(false);
  });
});

describe('featuresForTier (unit)', () => {
  it('returns every paid feature for pro', () => {
    expect(featuresForTier('pro')).toEqual([...ALL_PAID_FEATURES]);
  });

  it('returns no features for free', () => {
    expect(featuresForTier('free')).toEqual([]);
  });
});
