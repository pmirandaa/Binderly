// Integration tests for `FrankfurterClient`. We inject a hand-rolled
// `fetchImpl` shim (same approach as `tcgdex-en/adapter.test.ts` and
// `rate-limited-client.test.ts`) to exercise the HTTP layer without
// leaving the Vitest worker.
//
// Coverage targets:
//   - getLatest / getHistorical / getRange happy paths
//   - 404 → NotFoundError
//   - Malformed JSON → PermanentError
//   - Schema-mismatch response → PermanentError
//   - 429 retry path through the RateLimitedClient
//   - Required base / symbols query params
//   - User-Agent header is set per request

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FRANKFURTER_DEFAULT_BURST,
  FRANKFURTER_DEFAULT_RPS,
  FRANKFURTER_DEFAULT_USER_AGENT,
  FRANKFURTER_HOST,
  FRANKFURTER_SOURCE,
  FrankfurterClient,
  createFrankfurterClient,
} from './frankfurter.js';
import { BINDERLY_FX_BASE_CURRENCY, BINDERLY_FX_QUOTE_CURRENCIES } from './types.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { NotFoundError, PermanentError, RateLimitError } from '../../interfaces/adapter.js';

const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface ProgrammableResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  throw?: Error;
}

class FetchShim {
  readonly requests: RecordedRequest[] = [];
  /** Map of `path` (URL pathname, no query string) to FIFO response queue. */
  private readonly queues = new Map<string, ProgrammableResponse[]>();
  defaultResponse: ProgrammableResponse | null = null;

  enqueue(pathname: string, ...responses: ProgrammableResponse[]): this {
    const list = this.queues.get(pathname) ?? [];
    list.push(...responses);
    this.queues.set(pathname, list);
    return this;
  }

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.requests.push({ url, method: init?.method ?? 'GET', headers });
    const pathname = new URL(url).pathname;
    const queue = this.queues.get(pathname);
    let next: ProgrammableResponse | undefined;
    if (queue && queue.length > 0) next = queue.shift();
    if (!next) next = this.defaultResponse ?? undefined;
    if (!next) throw new Error(`FetchShim: no programmed response for ${pathname}`);
    if (next.throw) throw next.throw;
    return new Response(next.body ?? '', { status: next.status, headers: next.headers });
  };
}

let shim: FetchShim;

beforeEach(() => {
  shim = new FetchShim();
});

afterEach(() => {
  delete process.env['BINDERLY_DATA_PIPELINE_UA'];
});

function newClient(over: Partial<ConstructorParameters<typeof RateLimitedClient>[0]> = {}) {
  const http = new RateLimitedClient({
    host: FRANKFURTER_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
    ...over,
  });
  return new FrankfurterClient({ http });
}

const LATEST_BODY = JSON.stringify({
  amount: 1.0,
  base: 'USD',
  date: '2026-04-30',
  rates: {
    AUD: 1.399,
    CAD: 1.3668,
    EUR: 0.85455,
    GBP: 0.74026,
    JPY: 156.56,
    MXN: 17.5158,
  },
});

const HISTORICAL_BODY = JSON.stringify({
  amount: 1.0,
  base: 'USD',
  date: '2026-04-29',
  rates: { EUR: 0.85426, GBP: 0.74016, JPY: 159.79 },
});

const RANGE_BODY = JSON.stringify({
  amount: 1.0,
  base: 'USD',
  start_date: '2026-04-28',
  end_date: '2026-04-30',
  rates: {
    '2026-04-28': { EUR: 0.85616, GBP: 0.74242, JPY: 159.74 },
    '2026-04-29': { EUR: 0.85426, GBP: 0.74016, JPY: 159.79 },
    '2026-04-30': { EUR: 0.85455, GBP: 0.74026, JPY: 156.56 },
  },
});

describe('FrankfurterClient — construction', () => {
  it('refuses a RateLimitedClient pinned to a different host', () => {
    const wrongHost = new RateLimitedClient({
      host: 'api.tcgdex.net',
      requestsPerSecond: 1,
      burst: 1,
      userAgent: UA,
      fetchImpl: shim.fetch,
    });
    expect(() => new FrankfurterClient({ http: wrongHost })).toThrow(
      /pinned to api\.frankfurter\.dev/,
    );
  });

  it('exposes the canonical source tag', () => {
    expect(FRANKFURTER_SOURCE).toBe('frankfurter');
  });
});

describe('FrankfurterClient — getLatest', () => {
  it('happy path: hits /v1/latest with base + all default symbols', async () => {
    const client = newClient();
    shim.enqueue('/v1/latest', { status: 200, body: LATEST_BODY });
    const res = await client.getLatest();
    expect(res.base).toBe('USD');
    expect(res.date).toBe('2026-04-30');
    expect(res.rates['EUR']).toBeCloseTo(0.85455, 5);
    expect(res.rates['MXN']).toBeCloseTo(17.5158, 4);

    const sent = new URL(shim.requests[0]!.url);
    expect(sent.pathname).toBe('/v1/latest');
    expect(sent.searchParams.get('base')).toBe(BINDERLY_FX_BASE_CURRENCY);
    expect(sent.searchParams.get('symbols')).toBe([...BINDERLY_FX_QUOTE_CURRENCIES].join(','));
  });

  it('every request carries the configured User-Agent', async () => {
    const client = newClient();
    shim.enqueue('/v1/latest', { status: 200, body: LATEST_BODY });
    await client.getLatest();
    expect(shim.requests[0]?.headers['user-agent']).toBe(UA);
  });

  it('respects custom symbols (empty array drops the param)', async () => {
    const client = newClient();
    shim.enqueue('/v1/latest', { status: 200, body: LATEST_BODY });
    await client.getLatest({ symbols: [] });
    const sent = new URL(shim.requests[0]!.url);
    expect(sent.searchParams.has('symbols')).toBe(false);
  });

  it('schema-mismatch body throws PermanentError', async () => {
    const client = newClient();
    shim.enqueue('/v1/latest', {
      status: 200,
      body: JSON.stringify({ unexpected: 'shape' }),
    });
    await expect(client.getLatest()).rejects.toBeInstanceOf(PermanentError);
  });

  it('malformed JSON body throws PermanentError', async () => {
    const client = newClient();
    shim.enqueue('/v1/latest', { status: 200, body: 'not json {{{' });
    await expect(client.getLatest()).rejects.toBeInstanceOf(PermanentError);
  });

  it('429 with Retry-After is retried by the RateLimitedClient', async () => {
    const client = newClient();
    shim.enqueue(
      '/v1/latest',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: LATEST_BODY },
    );
    const res = await client.getLatest();
    expect(res.date).toBe('2026-04-30');
    expect(shim.requests).toHaveLength(2);
  });

  it('429 retries exhausted surfaces a RateLimitError', async () => {
    const client = newClient();
    shim.enqueue(
      '/v1/latest',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    );
    await expect(client.getLatest()).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('FrankfurterClient — getHistorical', () => {
  it('happy path: hits /v1/{date}', async () => {
    const client = newClient();
    shim.enqueue('/v1/2026-04-29', { status: 200, body: HISTORICAL_BODY });
    const res = await client.getHistorical('2026-04-29');
    expect(res.date).toBe('2026-04-29');
    expect(res.rates['EUR']).toBeCloseTo(0.85426, 5);
  });

  it('404 from too-old date bubbles NotFoundError', async () => {
    const client = newClient();
    shim.enqueue('/v1/1900-01-01', {
      status: 404,
      body: JSON.stringify({ message: 'not found' }),
    });
    await expect(client.getHistorical('1900-01-01')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects malformed date input before any HTTP call', async () => {
    const client = newClient();
    await expect(client.getHistorical('not-a-date' as string)).rejects.toThrow(/invalid ISO date/);
    expect(shim.requests).toHaveLength(0);
  });
});

describe('FrankfurterClient — getRange', () => {
  it('happy path: hits /v1/{from}..{to} and returns a date-keyed map', async () => {
    const client = newClient();
    shim.enqueue('/v1/2026-04-28..2026-04-30', { status: 200, body: RANGE_BODY });
    const res = await client.getRange('2026-04-28', '2026-04-30');
    expect(res.start_date).toBe('2026-04-28');
    expect(res.end_date).toBe('2026-04-30');
    expect(Object.keys(res.rates).sort()).toEqual(['2026-04-28', '2026-04-29', '2026-04-30']);
    expect(res.rates['2026-04-30']?.['JPY']).toBeCloseTo(156.56, 2);
  });

  it('rejects from > to before any HTTP call', async () => {
    const client = newClient();
    await expect(client.getRange('2026-04-30', '2026-04-28')).rejects.toThrow(
      /from \(2026-04-30\) is after to/,
    );
    expect(shim.requests).toHaveLength(0);
  });

  it('schema-mismatch body throws PermanentError', async () => {
    const client = newClient();
    shim.enqueue('/v1/2026-04-28..2026-04-30', {
      status: 200,
      body: JSON.stringify({ amount: 1.0, base: 'USD' }),
    });
    await expect(client.getRange('2026-04-28', '2026-04-30')).rejects.toBeInstanceOf(
      PermanentError,
    );
  });
});

describe('createFrankfurterClient factory', () => {
  it('builds a client with default rate-limit floor + UA when nothing supplied', async () => {
    const client = createFrankfurterClient({
      httpOverrides: { fetchImpl: shim.fetch, sleep: () => Promise.resolve() },
    });
    shim.enqueue('/v1/latest', { status: 200, body: LATEST_BODY });
    const res = await client.getLatest();
    expect(res.base).toBe('USD');
    expect(shim.requests[0]?.headers['user-agent']).toBe(FRANKFURTER_DEFAULT_USER_AGENT);
    expect(FRANKFURTER_DEFAULT_RPS).toBe(1);
    expect(FRANKFURTER_DEFAULT_BURST).toBe(5);
  });

  it('passes through an existing client', async () => {
    const http = new RateLimitedClient({
      host: FRANKFURTER_HOST,
      requestsPerSecond: 50,
      burst: 5,
      userAgent: UA,
      retries: { max: 0, baseDelayMs: 1, factor: 1 },
      fetchImpl: shim.fetch,
      sleep: () => Promise.resolve(),
    });
    const client = createFrankfurterClient({ http });
    shim.enqueue('/v1/latest', { status: 200, body: LATEST_BODY });
    const res = await client.getLatest();
    expect(res.date).toBe('2026-04-30');
    expect(shim.requests[0]?.headers['user-agent']).toBe(UA);
  });
});
