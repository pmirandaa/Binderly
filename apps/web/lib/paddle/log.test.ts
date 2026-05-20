import { describe, expect, it, vi } from 'vitest';

import { recordWebhookLog, type SupabaseFetch } from './log';

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
  response: { ok: boolean; status: number; body?: string } = { ok: true, status: 201 },
): { fetch: SupabaseFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: SupabaseFetch = vi.fn(async (url: string, init: FetchInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body ?? '',
    };
  });
  return { fetch: fetchImpl, calls };
}

const ROW = {
  paddleEventId: 'evt_test',
  eventType: 'subscription.created',
  occurredAt: '2026-05-20T12:00:00Z',
  signatureVerified: true,
  userId: '11111111-2222-3333-4444-555555555555',
  priceId: 'pri_monthly',
  entitlementId: 'pro',
  action: 'grant' as const,
  processed: true,
  retry: false,
  error: null,
  payload: { event_type: 'subscription.created' },
};

describe('recordWebhookLog', () => {
  it('returns unconfigured when supabaseServiceRoleKey is empty', async () => {
    const { fetch, calls } = makeFetch();
    const result = await recordWebhookLog(ROW, {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: '',
      fetch,
    });
    expect(result.kind).toBe('unconfigured');
    expect(calls).toHaveLength(0);
  });

  it('returns unconfigured when supabaseUrl is empty', async () => {
    const { fetch, calls } = makeFetch();
    const result = await recordWebhookLog(ROW, {
      supabaseUrl: '',
      supabaseServiceRoleKey: 'srv',
      fetch,
    });
    expect(result.kind).toBe('unconfigured');
    expect(calls).toHaveLength(0);
  });

  it('POSTs the row as a PostgREST upsert with merge-duplicates', async () => {
    const { fetch, calls } = makeFetch();
    const result = await recordWebhookLog(ROW, {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srv-secret',
      fetch,
    });
    expect(result.kind).toBe('ok');
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      'https://example.supabase.co/rest/v1/paddle_webhook_log?on_conflict=paddle_event_id',
    );
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['Prefer']).toContain('resolution=merge-duplicates');
    expect(call.init.headers['apikey']).toBe('srv-secret');
    expect(call.init.headers['Authorization']).toBe('Bearer srv-secret');
  });

  it('translates camelCase keys to snake_case for PostgREST', async () => {
    const { fetch, calls } = makeFetch();
    await recordWebhookLog(ROW, {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srv',
      fetch,
    });
    const body = JSON.parse(calls[0]!.init.body ?? '[]') as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    const row = body[0]!;
    expect(row['paddle_event_id']).toBe('evt_test');
    expect(row['signature_verified']).toBe(true);
    expect(row['user_id']).toBe(ROW.userId);
    expect(row['entitlement_id']).toBe('pro');
    expect(row['action']).toBe('grant');
    expect(row['processed']).toBe(true);
    expect(row['processed_at']).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('sets processed_at to null when the row is not processed', async () => {
    const { fetch, calls } = makeFetch();
    await recordWebhookLog(
      { ...ROW, processed: false, retry: true },
      {
        supabaseUrl: 'https://example.supabase.co',
        supabaseServiceRoleKey: 'srv',
        fetch,
      },
    );
    const body = JSON.parse(calls[0]!.init.body ?? '[]') as Array<Record<string, unknown>>;
    expect(body[0]!['processed_at']).toBeNull();
    expect(body[0]!['retry']).toBe(true);
  });

  it('returns error when PostgREST returns 4xx', async () => {
    const { fetch } = makeFetch({ ok: false, status: 400, body: 'bad jsonb' });
    const result = await recordWebhookLog(ROW, {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srv',
      fetch,
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.status).toBe(400);
    expect(result.message).toContain('bad jsonb');
  });

  it('returns error on network failure', async () => {
    const fetchImpl: SupabaseFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await recordWebhookLog(ROW, {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srv',
      fetch: fetchImpl,
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.status).toBeNull();
    expect(result.message).toContain('ECONNREFUSED');
  });
});
