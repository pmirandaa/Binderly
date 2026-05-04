// Integration tests for `BulbapediaAdapter`. Mirrors the canonical
// FetchShim pattern from `tcgdex-en/adapter.test.ts`.
//
// Coverage:
//   - identity (name / language / tier / authoritativeFields)
//   - host pinning
//   - listSets is intentionally empty (filler tier; primary owns enumeration)
//   - listCardsForSet happy path (categorymembers → titles → wikitext per card)
//   - listPrintingsForCard happy / 404 / MediaWiki missing-page paths
//   - getSet / getCard granular fetches (null on 404 / missing / invalid)
//   - 429 retry / retry-exhaustion via the RateLimitedClient
//   - User-Agent header is set per request
//   - Empty / blank inputs short-circuit to empty arrays / null
//   - PermanentError when MediaWiki returns no `pages` array

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BULBAPEDIA_DEFAULT_BURST,
  BULBAPEDIA_DEFAULT_RPS,
  BULBAPEDIA_HOST,
  BulbapediaAdapter,
  createBulbapediaAdapter,
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
  /** Map of `path` (URL pathname only — `?query` is matched by the
   *  `query` predicate when provided) to FIFO queue of responses. */
  private readonly queues = new Map<string, ProgrammableResponse[]>();
  /** Default response when no matching path queue exists. */
  defaultResponse: ProgrammableResponse | null = null;
  /**
   * Predicate that selects the next queue when many request-paths
   * collapse to one URL pathname (every Bulbapedia request goes
   * through `/w/api.php`). The predicate inspects the query string to
   * choose. Falls back to FIFO across all responses when no
   * predicate matches.
   */
  matchByQuery: ((searchParams: URLSearchParams) => string | null) | null = null;

  enqueue(key: string, ...responses: ProgrammableResponse[]): this {
    const list = this.queues.get(key) ?? [];
    list.push(...responses);
    this.queues.set(key, list);
    return this;
  }

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.requests.push({ url, method: init?.method ?? 'GET', headers });
    const u = new URL(url);
    let queueKey: string | null = null;
    if (this.matchByQuery) queueKey = this.matchByQuery(u.searchParams);
    if (!queueKey) queueKey = u.pathname;
    const queue = this.queues.get(queueKey);
    let next: ProgrammableResponse | undefined;
    if (queue && queue.length > 0) next = queue.shift();
    if (!next) next = this.defaultResponse ?? undefined;
    if (!next) {
      throw new Error(`FetchShim: no programmed response for ${queueKey} (url=${url})`);
    }
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
    host: BULBAPEDIA_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
    ...over,
  });
  return new BulbapediaAdapter({ http });
}

/**
 * Configure the shim to dispatch by MediaWiki action. Bulbapedia
 * routes everything through `/w/api.php` so we look at query params
 * to decide which fixture to serve. Returns the queue keys so tests
 * can enqueue against them.
 */
function dispatchByAction() {
  shim.matchByQuery = (sp) => {
    const action = sp.get('action');
    if (action !== 'query') return null;
    const titles = sp.get('titles');
    if (titles) return `revisions:${titles}`;
    const cmtitle = sp.get('cmtitle');
    const cmcontinue = sp.get('cmcontinue');
    if (cmtitle)
      return cmcontinue ? `categorymembers:${cmtitle}:${cmcontinue}` : `categorymembers:${cmtitle}`;
    return null;
  };
}

// ============================================================
// Identity
// ============================================================

describe('BulbapediaAdapter — identity', () => {
  it('declares name=bulbapedia-en, language=en, tier=filler', () => {
    const adapter = newAdapter();
    expect(adapter.name).toBe('bulbapedia-en');
    expect(adapter.language).toBe('en');
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
    expect(() => new BulbapediaAdapter({ http: wrongHost })).toThrow(
      /pinned to bulbapedia\.bulbagarden\.net/,
    );
  });

  it('throws when constructed without an http client', () => {
    expect(() => new BulbapediaAdapter({} as never)).toThrow(/RateLimitedClient/);
  });
});

// ============================================================
// listSets
// ============================================================

describe('BulbapediaAdapter — listSets', () => {
  it('returns [] without making any HTTP request (filler tier)', async () => {
    const adapter = newAdapter();
    const sets = await adapter.listSets();
    expect(sets).toEqual([]);
    expect(shim.requests).toHaveLength(0);
  });
});

// ============================================================
// listCardsForSet
// ============================================================

describe('BulbapediaAdapter — listCardsForSet', () => {
  it('happy path: categorymembers → revisions per card → RawCard[]', async () => {
    dispatchByAction();
    shim
      .enqueue('categorymembers:Category:Brilliant Stars', {
        status: 200,
        body: fixture('categorymembers.brilliant-stars.json'),
      })
      .enqueue('revisions:Charizard VSTAR (Brilliant Stars 174)', {
        status: 200,
        body: fixture('revisions.charizard-vstar-rainbow.json'),
      })
      .enqueue('revisions:Pikachu (Brilliant Stars 49)', {
        status: 200,
        // We re-use the rainbow fixture with the title overridden by
        // MediaWiki's own canonical title. To keep the test focused
        // on the wiring, we just respond with a missing page so the
        // adapter skips it.
        body: fixture('revisions.missing-page.json'),
      });
    const adapter = newAdapter();
    const cards = await adapter.listCardsForSet('Brilliant Stars (TCG)');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.sourceKey).toBe('Charizard VSTAR (Brilliant Stars 174)');
    expect(cards[0]?.setCode).toBe('swsh9');
  });

  it('strips the (TCG) suffix from the set key when computing the category title', async () => {
    dispatchByAction();
    shim.enqueue('categorymembers:Category:Brilliant Stars', {
      status: 200,
      body: JSON.stringify({ batchcomplete: true, query: { categorymembers: [] } }),
    });
    const adapter = newAdapter();
    await adapter.listCardsForSet('Brilliant Stars (TCG)');
    const u = new URL(shim.requests[0]!.url);
    expect(u.searchParams.get('cmtitle')).toBe('Category:Brilliant Stars');
  });

  it('passes through Category-prefixed keys verbatim', async () => {
    dispatchByAction();
    shim.enqueue('categorymembers:Category:Promo cards from Brilliant Stars', {
      status: 200,
      body: JSON.stringify({ batchcomplete: true, query: { categorymembers: [] } }),
    });
    const adapter = newAdapter();
    await adapter.listCardsForSet('Category:Promo cards from Brilliant Stars');
    expect(shim.requests).toHaveLength(1);
  });

  it('empty setKey short-circuits to []', async () => {
    const adapter = newAdapter();
    expect(await adapter.listCardsForSet('')).toEqual([]);
    expect(shim.requests).toHaveLength(0);
  });

  it('404 on the categorymembers endpoint → []', async () => {
    dispatchByAction();
    shim.enqueue('categorymembers:Category:Missing Set', { status: 404 });
    const adapter = newAdapter();
    const cards = await adapter.listCardsForSet('Missing Set (TCG)');
    expect(cards).toEqual([]);
  });

  it('paginates through cmcontinue and stops when the token is absent', async () => {
    dispatchByAction();
    const page1 = JSON.stringify({
      batchcomplete: true,
      query: {
        categorymembers: [{ pageid: 1, ns: 0, title: 'A (Brilliant Stars 1)' }],
      },
      continue: { cmcontinue: 'token-1' },
    });
    const page2 = JSON.stringify({
      batchcomplete: true,
      query: {
        categorymembers: [{ pageid: 2, ns: 0, title: 'B (Brilliant Stars 2)' }],
      },
    });
    shim
      .enqueue('categorymembers:Category:Brilliant Stars', { status: 200, body: page1 })
      .enqueue('categorymembers:Category:Brilliant Stars:token-1', { status: 200, body: page2 })
      .enqueue('revisions:A (Brilliant Stars 1)', {
        status: 200,
        body: fixture('revisions.missing-page.json'),
      })
      .enqueue('revisions:B (Brilliant Stars 2)', {
        status: 200,
        body: fixture('revisions.missing-page.json'),
      });
    const adapter = newAdapter();
    const cards = await adapter.listCardsForSet('Brilliant Stars (TCG)');
    expect(cards).toEqual([]);
    // Both list pages and both revision lookups were attempted.
    expect(shim.requests).toHaveLength(4);
  });
});

// ============================================================
// listPrintingsForCard
// ============================================================

describe('BulbapediaAdapter — listPrintingsForCard', () => {
  it('happy path: returns 3 printings for vintage Charizard', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Charizard (Base Set 4)', {
      status: 200,
      body: fixture('revisions.charizard-base-set-4.json'),
    });
    const adapter = newAdapter();
    const printings = await adapter.listPrintingsForCard('Charizard (Base Set 4)');
    expect(printings).toHaveLength(3);
    expect(printings.every((p) => p.cardKey === 'Charizard (Base Set 4)')).toBe(true);
  });

  it('404 → []', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Missing (Page 1)', { status: 404 });
    const adapter = newAdapter();
    expect(await adapter.listPrintingsForCard('Missing (Page 1)')).toEqual([]);
  });

  it('MediaWiki missing-page (200 with `missing: true`) → []', async () => {
    dispatchByAction();
    shim.enqueue('revisions:NonexistentCard (Made Up Set 999)', {
      status: 200,
      body: fixture('revisions.missing-page.json'),
    });
    const adapter = newAdapter();
    expect(await adapter.listPrintingsForCard('NonexistentCard (Made Up Set 999)')).toEqual([]);
  });

  it('MediaWiki invalid-title (200 with `invalid: true`) → []', async () => {
    dispatchByAction();
    shim.enqueue('revisions:<not a valid title>', {
      status: 200,
      body: fixture('revisions.invalid-title.json'),
    });
    const adapter = newAdapter();
    expect(await adapter.listPrintingsForCard('<not a valid title>')).toEqual([]);
  });

  it('429 retried by the RateLimitedClient and eventually succeeds', async () => {
    dispatchByAction();
    shim.enqueue(
      'revisions:Charizard (Base Set 4)',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: fixture('revisions.charizard-base-set-4.json') },
    );
    const adapter = newAdapter();
    const printings = await adapter.listPrintingsForCard('Charizard (Base Set 4)');
    expect(printings).toHaveLength(3);
    expect(shim.requests).toHaveLength(2);
  });

  it('429 retries exhausted → RateLimitError', async () => {
    dispatchByAction();
    shim.enqueue(
      'revisions:Charizard (Base Set 4)',
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    );
    const adapter = newAdapter();
    await expect(adapter.listPrintingsForCard('Charizard (Base Set 4)')).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('malformed wikitext (no recognized templates) → []', async () => {
    dispatchByAction();
    const body = JSON.stringify({
      batchcomplete: true,
      query: {
        pages: [
          {
            pageid: 1,
            ns: 0,
            title: 'Garbled (No Set 1)',
            revisions: [{ slots: { main: { content: 'just plain prose with no infobox' } } }],
          },
        ],
      },
    });
    shim.enqueue('revisions:Garbled (No Set 1)', { status: 200, body });
    const adapter = newAdapter();
    expect(await adapter.listPrintingsForCard('Garbled (No Set 1)')).toEqual([]);
  });

  it('empty cardKey short-circuits to []', async () => {
    const adapter = newAdapter();
    expect(await adapter.listPrintingsForCard('')).toEqual([]);
    expect(shim.requests).toHaveLength(0);
  });

  it('PermanentError when MediaWiki returns no `query.pages` array', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Foo (Bar 1)', {
      status: 200,
      body: JSON.stringify({ batchcomplete: true, query: {} }),
    });
    const adapter = newAdapter();
    await expect(adapter.listPrintingsForCard('Foo (Bar 1)')).rejects.toBeInstanceOf(
      PermanentError,
    );
  });
});

// ============================================================
// getSet / getCard granular
// ============================================================

describe('BulbapediaAdapter — getSet / getCard', () => {
  it('getSet happy path returns RawSet', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Base Set (TCG)', {
      status: 200,
      body: fixture('revisions.set-base-set.json'),
    });
    const adapter = newAdapter();
    const set = await adapter.getSet('Base Set (TCG)');
    expect(set?.code).toBe('base1');
    expect(set?.releaseDate).toBe('1999-01-09');
  });

  it('getSet returns null on 404', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Missing (TCG)', { status: 404 });
    const adapter = newAdapter();
    expect(await adapter.getSet('Missing (TCG)')).toBeNull();
  });

  it('getSet returns null on MediaWiki missing-page', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Nonexistent (TCG)', {
      status: 200,
      body: fixture('revisions.missing-page.json'),
    });
    const adapter = newAdapter();
    expect(await adapter.getSet('Nonexistent (TCG)')).toBeNull();
  });

  it('getCard happy path returns RawCard', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Charizard (Base Set 4)', {
      status: 200,
      body: fixture('revisions.charizard-base-set-4.json'),
    });
    const adapter = newAdapter();
    const card = await adapter.getCard('Charizard (Base Set 4)');
    expect(card?.name).toBe('Charizard');
    expect(card?.setCode).toBe('base1');
    expect(card?.number).toBe('004');
  });

  it('getCard returns null on 404', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Missing Card (No Set 1)', { status: 404 });
    const adapter = newAdapter();
    expect(await adapter.getCard('Missing Card (No Set 1)')).toBeNull();
  });

  it('getSet / getCard return null on empty input without HTTP', async () => {
    const adapter = newAdapter();
    expect(await adapter.getSet('')).toBeNull();
    expect(await adapter.getCard('')).toBeNull();
    expect(shim.requests).toHaveLength(0);
  });

  it('every request carries the configured User-Agent', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Base Set (TCG)', {
      status: 200,
      body: fixture('revisions.set-base-set.json'),
    });
    const adapter = newAdapter();
    await adapter.getSet('Base Set (TCG)');
    expect(shim.requests[0]?.headers['user-agent']).toBe(UA);
  });
});

// ============================================================
// createBulbapediaAdapter factory
// ============================================================

describe('createBulbapediaAdapter factory', () => {
  it('builds an adapter with conservative defaults', () => {
    process.env['BINDERLY_DATA_PIPELINE_UA'] = UA;
    const adapter = createBulbapediaAdapter({
      httpOverrides: { fetchImpl: shim.fetch, sleep: () => Promise.resolve() },
    });
    expect(adapter.name).toBe('bulbapedia-en');
    expect(BULBAPEDIA_DEFAULT_RPS).toBe(1);
    expect(BULBAPEDIA_DEFAULT_BURST).toBe(2);
  });

  it('passes through an existing client', async () => {
    dispatchByAction();
    shim.enqueue('revisions:Charizard (Base Set 4)', {
      status: 200,
      body: fixture('revisions.charizard-base-set-4.json'),
    });
    const http = new RateLimitedClient({
      host: BULBAPEDIA_HOST,
      requestsPerSecond: 50,
      burst: 5,
      userAgent: UA,
      retries: { max: 0, baseDelayMs: 1, factor: 1 },
      fetchImpl: shim.fetch,
      sleep: () => Promise.resolve(),
    });
    const adapter = createBulbapediaAdapter({ http });
    const printings = await adapter.listPrintingsForCard('Charizard (Base Set 4)');
    expect(printings).toHaveLength(3);
  });
});
