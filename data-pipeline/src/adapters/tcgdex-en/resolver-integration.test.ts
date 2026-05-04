// End-to-end wiring test: the TCGdex EN adapter (mocked HTTP) fed
// into `resolveCanonicalSets` / `resolveCanonicalCards` alongside a
// fake validation source. We don't re-test the resolver mechanics
// here (those live in `src/resolver/resolver.test.ts`); we just
// verify the adapter plugs in correctly:
//
//   1. The adapter's RawSet[] survives the resolver as the canonical
//      set keyed by `en-swsh9` with `tcgdex-en` provenance.
//   2. A validation source's matching record records agreement
//      (no DataConflict).
//   3. A validation source's mismatching name fires a DataConflict
//      and the primary's value wins.
//   4. The canonical card pulled through the same pipeline carries
//      the rarity raw signal that downstream rarity normalization
//      consumes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TCGDEX_HOST, TCGdexEnAdapter } from './adapter.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import {
  resolveCanonicalCards,
  resolveCanonicalSets,
  type TieredRecords,
} from '../../resolver/resolver.js';

import type { RawCard, RawSet } from '../../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');
const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

interface ProgrammableResponse {
  status: number;
  body?: string;
}

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

class FetchShim {
  readonly queues = new Map<string, ProgrammableResponse[]>();
  enqueue(pathname: string, response: ProgrammableResponse): this {
    const list = this.queues.get(pathname) ?? [];
    list.push(response);
    this.queues.set(pathname, list);
    return this;
  }
  readonly fetch = async (input: string | URL): Promise<Response> => {
    const url = input.toString();
    const pathname = new URL(url).pathname;
    const next = this.queues.get(pathname)?.shift();
    if (!next) throw new Error(`FetchShim: no programmed response for ${pathname}`);
    return new Response(next.body ?? '', { status: next.status });
  };
}

function adapterWith(shim: FetchShim): TCGdexEnAdapter {
  const http = new RateLimitedClient({
    host: TCGDEX_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 0, baseDelayMs: 1, factor: 1 },
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
  });
  return new TCGdexEnAdapter({ http });
}

describe('resolver integration — TCGdex EN as primary', () => {
  it('canonicalizes one set, no validation', async () => {
    const shim = new FetchShim()
      .enqueue('/v2/en/sets', {
        status: 200,
        body: JSON.stringify([{ id: 'swsh9', name: 'Brilliant Stars' }]),
      })
      .enqueue('/v2/en/sets/swsh9', { status: 200, body: fixture('set.swsh9.json') });
    const adapter = adapterWith(shim);
    const sets = await adapter.listSets();

    const tiered: TieredRecords<RawSet> = { primary: sets, validation: [], filler: [] };
    const result = resolveCanonicalSets(tiered);
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.canonicalKey).toBe('en-swsh9');
    expect(result.canonical[0]?.name).toBe('Brilliant Stars');
    expect(result.canonical[0]?.sourceMetadata['primary']).toBe('tcgdex-en');
    expect(result.conflicts).toEqual([]);
  });

  it('agreement with a fake validation source records the agreement', async () => {
    const shim = new FetchShim()
      .enqueue('/v2/en/sets', {
        status: 200,
        body: JSON.stringify([{ id: 'swsh9', name: 'Brilliant Stars' }]),
      })
      .enqueue('/v2/en/sets/swsh9', { status: 200, body: fixture('set.swsh9.json') });
    const adapter = adapterWith(shim);
    const primary = await adapter.listSets();
    const validation: RawSet[] = primary.map((s) => ({ ...s, source: 'ptcgio' }));

    const result = resolveCanonicalSets({ primary, validation, filler: [] });
    expect(result.conflicts).toEqual([]);
    const md = result.canonical[0]?.sourceMetadata as { validation?: Record<string, string[]> };
    expect(md.validation?.['name']).toContain('ptcgio');
    expect(md.validation?.['releaseDate']).toContain('ptcgio');
  });

  it('disagreement on set.name surfaces a DataConflict and primary wins', async () => {
    const shim = new FetchShim()
      .enqueue('/v2/en/sets', {
        status: 200,
        body: JSON.stringify([{ id: 'swsh9', name: 'Brilliant Stars' }]),
      })
      .enqueue('/v2/en/sets/swsh9', { status: 200, body: fixture('set.swsh9.json') });
    const adapter = adapterWith(shim);
    const primary = await adapter.listSets();
    const validation: RawSet[] = primary.map((s) => ({
      ...s,
      source: 'ptcgio',
      name: 'Brillaint Stars', // typo
    }));

    const result = resolveCanonicalSets({ primary, validation, filler: [] });
    expect(result.canonical[0]?.name).toBe('Brilliant Stars');
    const conflict = result.conflicts.find((c) => c.field === 'name');
    expect(conflict).toBeDefined();
    expect(conflict?.chosenSource).toBe('tcgdex-en');
    expect(conflict?.entityKey).toBe('en-swsh9');
  });

  it('cards from listCardsForSet flow into resolveCanonicalCards with rarity raw signal', async () => {
    const miniSet = {
      id: 'swsh9',
      name: 'Brilliant Stars',
      cardCount: { official: 172, total: 216 },
      releaseDate: '2022-02-25',
      serie: { id: 'swsh', name: 'Sword & Shield' },
      cards: [{ id: 'swsh9-018', localId: '018', name: 'Charizard VSTAR' }],
    };
    const shim = new FetchShim()
      .enqueue('/v2/en/sets/swsh9', { status: 200, body: JSON.stringify(miniSet) })
      .enqueue('/v2/en/cards/swsh9-018', { status: 200, body: fixture('card.swsh9-018.json') });
    const adapter = adapterWith(shim);
    const cards = await adapter.listCardsForSet('swsh9');
    expect(cards).toHaveLength(1);

    const setLookup = new Map([['en-swsh9', { canonicalKey: 'en-swsh9' }]]);
    const result = resolveCanonicalCards(
      { primary: cards, validation: [], filler: [] } as TieredRecords<RawCard>,
      setLookup,
    );
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.canonicalKey).toBe('en-swsh9-018');
    // The resolver carries `rarityRaw` in source metadata for
    // downstream normalization (per its module-level contract).
    expect(result.canonical[0]?.sourceMetadata['rarityRaw']).toBe('Holo Rare VSTAR');
    expect(result.canonical[0]?.sourceMetadata['typeRaw']).toBe('Fire');
    expect(result.canonical[0]?.sourceMetadata['subtypeRaw']).toBe('Pokemon');
  });
});
