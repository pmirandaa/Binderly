// `RateLimitedClient` tests using a custom `fetchImpl` injection.
//
// The client exposes `fetchImpl` precisely so tests can avoid undici
// MockAgent's interceptor headers shape (which has shifted across
// undici versions). Here we wire a hand-rolled fetch shim that
// records every request and returns programmable responses; this
// keeps the assertions mechanical and undici-version-agnostic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRetryAfter, RateLimitedClient } from './rate-limited-client.js';
import {
  NotFoundError,
  PermanentError,
  RateLimitError,
  TransientError,
} from '../interfaces/adapter.js';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface ProgrammableResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  /** Throw an error for this attempt (simulates network failure). */
  throw?: Error;
}

class FetchShim {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: ProgrammableResponse[] = [];

  enqueue(...responses: ProgrammableResponse[]): this {
    this.queue.push(...responses);
    return this;
  }

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.requests.push({ url, method: init?.method ?? 'GET', headers });
    const next = this.queue.shift();
    if (!next) throw new Error(`FetchShim: no programmed response for ${input.toString()}`);
    if (next.throw) throw next.throw;
    return new Response(next.body ?? '', { status: next.status, headers: next.headers });
  };
}

const HOST = 'mock.example.com';
const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

let shim: FetchShim;

beforeEach(() => {
  shim = new FetchShim();
});

afterEach(() => {
  delete process.env['BINDERLY_DATA_PIPELINE_UA'];
});

function newClient(over: Partial<ConstructorParameters<typeof RateLimitedClient>[0]> = {}) {
  return new RateLimitedClient({
    host: HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
    ...over,
  });
}

describe('RateLimitedClient — happy path', () => {
  it('200 OK: returns parsed JSON and sends User-Agent header', async () => {
    const client = newClient();
    shim.enqueue({ status: 200, body: JSON.stringify({ ok: true }) });
    const out = await client.json<{ ok: boolean }>('/sets');
    expect(out.ok).toBe(true);
    expect(shim.requests).toHaveLength(1);
    expect(shim.requests[0]?.url).toBe(`https://${HOST}/sets`);
    expect(shim.requests[0]?.headers['user-agent']).toBe(UA);
    expect(shim.requests[0]?.headers['accept']).toContain('application/json');
  });

  it('throws PermanentError on invalid JSON body', async () => {
    const client = newClient();
    shim.enqueue({ status: 200, body: 'not-valid-json{{{' });
    await expect(client.json('/sets')).rejects.toBeInstanceOf(PermanentError);
  });
});

describe('RateLimitedClient — 429 with Retry-After', () => {
  it('honors Retry-After (seconds) and retries until success', async () => {
    const sleeps: number[] = [];
    const client = newClient({
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    shim.enqueue(
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 200, body: JSON.stringify({ ok: true }) },
    );
    const out = await client.json<{ ok: boolean }>('/sets');
    expect(out.ok).toBe(true);
    expect(sleeps).toEqual([2_000]);
    expect(shim.requests).toHaveLength(2);
  });

  it('throws RateLimitError when retries exhausted on 429', async () => {
    const client = newClient({ retries: { max: 1, baseDelayMs: 1, factor: 1 } });
    shim.enqueue(
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 429, headers: { 'retry-after': '1' } },
    );
    await expect(client.json('/sets')).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('RateLimitedClient — 5xx backoff', () => {
  it('503 with Retry-After honors header and retries to success', async () => {
    const client = newClient();
    shim.enqueue(
      { status: 503, headers: { 'retry-after': '1' } },
      { status: 200, body: JSON.stringify({ ok: true }) },
    );
    const out = await client.json<{ ok: boolean }>('/sets');
    expect(out.ok).toBe(true);
  });

  it('500 without Retry-After applies exponential backoff', async () => {
    const sleeps: number[] = [];
    const client = newClient({
      retries: { max: 3, baseDelayMs: 100, factor: 2 },
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    shim.enqueue(
      { status: 500 },
      { status: 500 },
      { status: 200, body: JSON.stringify({ ok: true }) },
    );
    await client.json('/x');
    // First retry waits 100ms (factor^0), second waits 200ms (factor^1).
    expect(sleeps).toEqual([100, 200]);
  });

  it('throws TransientError when 5xx retries exhausted', async () => {
    const client = newClient({ retries: { max: 1, baseDelayMs: 1, factor: 1 } });
    shim.enqueue({ status: 502 }, { status: 502 }, { status: 502 });
    await expect(client.json('/x')).rejects.toBeInstanceOf(TransientError);
  });

  it('network errors are retried then surface as TransientError', async () => {
    const client = newClient({ retries: { max: 1, baseDelayMs: 1, factor: 1 } });
    shim.enqueue(
      { status: 0, throw: new Error('socket hang up') },
      { status: 0, throw: new Error('socket hang up') },
    );
    await expect(client.json('/x')).rejects.toBeInstanceOf(TransientError);
    expect(shim.requests).toHaveLength(2);
  });
});

describe('RateLimitedClient — 4xx no-retry', () => {
  it('404 immediately throws NotFoundError without retry', async () => {
    const client = newClient();
    shim.enqueue({ status: 404 });
    await expect(client.json('/missing')).rejects.toBeInstanceOf(NotFoundError);
    expect(shim.requests).toHaveLength(1);
  });

  it('400 immediately throws PermanentError without retry', async () => {
    const client = newClient();
    shim.enqueue({ status: 400 });
    await expect(client.json('/bad')).rejects.toBeInstanceOf(PermanentError);
    expect(shim.requests).toHaveLength(1);
  });

  it('401 immediately throws PermanentError', async () => {
    const client = newClient();
    shim.enqueue({ status: 401 });
    await expect(client.json('/auth')).rejects.toBeInstanceOf(PermanentError);
  });
});

describe('RateLimitedClient — User-Agent contract', () => {
  it('refuses to construct without a User-Agent', () => {
    delete process.env['BINDERLY_DATA_PIPELINE_UA'];
    expect(
      () =>
        new RateLimitedClient({
          host: HOST,
          requestsPerSecond: 1,
          burst: 1,
          fetchImpl: shim.fetch,
        }),
    ).toThrow(/userAgent is required/);
  });

  it('falls back to BINDERLY_DATA_PIPELINE_UA env when ctor arg is absent', async () => {
    process.env['BINDERLY_DATA_PIPELINE_UA'] = 'EnvUA/0.0.1';
    const client = new RateLimitedClient({
      host: HOST,
      requestsPerSecond: 100,
      burst: 5,
      retries: { max: 0, baseDelayMs: 1, factor: 1 },
      fetchImpl: shim.fetch,
      sleep: () => Promise.resolve(),
    });
    shim.enqueue({ status: 200, body: '{"ok":true}' });
    await client.json('/x');
    expect(shim.requests[0]?.headers['user-agent']).toBe('EnvUA/0.0.1');
  });
});

describe('RateLimitedClient — host enforcement', () => {
  it('refuses cross-host absolute URLs', async () => {
    const client = newClient();
    await expect(client.request('https://other.example.com/x')).rejects.toThrow(
      /refusing cross-host call/,
    );
  });

  it('accepts absolute URLs to the configured host', async () => {
    const client = newClient();
    shim.enqueue({ status: 200, body: '{}' });
    const res = await client.request(`https://${HOST}/x`);
    expect(res.status).toBe(200);
  });
});

describe('RateLimitedClient — rate limiting', () => {
  it('serializes requests through the bottleneck (single-flight)', async () => {
    const inFlight = { count: 0, peak: 0 };
    const client = newClient({
      requestsPerSecond: 1000,
      burst: 5,
    });
    // Override fetchImpl with one that tracks concurrency.
    const concurrentFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      inFlight.count += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.count);
      await new Promise((r) => setTimeout(r, 5));
      inFlight.count -= 1;
      return shim.fetch(input, init);
    };
    (client as unknown as { fetchImpl: typeof concurrentFetch }).fetchImpl = concurrentFetch;
    shim.enqueue(
      { status: 200, body: '{}' },
      { status: 200, body: '{}' },
      { status: 200, body: '{}' },
    );
    await Promise.all([client.request('/a'), client.request('/b'), client.request('/c')]);
    expect(inFlight.peak).toBe(1);
  });
});

describe('parseRetryAfter', () => {
  it('returns null for missing header', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
  });

  it('parses delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5_000);
    expect(parseRetryAfter('  10 ')).toBe(10_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date as positive delta from now', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(61_000);
  });

  it('clamps past HTTP-dates to 0', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  it('returns null on garbage', () => {
    expect(parseRetryAfter('garbage-value')).toBeNull();
  });
});

// Unused-imports linter pacification: vi is referenced for future
// fake-timer experiments; keeping the import explicit documents that
// these tests are vitest-native.
void vi;
