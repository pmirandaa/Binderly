// End-to-end wiring test: the Bulbapedia adapter (mocked HTTP) fed
// into `resolveCanonicalSets` / `resolveCanonicalCards` as the FILLER
// tier alongside a synthetic primary (mock TCGdex EN). We don't
// re-test the resolver mechanics here (those live in
// `src/resolver/resolver.test.ts`); we just verify the Bulbapedia
// adapter plugs in correctly:
//
//   1. Bulbapedia output joins the primary on `(language, set_code)`
//      via the TCGdex code mapping in `set-codes.ts` (filler tier;
//      sets that match the primary are NOT surfaced as conflicts).
//   2. When the primary leaves a card field null, the Bulbapedia
//      filler fills it and `sourceMetadata.filler` records the
//      contribution.
//   3. Filler-only sets (where the primary doesn't carry a row)
//      surface as `__presence` DataConflicts so ops can audit
//      coverage gaps.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BULBAPEDIA_HOST, BulbapediaAdapter } from './adapter.js';
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
  enqueue(key: string, response: ProgrammableResponse): this {
    const list = this.queues.get(key) ?? [];
    list.push(response);
    this.queues.set(key, list);
    return this;
  }
  readonly fetch = async (input: string | URL): Promise<Response> => {
    const url = input.toString();
    const u = new URL(url);
    const titles = u.searchParams.get('titles');
    const cmtitle = u.searchParams.get('cmtitle');
    const key = titles
      ? `revisions:${titles}`
      : cmtitle
        ? `categorymembers:${cmtitle}`
        : u.pathname;
    const next = this.queues.get(key)?.shift();
    if (!next) {
      throw new Error(`FetchShim: no programmed response for ${key} (url=${url})`);
    }
    return new Response(next.body ?? '', { status: next.status });
  };
}

function adapterWith(shim: FetchShim): BulbapediaAdapter {
  const http = new RateLimitedClient({
    host: BULBAPEDIA_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 0, baseDelayMs: 1, factor: 1 },
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
  });
  return new BulbapediaAdapter({ http });
}

/**
 * Build a synthetic TCGdex-style primary RawSet so the test doesn't
 * depend on importing the sibling adapter's fixtures (this test is
 * about Bulbapedia's wiring, not about TCGdex). The shape matches
 * what a primary tier would emit: the same canonical key
 * (`en-base1`) the Bulbapedia row resolves to.
 */
function syntheticPrimarySet(over: Partial<RawSet> = {}): RawSet {
  return {
    source: 'tcgdex-en',
    sourceKey: 'base1',
    code: 'base1',
    language: 'en',
    name: 'Base Set',
    series: 'Original',
    releaseDate: '1999-01-09',
    printedTotal: 102,
    total: 102,
    logoUrl: null,
    symbolUrl: null,
    extra: {},
    ...over,
  };
}

function syntheticPrimaryCard(over: Partial<RawCard> = {}): RawCard {
  return {
    source: 'tcgdex-en',
    sourceKey: 'base1-4',
    setCode: 'base1',
    language: 'en',
    number: '004',
    name: 'Charizard',
    nameLocalized: null,
    typeRaw: 'Fire',
    subtypeRaw: 'Pokemon',
    hp: 120,
    illustrator: null,
    flavorText: null,
    attacks: null,
    weakness: null,
    resistance: null,
    retreatCost: null,
    rarityRaw: 'Holo Rare',
    extra: {},
    ...over,
  };
}

describe('resolver integration — Bulbapedia EN as filler', () => {
  it('Bulbapedia set joined to a primary set agrees on key and does NOT surface a presence conflict', async () => {
    const shim = new FetchShim().enqueue('revisions:Base Set (TCG)', {
      status: 200,
      body: fixture('revisions.set-base-set.json'),
    });
    const adapter = adapterWith(shim);
    const fillerSet = await adapter.getSet('Base Set (TCG)');
    expect(fillerSet).not.toBeNull();
    expect(fillerSet?.code).toBe('base1');

    const primary = syntheticPrimarySet();
    const result = resolveCanonicalSets({
      primary: [primary],
      validation: [],
      filler: [fillerSet!],
    });
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.canonicalKey).toBe('en-base1');
    expect(result.canonical[0]?.name).toBe('Base Set');
    // The primary already had every field populated → no filler
    // contribution recorded.
    const md = result.canonical[0]?.sourceMetadata as { filler?: Record<string, string[]> };
    expect(md.filler).toBeUndefined();
    expect(result.conflicts).toEqual([]);
  });

  it('Bulbapedia set fills the gaps when primary leaves fields null', async () => {
    const shim = new FetchShim().enqueue('revisions:Base Set (TCG)', {
      status: 200,
      body: fixture('revisions.set-base-set.json'),
    });
    const adapter = adapterWith(shim);
    const fillerSet = await adapter.getSet('Base Set (TCG)');
    expect(fillerSet).not.toBeNull();

    const primary = syntheticPrimarySet({
      series: null,
      printedTotal: null,
      total: null,
    });
    const result = resolveCanonicalSets({
      primary: [primary],
      validation: [],
      filler: [fillerSet!],
    });
    expect(result.canonical[0]?.series).toBe('Original');
    expect(result.canonical[0]?.printedTotal).toBe(102);
    expect(result.canonical[0]?.total).toBe(102);
    const md = result.canonical[0]?.sourceMetadata as { filler?: Record<string, string[]> };
    expect(md.filler?.['series']).toContain('bulbapedia-en');
    expect(md.filler?.['printedTotal']).toContain('bulbapedia-en');
    expect(md.filler?.['total']).toContain('bulbapedia-en');
  });

  it('Bulbapedia set the primary does NOT carry surfaces a __presence DataConflict', async () => {
    const shim = new FetchShim().enqueue('revisions:Brilliant Stars (TCG)', {
      status: 200,
      body: fixture('revisions.set-brilliant-stars.json'),
    });
    const adapter = adapterWith(shim);
    const fillerSet = await adapter.getSet('Brilliant Stars (TCG)');
    expect(fillerSet).not.toBeNull();

    const primary: RawSet[] = []; // no swsh9 from primary
    const result = resolveCanonicalSets({
      primary,
      validation: [],
      filler: [fillerSet!],
    });
    expect(result.canonical).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe('__presence');
    expect(result.conflicts[0]?.entityKey).toBe('en-swsh9');
    expect(result.conflicts[0]?.sources['bulbapedia-en']).toBe('present');
  });

  it('Bulbapedia card fills illustrator when primary leaves it null', async () => {
    const shim = new FetchShim().enqueue('revisions:Charizard (Base Set 4)', {
      status: 200,
      body: fixture('revisions.charizard-base-set-4.json'),
    });
    const adapter = adapterWith(shim);
    const fillerCard = await adapter.getCard('Charizard (Base Set 4)');
    expect(fillerCard).not.toBeNull();
    expect(fillerCard?.illustrator).toBe('Mitsuhiro Arita');

    const primary = syntheticPrimaryCard({ illustrator: null });
    const setLookup = new Map([['en-base1', { canonicalKey: 'en-base1' }]]);
    const result = resolveCanonicalCards(
      {
        primary: [primary],
        validation: [],
        filler: [fillerCard!],
      } as TieredRecords<RawCard>,
      setLookup,
    );
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.illustrator).toBe('Mitsuhiro Arita');
    const md = result.canonical[0]?.sourceMetadata as { filler?: Record<string, string[]> };
    expect(md.filler?.['illustrator']).toContain('bulbapedia-en');
  });

  it('Bulbapedia card does NOT override a primary card field that is already populated', async () => {
    const shim = new FetchShim().enqueue('revisions:Charizard (Base Set 4)', {
      status: 200,
      body: fixture('revisions.charizard-base-set-4.json'),
    });
    const adapter = adapterWith(shim);
    const fillerCard = await adapter.getCard('Charizard (Base Set 4)');
    expect(fillerCard).not.toBeNull();
    expect(fillerCard?.illustrator).toBe('Mitsuhiro Arita');

    const primary = syntheticPrimaryCard({ illustrator: 'Primary Source Illustrator' });
    const setLookup = new Map([['en-base1', { canonicalKey: 'en-base1' }]]);
    const result = resolveCanonicalCards(
      {
        primary: [primary],
        validation: [],
        filler: [fillerCard!],
      } as TieredRecords<RawCard>,
      setLookup,
    );
    expect(result.canonical[0]?.illustrator).toBe('Primary Source Illustrator');
  });
});
