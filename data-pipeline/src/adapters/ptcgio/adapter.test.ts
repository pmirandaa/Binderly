// Integration tests for `PTCGIOAdapter`. We inject a hand-rolled
// `fetchImpl` shim (FetchShim pattern from `tcgdex-en/adapter.test.ts`)
// to exercise the HTTP layer without leaving the Vitest worker.
//
// Coverage targets:
//   - listSets / listCardsForSet / listPrintingsForCard happy paths
//     (with PTCGIO's pagination)
//   - 404 handling: list-shaped methods return [] (not throw); the
//     granular getSet / getCard methods return null
//   - 429 retry path through the RateLimitedClient (and exhaustion
//     surfacing as RateLimitError)
//   - Malformed JSON → PermanentError
//   - User-Agent header is set per request
//   - Optional X-Api-Key header from BINDERLY_PTCGIO_API_KEY env var
//     and from the constructor

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PTCGIO_API_KEY_ENV,
  PTCGIO_DEFAULT_BURST,
  PTCGIO_DEFAULT_RPS,
  PTCGIO_HOST,
  PTCGIO_MAX_PAGE_SIZE,
  PTCGIOAdapter,
  buildQueryUrl,
  createPTCGIOAdapter,
} from './adapter.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { PermanentError, RateLimitError } from '../../interfaces/adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');

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
  /** Map of `path` (URL pathname) to FIFO queue of responses. */
  private readonly queues = new Map<string, ProgrammableResponse[]>();
  /** Default response when no matching path queue exists. */
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

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

/** Wrap a single-resource payload in the PTCGIO `{ data: ... }` envelope. */
function envelope(json: string): string {
  return `{"data":${json}}`;
}

/** Wrap an array payload in the PTCGIO list envelope. */
function listEnvelope(items: unknown[], page = 1, totalCount?: number): string {
  return JSON.stringify({
    data: items,
    page,
    pageSize: PTCGIO_MAX_PAGE_SIZE,
    count: items.length,
    totalCount: totalCount ?? items.length,
  });
}

let shim: FetchShim;

beforeEach(() => {
  shim = new FetchShim();
});

afterEach(() => {
  delete process.env['BINDERLY_DATA_PIPELINE_UA'];
  delete process.env[PTCGIO_API_KEY_ENV];
});

function newAdapter(opts: { apiKey?: string } = {}) {
  const http = new RateLimitedClient({
    host: PTCGIO_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
  });
  const config: ConstructorParameters<typeof PTCGIOAdapter>[0] = { http };
  if (opts.apiKey !== undefined) config.apiKey = opts.apiKey;
  return new PTCGIOAdapter(config);
}

describe('PTCGIOAdapter — identity', () => {
  it('declares correct name / language / tier', () => {
    const adapter = newAdapter();
    expect(adapter.name).toBe('ptcgio');
    expect(adapter.language).toBe('en');
    expect(adapter.tier).toBe('validation');
    expect(adapter.authoritativeFields).toEqual([]);
  });

  it('refuses a RateLimitedClient pinned to a different host', () => {
    const wrongHost = new RateLimitedClient({
      host: 'api.tcgdex.net',
      requestsPerSecond: 1,
      burst: 1,
      userAgent: UA,
      fetchImpl: shim.fetch,
    });
    expect(() => new PTCGIOAdapter({ http: wrongHost })).toThrow(/pinned to api\.pokemontcg\.io/);
  });
});

describe('PTCGIOAdapter — listSets', () => {
  it('happy path: paginates /v2/sets until count < pageSize', async () => {
    const adapter = newAdapter();
    // One page; count==1 < pageSize → terminate after first call.
    shim.enqueue('/v2/sets', {
      status: 200,
      body: listEnvelope([JSON.parse(fixture('set.swsh9.json'))]),
    });
    const sets = await adapter.listSets();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.code).toBe('swsh9');
    expect(sets[0]?.releaseDate).toBe('2022-02-25');
    expect(shim.requests).toHaveLength(1);
    expect(new URL(shim.requests[0]!.url).searchParams.get('page')).toBe('1');
    expect(new URL(shim.requests[0]!.url).searchParams.get('pageSize')).toBe('250');
  });

  it('paginates across multiple pages when count == pageSize', async () => {
    const adapter = newAdapter();
    // Page 1 returns exactly pageSize items → adapter requests page 2.
    const fillerSets = Array.from({ length: PTCGIO_MAX_PAGE_SIZE }, (_, i) => ({
      id: `s${i}`,
      name: `Set ${i}`,
      releaseDate: '2024/01/01',
    }));
    shim.enqueue(
      '/v2/sets',
      { status: 200, body: listEnvelope(fillerSets, 1, PTCGIO_MAX_PAGE_SIZE + 1) },
      {
        status: 200,
        body: listEnvelope(
          [{ id: 'last', name: 'Last', releaseDate: '2024/01/02' }],
          2,
          PTCGIO_MAX_PAGE_SIZE + 1,
        ),
      },
    );
    const sets = await adapter.listSets();
    expect(sets).toHaveLength(PTCGIO_MAX_PAGE_SIZE + 1);
    expect(shim.requests).toHaveLength(2);
    expect(new URL(shim.requests[1]!.url).searchParams.get('page')).toBe('2');
  });

  it('404 on /sets list → returns empty array', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/sets', { status: 404 });
    const sets = await adapter.listSets();
    expect(sets).toEqual([]);
  });
});

describe('PTCGIOAdapter — listCardsForSet', () => {
  it('happy path: paginates /v2/cards?q=set.id:{id}', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards', {
      status: 200,
      body: listEnvelope([
        JSON.parse(fixture('card.swsh9-1.json')),
        JSON.parse(fixture('card.swsh9-18.json')),
      ]),
    });
    const cards = await adapter.listCardsForSet('swsh9');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.number).toBe('1');
    expect(cards[1]?.number).toBe('18');
    const url = new URL(shim.requests[0]!.url);
    expect(url.searchParams.get('q')).toBe('set.id:swsh9');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('pageSize')).toBe('250');
  });

  it('404 on /v2/cards → returns empty array', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards', { status: 404 });
    const cards = await adapter.listCardsForSet('missing');
    expect(cards).toEqual([]);
  });

  it('empty setKey short-circuits to empty array (no HTTP)', async () => {
    const adapter = newAdapter();
    const cards = await adapter.listCardsForSet('');
    expect(cards).toEqual([]);
    expect(shim.requests).toHaveLength(0);
  });
});

describe('PTCGIOAdapter — listPrintingsForCard', () => {
  it('happy path: fetches /v2/cards/{id} once and returns its printings', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards/swsh9-1', {
      status: 200,
      body: envelope(fixture('card.swsh9-1.json')),
    });
    const printings = await adapter.listPrintingsForCard('swsh9-1');
    expect(printings).toHaveLength(2);
    expect(printings.map((p) => p.cardKey).sort()).toEqual(['swsh9-1', 'swsh9-1']);
  });

  it('404 on /v2/cards/{id} → returns empty array', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards/missing-1', { status: 404 });
    const printings = await adapter.listPrintingsForCard('missing-1');
    expect(printings).toEqual([]);
  });

  it('429 with Retry-After is retried by the RateLimitedClient', async () => {
    const adapter = newAdapter();
    shim.enqueue(
      '/v2/cards/swsh9-18',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: envelope(fixture('card.swsh9-18.json')) },
    );
    const printings = await adapter.listPrintingsForCard('swsh9-18');
    expect(printings).toHaveLength(1);
    // Both attempts are recorded.
    expect(shim.requests.filter((r) => r.url.endsWith('/cards/swsh9-18'))).toHaveLength(2);
  });

  it('429 retries exhausted surfaces a RateLimitError', async () => {
    const adapter = newAdapter();
    shim.enqueue(
      '/v2/cards/swsh9-18',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    );
    await expect(adapter.listPrintingsForCard('swsh9-18')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('malformed JSON body throws PermanentError', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards/swsh9-1', { status: 200, body: 'this is not JSON {{{' });
    await expect(adapter.listPrintingsForCard('swsh9-1')).rejects.toBeInstanceOf(PermanentError);
  });
});

describe('PTCGIOAdapter — getSet / getCard granular fetches', () => {
  it('getSet returns null on 404', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/sets/missing', { status: 404 });
    expect(await adapter.getSet('missing')).toBeNull();
  });

  it('getCard returns null on 404', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards/missing-1', { status: 404 });
    expect(await adapter.getCard('missing-1')).toBeNull();
  });

  it('every request carries the configured User-Agent', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards/swsh9-1', {
      status: 200,
      body: envelope(fixture('card.swsh9-1.json')),
    });
    await adapter.getCard('swsh9-1');
    expect(shim.requests[0]?.headers['user-agent']).toBe(UA);
  });
});

describe('PTCGIOAdapter — API key handling', () => {
  it('omits X-Api-Key when no env var and no constructor key', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/cards/swsh9-1', {
      status: 200,
      body: envelope(fixture('card.swsh9-1.json')),
    });
    await adapter.getCard('swsh9-1');
    expect(shim.requests[0]?.headers['x-api-key']).toBeUndefined();
  });

  it('reads BINDERLY_PTCGIO_API_KEY from env when set', async () => {
    process.env[PTCGIO_API_KEY_ENV] = 'env-key-abc';
    const adapter = newAdapter();
    shim.enqueue('/v2/cards/swsh9-1', {
      status: 200,
      body: envelope(fixture('card.swsh9-1.json')),
    });
    await adapter.getCard('swsh9-1');
    expect(shim.requests[0]?.headers['x-api-key']).toBe('env-key-abc');
  });

  it('explicit constructor apiKey wins over env var', async () => {
    process.env[PTCGIO_API_KEY_ENV] = 'env-key-abc';
    const adapter = newAdapter({ apiKey: 'explicit-xyz' });
    shim.enqueue('/v2/cards/swsh9-1', {
      status: 200,
      body: envelope(fixture('card.swsh9-1.json')),
    });
    await adapter.getCard('swsh9-1');
    expect(shim.requests[0]?.headers['x-api-key']).toBe('explicit-xyz');
  });

  it('empty string key is treated as no key', async () => {
    process.env[PTCGIO_API_KEY_ENV] = '';
    const adapter = newAdapter({ apiKey: '' });
    shim.enqueue('/v2/cards/swsh9-1', {
      status: 200,
      body: envelope(fixture('card.swsh9-1.json')),
    });
    await adapter.getCard('swsh9-1');
    expect(shim.requests[0]?.headers['x-api-key']).toBeUndefined();
  });
});

describe('createPTCGIOAdapter factory', () => {
  it('builds an adapter with default rate-limit floor when no client is provided', () => {
    process.env['BINDERLY_DATA_PIPELINE_UA'] = UA;
    const adapter = createPTCGIOAdapter({
      httpOverrides: { fetchImpl: shim.fetch, sleep: () => Promise.resolve() },
    });
    expect(adapter.name).toBe('ptcgio');
    expect(PTCGIO_DEFAULT_RPS).toBe(5);
    expect(PTCGIO_DEFAULT_BURST).toBe(10);
  });

  it('passes through an existing client', async () => {
    const http = new RateLimitedClient({
      host: PTCGIO_HOST,
      requestsPerSecond: 50,
      burst: 5,
      userAgent: UA,
      retries: { max: 0, baseDelayMs: 1, factor: 1 },
      fetchImpl: shim.fetch,
      sleep: () => Promise.resolve(),
    });
    const adapter = createPTCGIOAdapter({ http });
    shim.enqueue('/v2/cards/swsh9-1', {
      status: 200,
      body: envelope(fixture('card.swsh9-1.json')),
    });
    const printings = await adapter.listPrintingsForCard('swsh9-1');
    expect(printings).toHaveLength(2);
  });
});

describe('buildQueryUrl', () => {
  it('appends params to a path with no existing search', () => {
    expect(buildQueryUrl('/v2/cards', { q: 'set.id:swsh9', page: '1' })).toBe(
      '/v2/cards?q=set.id%3Aswsh9&page=1',
    );
  });

  it('appends params to a path with existing search', () => {
    expect(buildQueryUrl('/v2/cards?orderBy=number', { page: '2' })).toBe(
      '/v2/cards?orderBy=number&page=2',
    );
  });

  it('returns the path unchanged when params is empty', () => {
    expect(buildQueryUrl('/v2/cards', {})).toBe('/v2/cards');
  });
});
