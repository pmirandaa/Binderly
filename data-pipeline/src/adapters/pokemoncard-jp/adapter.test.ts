// Integration tests for `PokemonCardJpAdapter`. We inject a hand-rolled
// `fetchImpl` shim (same approach as the EN/JP TCGdex adapter tests
// and `rate-limited-client.test.ts`) so we never leave the Vitest
// worker. The adapter speaks HTML, so fixtures live in `./fixtures/`
// as `.html` strings.
//
// Coverage targets:
//   - identity: name / language / tier / authoritativeFields
//   - getSet / getCard happy paths
//   - 404 → returns null on granular fetches
//   - HTTP 200 with a "card not found" body shape → null
//   - 429 retry path through the RateLimitedClient
//   - listPrintingsForCard happy path returns the parsed printing
//   - User-Agent header is set per request
//   - listSets() / listCardsForSet() are no-ops (return [])

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  POKEMONCARD_JP_DEFAULT_BURST,
  POKEMONCARD_JP_DEFAULT_RPS,
  POKEMONCARD_JP_DEFAULT_UA,
  POKEMONCARD_JP_HOST,
  PokemonCardJpAdapter,
  createPokemonCardJpAdapter,
} from './adapter.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { RateLimitError } from '../../interfaces/adapter.js';

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
    const respHeaders: Record<string, string> = { 'content-type': 'text/html; charset=UTF-8' };
    if (next.headers) {
      for (const [k, v] of Object.entries(next.headers)) {
        respHeaders[k.toLowerCase()] = v;
      }
    }
    return new Response(next.body ?? '', { status: next.status, headers: respHeaders });
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
    host: POKEMONCARD_JP_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
    ...over,
  });
  return new PokemonCardJpAdapter({ http });
}

describe('PokemonCardJpAdapter — identity', () => {
  it('declares correct name / language / tier', () => {
    const adapter = newAdapter();
    expect(adapter.name).toBe('pokemoncard-jp');
    expect(adapter.language).toBe('jp');
    expect(adapter.tier).toBe('filler');
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
    expect(() => new PokemonCardJpAdapter({ http: wrongHost })).toThrow(
      /pinned to www\.pokemon-card\.com/,
    );
  });

  it('exposes the documented strict-scraping defaults', () => {
    expect(POKEMONCARD_JP_DEFAULT_RPS).toBe(1);
    expect(POKEMONCARD_JP_DEFAULT_BURST).toBe(1);
    expect(POKEMONCARD_JP_DEFAULT_UA).toBe(
      'binderly-data-pipeline/1.0 (+https://github.com/pmirandaa/Binderly)',
    );
  });
});

describe('PokemonCardJpAdapter — list-shaped methods are filler-tier no-ops', () => {
  it('listSets returns []', async () => {
    const adapter = newAdapter();
    expect(await adapter.listSets()).toEqual([]);
    expect(shim.requests).toHaveLength(0);
  });

  it('listCardsForSet returns []', async () => {
    const adapter = newAdapter();
    expect(await adapter.listCardsForSet('anything')).toEqual([]);
    expect(shim.requests).toHaveLength(0);
  });

  it('listPrintingsForCard short-circuits on empty cardKey', async () => {
    const adapter = newAdapter();
    expect(await adapter.listPrintingsForCard('')).toEqual([]);
    expect(shim.requests).toHaveLength(0);
  });
});

describe('PokemonCardJpAdapter — getSet', () => {
  it('happy path: fetches /card-search/index.php with the set id', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/index.php', { status: 200, body: fixture('set.sv1s.html') });
    const set = await adapter.getSet('3186');
    expect(set).not.toBeNull();
    expect(set?.shortCode).toBe('SV1S');
    expect(set?.releaseDate).toBe('2023-03-10');
    expect(shim.requests[0]?.url).toContain('regulation_sidebar_form=3186');
  });

  it('404 → returns null', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/index.php', { status: 404 });
    expect(await adapter.getSet('999999')).toBeNull();
  });

  it('empty pcjpSetId short-circuits', async () => {
    const adapter = newAdapter();
    expect(await adapter.getSet('')).toBeNull();
    expect(shim.requests).toHaveLength(0);
  });

  it('unparseable body returns null (not throw)', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/index.php', {
      status: 200,
      body: '<html><body>not the page you expected</body></html>',
    });
    expect(await adapter.getSet('3186')).toBeNull();
  });
});

describe('PokemonCardJpAdapter — getCard', () => {
  it('happy path: fetches /card-search/details.php?id={id}', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', {
      status: 200,
      body: fixture('card.sv1s-198-sar.html'),
    });
    const card = await adapter.getCard('46892');
    expect(card).not.toBeNull();
    expect(card?.name).toBe('ニャオハ');
    expect(card?.rarityLabel).toBe('Special Art Rare');
    expect(shim.requests[0]?.url).toContain('id=46892');
  });

  it('404 → returns null', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', { status: 404 });
    expect(await adapter.getCard('999999')).toBeNull();
  });

  it('200 with "card not found" body → returns null (no throw)', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', {
      status: 200,
      body: fixture('card.notfound.html'),
    });
    expect(await adapter.getCard('999999')).toBeNull();
  });

  it('429 with Retry-After is retried by the RateLimitedClient', async () => {
    const adapter = newAdapter();
    shim.enqueue(
      '/card-search/details.php',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: fixture('card.sv1s-198-sar.html') },
    );
    const card = await adapter.getCard('46892');
    expect(card).not.toBeNull();
    expect(shim.requests).toHaveLength(2);
  });

  it('429 retries exhausted surfaces a RateLimitError', async () => {
    const adapter = newAdapter();
    shim.enqueue(
      '/card-search/details.php',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    );
    await expect(adapter.getCard('46892')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('every request carries the configured User-Agent', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', {
      status: 200,
      body: fixture('card.sv1s-198-sar.html'),
    });
    await adapter.getCard('46892');
    expect(shim.requests[0]?.headers['user-agent']).toBe(UA);
  });
});

describe('PokemonCardJpAdapter — listPrintingsForCard', () => {
  it('happy path: parses the card and returns its single printing', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', {
      status: 200,
      body: fixture('card.sv1s-198-sar.html'),
    });
    const printings = await adapter.listPrintingsForCard('46892');
    expect(printings).toHaveLength(1);
    expect(printings[0]?.cardKey).toBe('46892');
    expect(printings[0]?.sourceKey).toBe('46892-sar');
    expect(printings[0]?.isAltArt).toBe(true);
  });

  it('404 → returns []', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', { status: 404 });
    expect(await adapter.listPrintingsForCard('999999')).toEqual([]);
  });

  it('"card not found" body → returns []', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', {
      status: 200,
      body: fixture('card.notfound.html'),
    });
    expect(await adapter.listPrintingsForCard('999999')).toEqual([]);
  });
});

describe('PokemonCardJpAdapter — getRawSet / getRawCard convenience', () => {
  it('getRawSet returns a RawSet shape directly', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/index.php', { status: 200, body: fixture('set.sv1s.html') });
    const raw = await adapter.getRawSet('3186');
    expect(raw?.source).toBe('pokemoncard-jp');
    expect(raw?.code).toBe('sv1s');
    expect(raw?.language).toBe('jp');
  });

  it('getRawCard returns a RawCard shape directly', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', {
      status: 200,
      body: fixture('card.sv1s-198-sar.html'),
    });
    const raw = await adapter.getRawCard('46892');
    expect(raw?.source).toBe('pokemoncard-jp');
    expect(raw?.setCode).toBe('sv1s');
    expect(raw?.number).toBe('198');
  });

  it('getRawSet returns null on missing source data', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/index.php', { status: 404 });
    expect(await adapter.getRawSet('999999')).toBeNull();
  });

  it('getRawCard returns null on missing source data', async () => {
    const adapter = newAdapter();
    shim.enqueue('/card-search/details.php', { status: 404 });
    expect(await adapter.getRawCard('999999')).toBeNull();
  });
});

describe('createPokemonCardJpAdapter factory', () => {
  it('builds an adapter with strict polite-scraper defaults', () => {
    process.env['BINDERLY_DATA_PIPELINE_UA'] = UA;
    const adapter = createPokemonCardJpAdapter({
      httpOverrides: { fetchImpl: shim.fetch, sleep: () => Promise.resolve() },
    });
    expect(adapter.name).toBe('pokemoncard-jp');
    expect(adapter.tier).toBe('filler');
  });

  it('passes through an existing client', async () => {
    const http = new RateLimitedClient({
      host: POKEMONCARD_JP_HOST,
      requestsPerSecond: 50,
      burst: 5,
      userAgent: UA,
      retries: { max: 0, baseDelayMs: 1, factor: 1 },
      fetchImpl: shim.fetch,
      sleep: () => Promise.resolve(),
    });
    const adapter = createPokemonCardJpAdapter({ http });
    shim.enqueue('/card-search/details.php', {
      status: 200,
      body: fixture('card.sv1s-198-sar.html'),
    });
    const printings = await adapter.listPrintingsForCard('46892');
    expect(printings).toHaveLength(1);
  });
});
