import { describe, expect, it, vi } from 'vitest';

import { PLANS } from './plans';
import { forwardEntitlement, type RevenueCatFetch } from './revenuecat';

const MONTHLY = PLANS.find((p) => p.interval === 'monthly')!;
const ANNUAL = PLANS.find((p) => p.interval === 'annual')!;

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface RecordedCall {
  url: string;
  init: FetchInit;
}

function makeFetch(
  response: { ok: boolean; status: number; body?: string } = { ok: true, status: 200 },
): { fetch: RevenueCatFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: RevenueCatFetch = vi.fn(async (url: string, init: FetchInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body ?? '',
    };
  });
  return { fetch: fetchImpl, calls };
}

describe('forwardEntitlement — unconfigured', () => {
  it('returns unconfigured when apiKey is empty', async () => {
    const { fetch, calls } = makeFetch();
    const result = await forwardEntitlement(
      { action: 'grant', userId: 'u1', entitlementId: 'pro', plan: MONTHLY },
      { apiKey: '', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(result.kind).toBe('unconfigured');
    expect(calls.length).toBe(0);
  });

  it('returns error when fetch is undefined and globalThis.fetch is not available', async () => {
    const original = globalThis.fetch;
    // @ts-expect-error — simulating missing global fetch
    globalThis.fetch = undefined;
    try {
      const result = await forwardEntitlement(
        { action: 'grant', userId: 'u1', entitlementId: 'pro', plan: MONTHLY },
        { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com' },
      );
      expect(result.kind).toBe('error');
      if (result.kind !== 'error') return;
      expect(result.message).toMatch(/fetch/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('forwardEntitlement — grant', () => {
  it('POSTs to the promotional grant endpoint with monthly duration', async () => {
    const { fetch, calls } = makeFetch();
    const result = await forwardEntitlement(
      {
        action: 'grant',
        userId: '11111111-2222-3333-4444-555555555555',
        entitlementId: 'pro',
        plan: MONTHLY,
      },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(result.kind).toBe('ok');
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      'https://api.revenuecat.com/v1/subscribers/11111111-2222-3333-4444-555555555555/entitlements/pro/promotional',
    );
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['Authorization']).toBe('Bearer sk_test');
    expect(call.init.headers['X-Platform']).toBe('paddle');
    expect(JSON.parse(call.init.body ?? '{}')).toEqual({ duration: 'monthly' });
  });

  it('uses yearly duration for annual plans', async () => {
    const { fetch, calls } = makeFetch();
    await forwardEntitlement(
      { action: 'grant', userId: 'u1', entitlementId: 'pro', plan: ANNUAL },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(JSON.parse(calls[0]!.init.body ?? '{}')).toEqual({ duration: 'yearly' });
  });

  it('strips trailing slash from baseUrl', async () => {
    const { fetch, calls } = makeFetch();
    await forwardEntitlement(
      { action: 'grant', userId: 'u1', entitlementId: 'pro', plan: MONTHLY },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com/', fetch },
    );
    expect(calls[0]!.url).not.toContain('//v1');
  });

  it('encodes special characters in userId + entitlementId', async () => {
    const { fetch, calls } = makeFetch();
    await forwardEntitlement(
      {
        action: 'grant',
        userId: 'user with spaces',
        entitlementId: 'pro plus',
        plan: MONTHLY,
      },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(calls[0]!.url).toContain('user%20with%20spaces');
    expect(calls[0]!.url).toContain('pro%20plus');
  });
});

describe('forwardEntitlement — revoke', () => {
  it('POSTs to the revoke_promotionals endpoint with empty body', async () => {
    const { fetch, calls } = makeFetch();
    const result = await forwardEntitlement(
      { action: 'revoke', userId: 'u1', entitlementId: 'pro' },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(result.kind).toBe('ok');
    expect(calls[0]!.url).toBe(
      'https://api.revenuecat.com/v1/subscribers/u1/entitlements/pro/revoke_promotionals',
    );
    expect(JSON.parse(calls[0]!.init.body ?? '{}')).toEqual({});
  });
});

describe('forwardEntitlement — error handling', () => {
  it('classifies 4xx responses as non-retryable', async () => {
    const { fetch } = makeFetch({ ok: false, status: 400, body: 'bad request' });
    const result = await forwardEntitlement(
      { action: 'grant', userId: 'u1', entitlementId: 'pro', plan: MONTHLY },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.status).toBe(400);
    expect(result.retryable).toBe(false);
  });

  it('classifies 429 as retryable', async () => {
    const { fetch } = makeFetch({ ok: false, status: 429 });
    const result = await forwardEntitlement(
      { action: 'grant', userId: 'u1', entitlementId: 'pro', plan: MONTHLY },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.retryable).toBe(true);
  });

  it('classifies 5xx as retryable', async () => {
    const { fetch } = makeFetch({ ok: false, status: 503 });
    const result = await forwardEntitlement(
      { action: 'grant', userId: 'u1', entitlementId: 'pro', plan: MONTHLY },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch },
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.retryable).toBe(true);
  });

  it('treats network errors as retryable', async () => {
    const fetchImpl: RevenueCatFetch = vi.fn(async () => {
      throw new Error('connect ETIMEDOUT');
    });
    const result = await forwardEntitlement(
      { action: 'revoke', userId: 'u1', entitlementId: 'pro' },
      { apiKey: 'sk_test', baseUrl: 'https://api.revenuecat.com', fetch: fetchImpl },
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.retryable).toBe(true);
    expect(result.status).toBeNull();
  });
});
