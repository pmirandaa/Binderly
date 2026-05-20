import { describe, expect, it, vi } from 'vitest';

import { handlePaddleWebhook } from './handler';
import { signPaddlePayloadForTest } from '../../../../lib/paddle/signature';

import type { ServerPaddleEnv } from '../../../../lib/paddle/env';
import type { SupabaseFetch } from '../../../../lib/paddle/log';
import type { PaddlePriceIds } from '../../../../lib/paddle/plans';
import type { RevenueCatFetch } from '../../../../lib/paddle/revenuecat';


const SECRET = 'pdl_ntfset_sandbox_test_secret';
const VALID_USER_ID = '11111111-2222-3333-4444-555555555555';
const PRICES: PaddlePriceIds = { monthly: 'pri_monthly', annual: 'pri_annual' };
const TS_SECONDS = 1_700_000_000;
const FIXED_NOW = (): number => TS_SECONDS * 1000 + 1000;

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
): { fetch: RevenueCatFetch & SupabaseFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (url: string, init: FetchInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body ?? '',
    };
  });
  return { fetch: fetchImpl as unknown as RevenueCatFetch & SupabaseFetch, calls };
}

function envWithRc(overrides: Partial<ServerPaddleEnv> = {}): ServerPaddleEnv {
  return {
    kind: 'configured',
    apiKey: 'srv_paddle',
    webhookSecret: SECRET,
    environment: 'sandbox',
    revenueCatApiKey: 'sk_rc_test',
    revenueCatBaseUrl: 'https://api.revenuecat.com',
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'srv-secret',
    ...overrides,
  };
}

function makeEvent(eventType: string, priceId = 'pri_monthly', userId = VALID_USER_ID): unknown {
  return {
    event_id: `evt_${eventType.replace(/\./g, '_')}`,
    event_type: eventType,
    occurred_at: '2026-05-20T12:00:00Z',
    data: {
      id: 'sub_or_txn',
      custom_data: { userId },
      items: [{ price: { id: priceId } }],
      details: { line_items: [{ price: { id: priceId } }] },
      current_billing_period: { ends_at: '2026-06-20T12:00:00Z' },
    },
  };
}

function signed(body: string): { body: string; header: string } {
  return { body, header: signPaddlePayloadForTest(body, SECRET, TS_SECONDS) };
}

describe('handlePaddleWebhook — env / config', () => {
  it('returns 503 when no env is loaded (deploy is misconfigured)', async () => {
    const result = await handlePaddleWebhook(
      { body: '', header: null },
      { env: undefined, priceIds: PRICES },
    );
    // We can't fully assert "no env" unless process.env is empty;
    // the test relies on global `loadServerPaddleEnv()` returning
    // unconfigured here. Because vitest's setup.ts injects only
    // Supabase keys, no PADDLE_* keys are set → 503.
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false });
  });

  it('returns 503 when the webhook secret is provided as an empty string via verifyPaddleSignature', async () => {
    const env = envWithRc({ webhookSecret: '' as unknown as string });
    const result = await handlePaddleWebhook(
      { body: '{}', header: 'ts=1;h1=' + 'a'.repeat(64) },
      { env, priceIds: PRICES, now: FIXED_NOW },
    );
    expect(result.status).toBe(503);
  });
});

describe('handlePaddleWebhook — signature posture', () => {
  it('returns 401 when the signature header is missing', async () => {
    const env = envWithRc();
    const result = await handlePaddleWebhook(
      { body: JSON.stringify(makeEvent('subscription.created')), header: null },
      { env, priceIds: PRICES, now: FIXED_NOW },
    );
    expect(result.status).toBe(401);
  });

  it('returns 401 when the signature is malformed', async () => {
    const env = envWithRc();
    const result = await handlePaddleWebhook(
      { body: '{}', header: 'totally-bogus' },
      { env, priceIds: PRICES, now: FIXED_NOW },
    );
    expect(result.status).toBe(401);
  });

  it('returns 401 when the body has been tampered with after signing', async () => {
    const env = envWithRc();
    const original = JSON.stringify(makeEvent('subscription.created'));
    const sig = signPaddlePayloadForTest(original, SECRET, TS_SECONDS);
    const tampered = original + ' ';
    const result = await handlePaddleWebhook(
      { body: tampered, header: sig },
      { env, priceIds: PRICES, now: FIXED_NOW },
    );
    expect(result.status).toBe(401);
  });

  it('returns 401 when the signing secret differs', async () => {
    const env = envWithRc({ webhookSecret: 'a-different-secret' });
    const body = JSON.stringify(makeEvent('subscription.created'));
    const sig = signPaddlePayloadForTest(body, SECRET, TS_SECONDS);
    const result = await handlePaddleWebhook(
      { body, header: sig },
      { env, priceIds: PRICES, now: FIXED_NOW },
    );
    expect(result.status).toBe(401);
  });

  it('returns 401 when the timestamp is older than the tolerance window', async () => {
    const env = envWithRc();
    const body = JSON.stringify(makeEvent('subscription.created'));
    const sig = signPaddlePayloadForTest(body, SECRET, TS_SECONDS);
    const tooLate = (): number => TS_SECONDS * 1000 + 10 * 60 * 1000;
    const result = await handlePaddleWebhook(
      { body, header: sig },
      { env, priceIds: PRICES, now: tooLate },
    );
    expect(result.status).toBe(401);
  });
});

describe('handlePaddleWebhook — body parsing', () => {
  it('returns 400 when the signed body is not valid JSON', async () => {
    const env = envWithRc();
    const body = 'not json';
    const sig = signPaddlePayloadForTest(body, SECRET, TS_SECONDS);
    const result = await handlePaddleWebhook(
      { body, header: sig },
      { env, priceIds: PRICES, now: FIXED_NOW },
    );
    expect(result.status).toBe(400);
  });
});

describe('handlePaddleWebhook — grant flow', () => {
  it('forwards subscription.created → RevenueCat grant with monthly duration', async () => {
    const env = envWithRc();
    const rc = makeFetch();
    const sb = makeFetch({ ok: true, status: 201 });
    const event = makeEvent('subscription.created');
    const { body, header } = signed(JSON.stringify(event));
    const result = await handlePaddleWebhook(
      { body, header },
      {
        env,
        priceIds: PRICES,
        revenueCatFetch: rc.fetch,
        supabaseFetch: sb.fetch,
        now: FIXED_NOW,
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, processed: true });
    expect(rc.calls).toHaveLength(1);
    expect(rc.calls[0]!.url).toContain(`/v1/subscribers/${VALID_USER_ID}/entitlements/pro/promotional`);
    expect(JSON.parse(rc.calls[0]!.init.body ?? '{}')).toEqual({ duration: 'monthly' });
    expect(sb.calls).toHaveLength(1);
    expect(sb.calls[0]!.url).toContain('paddle_webhook_log');
  });

  it('forwards transaction.completed → RevenueCat grant', async () => {
    const env = envWithRc();
    const rc = makeFetch();
    const sb = makeFetch({ ok: true, status: 201 });
    const event = makeEvent('transaction.completed', 'pri_annual');
    const { body, header } = signed(JSON.stringify(event));
    const result = await handlePaddleWebhook(
      { body, header },
      { env, priceIds: PRICES, revenueCatFetch: rc.fetch, supabaseFetch: sb.fetch, now: FIXED_NOW },
    );
    expect(result.status).toBe(200);
    expect(rc.calls).toHaveLength(1);
    expect(rc.calls[0]!.url).toContain('/promotional');
    expect(JSON.parse(rc.calls[0]!.init.body ?? '{}')).toEqual({ duration: 'yearly' });
  });

  it('persists the audit row with snake_case + processed=true on success', async () => {
    const env = envWithRc();
    const rc = makeFetch();
    const sb = makeFetch({ ok: true, status: 201 });
    const event = makeEvent('subscription.activated');
    const { body, header } = signed(JSON.stringify(event));
    await handlePaddleWebhook(
      { body, header },
      { env, priceIds: PRICES, revenueCatFetch: rc.fetch, supabaseFetch: sb.fetch, now: FIXED_NOW },
    );
    expect(sb.calls).toHaveLength(1);
    const rows = JSON.parse(sb.calls[0]!.init.body ?? '[]') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['paddle_event_id']).toBe('evt_subscription_activated');
    expect(rows[0]!['action']).toBe('grant');
    expect(rows[0]!['processed']).toBe(true);
    expect(rows[0]!['retry']).toBe(false);
    expect(rows[0]!['user_id']).toBe(VALID_USER_ID);
    expect(rows[0]!['signature_verified']).toBe(true);
  });
});

describe('handlePaddleWebhook — revoke flow', () => {
  for (const eventType of [
    'subscription.canceled',
    'subscription.past_due',
    'subscription.paused',
  ] as const) {
    it(`forwards ${eventType} → RevenueCat revoke_promotionals`, async () => {
      const env = envWithRc();
      const rc = makeFetch();
      const sb = makeFetch({ ok: true, status: 201 });
      const event = makeEvent(eventType);
      const { body, header } = signed(JSON.stringify(event));
      const result = await handlePaddleWebhook(
        { body, header },
        {
          env,
          priceIds: PRICES,
          revenueCatFetch: rc.fetch,
          supabaseFetch: sb.fetch,
          now: FIXED_NOW,
        },
      );
      expect(result.status).toBe(200);
      expect(rc.calls[0]!.url).toContain('/revoke_promotionals');
    });
  }
});

describe('handlePaddleWebhook — ignore flows', () => {
  it('logs unknown event types as ignore + processed=false', async () => {
    const env = envWithRc();
    const rc = makeFetch();
    const sb = makeFetch({ ok: true, status: 201 });
    const event = { event_id: 'evt_x', event_type: 'wibble.wobble', data: {} };
    const { body, header } = signed(JSON.stringify(event));
    const result = await handlePaddleWebhook(
      { body, header },
      { env, priceIds: PRICES, revenueCatFetch: rc.fetch, supabaseFetch: sb.fetch, now: FIXED_NOW },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, processed: false, reason: 'unknown-event-type' });
    expect(rc.calls).toHaveLength(0);
    expect(sb.calls).toHaveLength(1);
  });

  it('logs missing-user-id without forwarding to RevenueCat', async () => {
    const env = envWithRc();
    const rc = makeFetch();
    const sb = makeFetch({ ok: true, status: 201 });
    const event = {
      event_id: 'evt_no_user',
      event_type: 'subscription.created',
      data: { items: [{ price: { id: 'pri_monthly' } }] },
    };
    const { body, header } = signed(JSON.stringify(event));
    const result = await handlePaddleWebhook(
      { body, header },
      { env, priceIds: PRICES, revenueCatFetch: rc.fetch, supabaseFetch: sb.fetch, now: FIXED_NOW },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ processed: false, reason: 'missing-user-id' });
    expect(rc.calls).toHaveLength(0);
  });
});

describe('handlePaddleWebhook — RevenueCat downstream failure', () => {
  it('returns 200 + processed=false + retry=true when RC returns 503', async () => {
    const env = envWithRc();
    const rc = makeFetch({ ok: false, status: 503, body: 'unavailable' });
    const sb = makeFetch({ ok: true, status: 201 });
    const event = makeEvent('subscription.created');
    const { body, header } = signed(JSON.stringify(event));
    const result = await handlePaddleWebhook(
      { body, header },
      { env, priceIds: PRICES, revenueCatFetch: rc.fetch, supabaseFetch: sb.fetch, now: FIXED_NOW },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, processed: false, retry: true });
    const rows = JSON.parse(sb.calls[0]!.init.body ?? '[]') as Array<Record<string, unknown>>;
    expect(rows[0]!['retry']).toBe(true);
    expect(rows[0]!['error']).toContain('revenuecat:503');
  });

  it('returns 200 + retry=false when RC returns 400 (non-retryable)', async () => {
    const env = envWithRc();
    const rc = makeFetch({ ok: false, status: 400, body: 'bad input' });
    const sb = makeFetch({ ok: true, status: 201 });
    const event = makeEvent('subscription.created');
    const { body, header } = signed(JSON.stringify(event));
    const result = await handlePaddleWebhook(
      { body, header },
      { env, priceIds: PRICES, revenueCatFetch: rc.fetch, supabaseFetch: sb.fetch, now: FIXED_NOW },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ processed: false });
    const rows = JSON.parse(sb.calls[0]!.init.body ?? '[]') as Array<Record<string, unknown>>;
    expect(rows[0]!['retry']).toBe(false);
  });

  it('flags retry=true + reason=unconfigured when REVENUECAT_API_KEY is missing', async () => {
    const env = envWithRc({ revenueCatApiKey: null });
    const rc = makeFetch();
    const sb = makeFetch({ ok: true, status: 201 });
    const event = makeEvent('subscription.created');
    const { body, header } = signed(JSON.stringify(event));
    const result = await handlePaddleWebhook(
      { body, header },
      { env, priceIds: PRICES, revenueCatFetch: rc.fetch, supabaseFetch: sb.fetch, now: FIXED_NOW },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ retry: true, reason: 'unconfigured' });
    expect(rc.calls).toHaveLength(0);
  });
});
