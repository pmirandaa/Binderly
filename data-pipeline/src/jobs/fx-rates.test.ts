// Unit tests for `runFxRatesIngest`.
//
// We exercise the runner end-to-end with a FetchShim-backed
// FrankfurterClient and the in-memory repo. The Frankfurter HTTP
// surface itself is covered by `adapters/fx/frankfurter.test.ts`;
// these tests focus on:
//
//   - Mode selection (latest / single / range / mutually-exclusive)
//   - Idempotency on re-run
//   - Per-symbol partial-failure reporting
//   - Range happy path: holes (weekends) skipped without erroring
//   - 404 on a single date / a range bubbles correctly
//   - Report shape

import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryFxRateRepo, runFxRatesIngest } from './fx-rates.js';
import { FRANKFURTER_HOST, FRANKFURTER_SOURCE, FrankfurterClient } from '../adapters/fx/index.js';
import { RateLimitedClient } from '../http/rate-limited-client.js';
import { NotFoundError } from '../interfaces/adapter.js';

const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

interface ProgrammableResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

class FetchShim {
  readonly requests: { url: string }[] = [];
  private readonly queues = new Map<string, ProgrammableResponse[]>();

  enqueue(pathname: string, ...responses: ProgrammableResponse[]): this {
    const list = this.queues.get(pathname) ?? [];
    list.push(...responses);
    this.queues.set(pathname, list);
    return this;
  }

  readonly fetch = async (input: string | URL): Promise<Response> => {
    const url = input.toString();
    this.requests.push({ url });
    const pathname = new URL(url).pathname;
    const queue = this.queues.get(pathname);
    const next = queue?.shift();
    if (!next) throw new Error(`FetchShim: no programmed response for ${pathname}`);
    return new Response(next.body ?? '', { status: next.status, headers: next.headers });
  };
}

let shim: FetchShim;

beforeEach(() => {
  shim = new FetchShim();
});

function newClient(): FrankfurterClient {
  const http = new RateLimitedClient({
    host: FRANKFURTER_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 1, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
  });
  return new FrankfurterClient({ http });
}

function fixedClock(iso: string): () => Date {
  const date = new Date(iso);
  return () => date;
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

const SINGLE_BODY_2026_04_29 = JSON.stringify({
  amount: 1.0,
  base: 'USD',
  date: '2026-04-29',
  rates: {
    AUD: 1.4,
    CAD: 1.37,
    EUR: 0.85426,
    GBP: 0.74016,
    JPY: 159.79,
    MXN: 17.5,
  },
});

const RANGE_BODY = JSON.stringify({
  amount: 1.0,
  base: 'USD',
  start_date: '2026-04-28',
  end_date: '2026-04-30',
  rates: {
    '2026-04-28': {
      AUD: 1.41,
      CAD: 1.38,
      EUR: 0.85616,
      GBP: 0.74242,
      JPY: 159.74,
      MXN: 17.6,
    },
    '2026-04-29': {
      AUD: 1.4,
      CAD: 1.37,
      EUR: 0.85426,
      GBP: 0.74016,
      JPY: 159.79,
      MXN: 17.5,
    },
    '2026-04-30': {
      AUD: 1.399,
      CAD: 1.3668,
      EUR: 0.85455,
      GBP: 0.74026,
      JPY: 156.56,
      MXN: 17.5158,
    },
  },
});

describe('runFxRatesIngest — mode selection', () => {
  it('throws when no mode is provided', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    await expect(runFxRatesIngest({ client, repo })).rejects.toThrow(/exactly one of/);
  });

  it('throws when latest + date are both set', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    await expect(
      runFxRatesIngest({ client, repo, latest: true, date: '2026-04-30' }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('throws when range mode is missing toDate', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    await expect(runFxRatesIngest({ client, repo, fromDate: '2026-04-28' })).rejects.toThrow(
      /requires both fromDate and toDate/,
    );
  });
});

describe('runFxRatesIngest — latest', () => {
  it('writes 6 rows (one per Binderly quote currency)', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/latest', { status: 200, body: LATEST_BODY });

    const report = await runFxRatesIngest({
      client,
      repo,
      latest: true,
      now: fixedClock('2026-05-01T09:00:00Z'),
    });

    expect(report.source).toBe(FRANKFURTER_SOURCE);
    expect(report.rangeRequested).toEqual({ kind: 'latest' });
    expect(report.datesFetched).toEqual(['2026-04-30']);
    expect(report.ratesFetched).toBe(6);
    expect(report.ratesUpserted).toBe(6);
    expect(report.errors).toEqual([]);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    expect(repo.size()).toBe(6);
    const rows = repo.list();
    expect(rows.map((r) => r.quoteCurrency)).toEqual(['AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'MXN']);
    expect(rows.every((r) => r.baseCurrency === 'USD')).toBe(true);
    expect(rows.every((r) => r.rateDate === '2026-04-30')).toBe(true);
    expect(rows.every((r) => r.source === 'frankfurter')).toBe(true);
    expect(rows[2]?.rate).toBe('0.854550'); // EUR, 6dp
    expect(rows.every((r) => r.fetchedAt.toISOString() === '2026-05-01T09:00:00.000Z')).toBe(true);
  });

  it('is idempotent on re-run (PK-keyed map; no duplicates)', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim
      .enqueue('/v1/latest', { status: 200, body: LATEST_BODY })
      .enqueue('/v1/latest', { status: 200, body: LATEST_BODY });

    await runFxRatesIngest({ client, repo, latest: true });
    expect(repo.size()).toBe(6);
    const second = await runFxRatesIngest({ client, repo, latest: true });
    expect(repo.size()).toBe(6);
    expect(second.ratesUpserted).toBe(6);
  });
});

describe('runFxRatesIngest — single date', () => {
  it('writes 6 rows for the requested date', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/2026-04-29', { status: 200, body: SINGLE_BODY_2026_04_29 });

    const report = await runFxRatesIngest({
      client,
      repo,
      date: '2026-04-29',
      now: fixedClock('2026-05-01T09:00:00Z'),
    });

    expect(report.rangeRequested).toEqual({ kind: 'single', date: '2026-04-29' });
    expect(report.datesFetched).toEqual(['2026-04-29']);
    expect(report.ratesUpserted).toBe(6);
    expect(repo.list().every((r) => r.rateDate === '2026-04-29')).toBe(true);
  });

  it('persists on Frankfurter-returned date when weekend remaps to a Friday', async () => {
    // Caller asks for Saturday 2026-05-02; Frankfurter returns Friday's
    // rates with `date: '2026-05-01'`. The runner stores that.
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/2026-05-02', {
      status: 200,
      body: JSON.stringify({
        amount: 1.0,
        base: 'USD',
        date: '2026-05-01',
        rates: { EUR: 0.85, GBP: 0.74, JPY: 156, AUD: 1.4, CAD: 1.36, MXN: 17.5 },
      }),
    });
    const report = await runFxRatesIngest({
      client,
      repo,
      date: '2026-05-02',
      now: fixedClock('2026-05-04T09:00:00Z'),
    });
    expect(report.datesFetched).toEqual(['2026-05-01']);
    expect(repo.list().every((r) => r.rateDate === '2026-05-01')).toBe(true);
  });

  it('records partial failure for a missing currency without aborting', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/2026-04-29', {
      status: 200,
      body: JSON.stringify({
        amount: 1.0,
        base: 'USD',
        date: '2026-04-29',
        // Missing MXN intentionally
        rates: {
          AUD: 1.4,
          CAD: 1.37,
          EUR: 0.85426,
          GBP: 0.74016,
          JPY: 159.79,
        },
      }),
    });
    const report = await runFxRatesIngest({ client, repo, date: '2026-04-29' });
    expect(report.ratesFetched).toBe(5);
    expect(report.ratesUpserted).toBe(5);
    expect(report.errors).toEqual([
      {
        rateDate: '2026-04-29',
        quoteCurrency: 'MXN',
        message: 'frankfurter: missing or invalid rate for MXN on 2026-04-29',
      },
    ]);
  });

  it('re-throws NotFoundError when the date is too old', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/1900-01-01', {
      status: 404,
      body: JSON.stringify({ message: 'not found' }),
    });
    await expect(runFxRatesIngest({ client, repo, date: '1900-01-01' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(repo.size()).toBe(0);
  });
});

describe('runFxRatesIngest — range', () => {
  it('writes one set per business day in the range', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/2026-04-28..2026-04-30', { status: 200, body: RANGE_BODY });

    const report = await runFxRatesIngest({
      client,
      repo,
      fromDate: '2026-04-28',
      toDate: '2026-04-30',
      now: fixedClock('2026-05-01T09:00:00Z'),
    });

    expect(report.rangeRequested).toEqual({
      kind: 'range',
      fromDate: '2026-04-28',
      toDate: '2026-04-30',
    });
    expect(report.datesFetched).toEqual(['2026-04-28', '2026-04-29', '2026-04-30']);
    expect(report.ratesFetched).toBe(18);
    expect(report.ratesUpserted).toBe(18);
    expect(repo.size()).toBe(18);
  });

  it('handles a range that returns no data (404) as a recoverable error', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/1899-01-01..1899-01-03', {
      status: 404,
      body: JSON.stringify({ message: 'not found' }),
    });

    const report = await runFxRatesIngest({
      client,
      repo,
      fromDate: '1899-01-01',
      toDate: '1899-01-03',
    });

    expect(report.datesFetched).toEqual([]);
    expect(report.ratesUpserted).toBe(0);
    expect(report.errors).toEqual([
      {
        rateDate: '1899-01-01..1899-01-03',
        quoteCurrency: '*',
        message: 'frankfurter: 404 for range 1899-01-01..1899-01-03',
      },
    ]);
    expect(repo.size()).toBe(0);
  });

  it('skips dates absent from the range response (weekend holes)', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    // Three-day window where 2026-04-29 is missing entirely.
    shim.enqueue('/v1/2026-04-28..2026-04-30', {
      status: 200,
      body: JSON.stringify({
        amount: 1.0,
        base: 'USD',
        start_date: '2026-04-28',
        end_date: '2026-04-30',
        rates: {
          '2026-04-28': {
            AUD: 1.41,
            CAD: 1.38,
            EUR: 0.85616,
            GBP: 0.74242,
            JPY: 159.74,
            MXN: 17.6,
          },
          '2026-04-30': {
            AUD: 1.399,
            CAD: 1.3668,
            EUR: 0.85455,
            GBP: 0.74026,
            JPY: 156.56,
            MXN: 17.5158,
          },
        },
      }),
    });

    const report = await runFxRatesIngest({
      client,
      repo,
      fromDate: '2026-04-28',
      toDate: '2026-04-30',
    });
    expect(report.datesFetched).toEqual(['2026-04-28', '2026-04-30']);
    expect(report.ratesUpserted).toBe(12);
    expect(report.errors).toEqual([]);
  });
});

describe('runFxRatesIngest — symbol overrides', () => {
  it('respects a custom symbols list', async () => {
    const client = newClient();
    const repo = new InMemoryFxRateRepo();
    shim.enqueue('/v1/latest', {
      status: 200,
      body: JSON.stringify({
        amount: 1.0,
        base: 'USD',
        date: '2026-04-30',
        rates: { EUR: 0.85, GBP: 0.74 },
      }),
    });
    const report = await runFxRatesIngest({
      client,
      repo,
      latest: true,
      symbols: ['EUR', 'GBP'],
    });
    expect(report.ratesFetched).toBe(2);
    expect(report.ratesUpserted).toBe(2);
    expect(repo.list().map((r) => r.quoteCurrency)).toEqual(['EUR', 'GBP']);
  });
});
