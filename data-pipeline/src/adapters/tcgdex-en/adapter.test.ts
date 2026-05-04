// Integration tests for `TCGdexEnAdapter`. We inject a hand-rolled
// `fetchImpl` shim (same approach as `rate-limited-client.test.ts`)
// to exercise the HTTP layer without leaving the Vitest worker.
//
// Coverage targets:
//   - listSets / listCardsForSet / listPrintingsForCard happy paths
//   - 404 handling: list-shaped methods return [] (not throw); the
//     granular getSet / getCard methods return null
//   - 429 retry path through the RateLimitedClient
//   - Malformed JSON → PermanentError
//   - User-Agent header is set per request

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TCGDEX_DEFAULT_BURST,
  TCGDEX_DEFAULT_RPS,
  TCGDEX_HOST,
  TCGdexEnAdapter,
  createTCGdexEnAdapter,
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

let shim: FetchShim;

beforeEach(() => {
  shim = new FetchShim();
});

afterEach(() => {
  delete process.env['BINDERLY_DATA_PIPELINE_UA'];
});

function newAdapter(over: Partial<ConstructorParameters<typeof RateLimitedClient>[0]> = {}) {
  const http = new RateLimitedClient({
    host: TCGDEX_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
    ...over,
  });
  return new TCGdexEnAdapter({ http });
}

describe('TCGdexEnAdapter — identity', () => {
  it('declares correct name / language / tier', () => {
    const adapter = newAdapter();
    expect(adapter.name).toBe('tcgdex-en');
    expect(adapter.language).toBe('en');
    expect(adapter.tier).toBe('primary');
    expect(adapter.authoritativeFields).toEqual([]);
  });

  it('refuses a RateLimitedClient pinned to a different host', () => {
    const wrongHost = new RateLimitedClient({
      host: 'api.pokemontcg.io',
      requestsPerSecond: 1,
      burst: 1,
      userAgent: UA,
      fetchImpl: shim.fetch,
    });
    expect(() => new TCGdexEnAdapter({ http: wrongHost })).toThrow(/pinned to api\.tcgdex\.net/);
  });
});

describe('TCGdexEnAdapter — listSets', () => {
  it('happy path: fetches /sets then /sets/{id} per brief', async () => {
    const adapter = newAdapter();
    shim
      .enqueue('/v2/en/sets', {
        status: 200,
        body: JSON.stringify([{ id: 'swsh9', name: 'Brilliant Stars' }]),
      })
      .enqueue('/v2/en/sets/swsh9', { status: 200, body: fixture('set.swsh9.json') });
    const sets = await adapter.listSets();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.code).toBe('swsh9');
    expect(sets[0]?.releaseDate).toBe('2022-02-25');
    expect(shim.requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/v2/en/sets',
      '/v2/en/sets/swsh9',
    ]);
  });

  it('404 on /sets list → returns empty array', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/sets', { status: 404 });
    const sets = await adapter.listSets();
    expect(sets).toEqual([]);
  });

  it('404 on a single set during list → that set is silently skipped', async () => {
    const adapter = newAdapter();
    shim
      .enqueue('/v2/en/sets', {
        status: 200,
        body: JSON.stringify([
          { id: 'missing', name: 'Missing Set' },
          { id: 'swsh9', name: 'Brilliant Stars' },
        ]),
      })
      .enqueue('/v2/en/sets/missing', { status: 404 })
      .enqueue('/v2/en/sets/swsh9', { status: 200, body: fixture('set.swsh9.json') });
    const sets = await adapter.listSets();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.code).toBe('swsh9');
  });

  it('non-array body from /sets throws a typed Error', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/sets', { status: 200, body: '{"wat":"this is an object"}' });
    await expect(adapter.listSets()).rejects.toThrow(/expected array/);
  });
});

describe('TCGdexEnAdapter — listCardsForSet', () => {
  it('happy path: fetches /sets/{id} then one /cards/{id} per brief', async () => {
    const adapter = newAdapter();
    // Minimal hand-rolled set with two cards so we don't iterate the
    // full 216-card swsh9 fixture (which would require enqueueing 216
    // mock card responses).
    const miniSet = {
      id: 'swsh9',
      name: 'Brilliant Stars',
      cardCount: { official: 172, total: 216 },
      releaseDate: '2022-02-25',
      serie: { id: 'swsh', name: 'Sword & Shield' },
      cards: [
        { id: 'swsh9-001', localId: '001', name: 'Exeggcute' },
        { id: 'swsh9-018', localId: '018', name: 'Charizard VSTAR' },
      ],
    };
    shim
      .enqueue('/v2/en/sets/swsh9', { status: 200, body: JSON.stringify(miniSet) })
      .enqueue('/v2/en/cards/swsh9-001', { status: 200, body: fixture('card.swsh9-001.json') })
      .enqueue('/v2/en/cards/swsh9-018', { status: 200, body: fixture('card.swsh9-018.json') });
    const cards = await adapter.listCardsForSet('swsh9');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.number).toBe('001');
    expect(cards[1]?.number).toBe('018');
  });

  it('404 on the set itself → returns empty array', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/sets/missing', { status: 404 });
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

describe('TCGdexEnAdapter — listPrintingsForCard', () => {
  it('happy path: fetches /cards/{id} once and returns its printings', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/cards/swsh9-001', { status: 200, body: fixture('card.swsh9-001.json') });
    const printings = await adapter.listPrintingsForCard('swsh9-001');
    expect(printings).toHaveLength(2);
    expect(printings.map((p) => p.cardKey).sort()).toEqual(['swsh9-001', 'swsh9-001']);
  });

  it('404 on /cards/{id} → returns empty array', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/cards/missing-1', { status: 404 });
    const printings = await adapter.listPrintingsForCard('missing-1');
    expect(printings).toEqual([]);
  });

  it('429 with Retry-After is retried by the RateLimitedClient', async () => {
    const adapter = newAdapter();
    shim.enqueue(
      '/v2/en/cards/swsh9-018',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: fixture('card.swsh9-018.json') },
    );
    const printings = await adapter.listPrintingsForCard('swsh9-018');
    expect(printings).toHaveLength(1);
    // Both attempts are recorded.
    expect(shim.requests.filter((r) => r.url.endsWith('/cards/swsh9-018'))).toHaveLength(2);
  });

  it('429 retries exhausted surfaces a RateLimitError', async () => {
    const adapter = newAdapter();
    shim.enqueue(
      '/v2/en/cards/swsh9-018',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    );
    await expect(adapter.listPrintingsForCard('swsh9-018')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('malformed JSON body throws PermanentError', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/cards/swsh9-001', { status: 200, body: 'this is not JSON {{{' });
    await expect(adapter.listPrintingsForCard('swsh9-001')).rejects.toBeInstanceOf(PermanentError);
  });
});

describe('TCGdexEnAdapter — getSet / getCard granular fetches', () => {
  it('getSet returns null on 404', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/sets/missing', { status: 404 });
    expect(await adapter.getSet('missing')).toBeNull();
  });

  it('getCard returns null on 404', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/cards/missing-1', { status: 404 });
    expect(await adapter.getCard('missing-1')).toBeNull();
  });

  it('every request carries the configured User-Agent', async () => {
    const adapter = newAdapter();
    shim.enqueue('/v2/en/cards/swsh9-001', { status: 200, body: fixture('card.swsh9-001.json') });
    await adapter.getCard('swsh9-001');
    expect(shim.requests[0]?.headers['user-agent']).toBe(UA);
  });
});

describe('createTCGdexEnAdapter factory', () => {
  it('builds an adapter with default rate-limit floor when no client is provided', () => {
    process.env['BINDERLY_DATA_PIPELINE_UA'] = UA;
    const adapter = createTCGdexEnAdapter({
      httpOverrides: { fetchImpl: shim.fetch, sleep: () => Promise.resolve() },
    });
    expect(adapter.name).toBe('tcgdex-en');
    // Defaults exposed to callers (per elaboration: 5 rps / burst 10).
    expect(TCGDEX_DEFAULT_RPS).toBe(5);
    expect(TCGDEX_DEFAULT_BURST).toBe(10);
  });

  it('passes through an existing client', async () => {
    const http = new RateLimitedClient({
      host: TCGDEX_HOST,
      requestsPerSecond: 50,
      burst: 5,
      userAgent: UA,
      retries: { max: 0, baseDelayMs: 1, factor: 1 },
      fetchImpl: shim.fetch,
      sleep: () => Promise.resolve(),
    });
    const adapter = createTCGdexEnAdapter({ http });
    shim.enqueue('/v2/en/cards/swsh9-001', { status: 200, body: fixture('card.swsh9-001.json') });
    const printings = await adapter.listPrintingsForCard('swsh9-001');
    expect(printings).toHaveLength(2);
  });
});
