// End-to-end wiring test: the PTCGIO adapter (mocked HTTP) fed into
// `resolveCanonicalSets` / `resolveCanonicalCards` as the **validation**
// tier, alongside a fake primary source. We don't re-test the resolver
// mechanics here (those live in `src/resolver/resolver.test.ts`); we
// just verify the adapter plugs in correctly:
//
//   1. The adapter's RawSet[] survives the resolver as the validation
//      tier on a `tcgdex-en` primary, contributing to source metadata
//      without overriding primary fields.
//   2. Agreement between primary and ptcgio records both sources in
//      `sourceMetadata.validation`.
//   3. Disagreement on `name` fires a DataConflict; primary wins.
//   4. The canonical card pulled through the same pipeline carries
//      the raw signal that downstream rarity normalization consumes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PTCGIO_HOST, PTCGIO_MAX_PAGE_SIZE, PTCGIOAdapter } from './adapter.js';
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

function listEnvelope(items: unknown[]): string {
  return JSON.stringify({
    data: items,
    page: 1,
    pageSize: PTCGIO_MAX_PAGE_SIZE,
    count: items.length,
    totalCount: items.length,
  });
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

function adapterWith(shim: FetchShim): PTCGIOAdapter {
  const http = new RateLimitedClient({
    host: PTCGIO_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 0, baseDelayMs: 1, factor: 1 },
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
  });
  return new PTCGIOAdapter({ http });
}

/**
 * Build a fake `tcgdex-en` primary RawSet shaped to align with the
 * PTCGIO swsh9 fixture under canonical-key normalization (`en-swsh9`).
 */
function fakePrimarySet(): RawSet {
  return {
    source: 'tcgdex-en',
    sourceKey: 'swsh9',
    code: 'swsh9',
    language: 'en',
    name: 'Brilliant Stars',
    series: 'Sword & Shield',
    releaseDate: '2022-02-25',
    printedTotal: 172,
    // TCGdex includes the Trainer Gallery sub-set in `total`, PTCGIO
    // doesn't — this is the documented validation-tier asymmetry.
    total: 216,
    logoUrl: 'https://assets.tcgdex.net/en/swsh/swsh9/logo.png',
    symbolUrl: 'https://assets.tcgdex.net/univ/swsh/swsh9/symbol.png',
  };
}

describe('resolver integration — PTCGIO as validation', () => {
  it('agreement between primary and ptcgio records the agreement', async () => {
    const shim = new FetchShim().enqueue('/v2/sets', {
      status: 200,
      body: listEnvelope([JSON.parse(fixture('set.swsh9.json'))]),
    });
    const adapter = adapterWith(shim);
    const validation = await adapter.listSets();

    const primary = [fakePrimarySet()];
    const tiered: TieredRecords<RawSet> = { primary, validation, filler: [] };
    const result = resolveCanonicalSets(tiered);

    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.canonicalKey).toBe('en-swsh9');
    expect(result.canonical[0]?.name).toBe('Brilliant Stars');
    expect(result.canonical[0]?.sourceMetadata['primary']).toBe('tcgdex-en');
    const md = result.canonical[0]?.sourceMetadata as { validation?: Record<string, string[]> };
    expect(md.validation?.['name']).toContain('ptcgio');
    expect(md.validation?.['releaseDate']).toContain('ptcgio');
  });

  it('disagreement on name surfaces a DataConflict and primary wins', async () => {
    const shim = new FetchShim().enqueue('/v2/sets', {
      status: 200,
      body: listEnvelope([
        {
          ...JSON.parse(fixture('set.swsh9.json')),
          name: 'Brillaint Stars', // typo in PTCGIO data
        },
      ]),
    });
    const adapter = adapterWith(shim);
    const validation = await adapter.listSets();

    const primary = [fakePrimarySet()];
    const result = resolveCanonicalSets({ primary, validation, filler: [] });

    expect(result.canonical[0]?.name).toBe('Brilliant Stars');
    const conflict = result.conflicts.find((c) => c.field === 'name');
    expect(conflict).toBeDefined();
    expect(conflict?.chosenSource).toBe('tcgdex-en');
    expect(conflict?.entityKey).toBe('en-swsh9');
  });

  it('primary-without-validation still canonicalizes (no presence conflict at validation tier)', async () => {
    const primary = [fakePrimarySet()];
    const tiered: TieredRecords<RawSet> = { primary, validation: [], filler: [] };
    const result = resolveCanonicalSets(tiered);
    expect(result.canonical).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    expect(result.canonical[0]?.sourceMetadata['primary']).toBe('tcgdex-en');
  });

  it('cards from listCardsForSet flow into resolveCanonicalCards as validation tier', async () => {
    const shim = new FetchShim().enqueue('/v2/cards', {
      status: 200,
      body: listEnvelope([JSON.parse(fixture('card.swsh9-18.json'))]),
    });
    const adapter = adapterWith(shim);
    const ptcgioCards = await adapter.listCardsForSet('swsh9');
    expect(ptcgioCards).toHaveLength(1);

    const primaryCard: RawCard = {
      source: 'tcgdex-en',
      sourceKey: 'swsh9-018',
      setCode: 'swsh9',
      language: 'en',
      // PTCGIO emits "18", TCGdex emits "018" — canonical-keys.ts pads
      // both to "018", so both align on `en-swsh9-018`.
      number: '018',
      name: 'Charizard VSTAR',
      nameLocalized: null,
      typeRaw: 'Fire',
      subtypeRaw: 'Pokemon',
      hp: 280,
      illustrator: '5ban Graphics',
      flavorText: null,
      attacks: null,
      weakness: null,
      resistance: null,
      retreatCost: 2,
      rarityRaw: 'Holo Rare VSTAR',
    };

    const setLookup = new Map([['en-swsh9', { canonicalKey: 'en-swsh9' }]]);
    const result = resolveCanonicalCards(
      {
        primary: [primaryCard],
        validation: ptcgioCards,
        filler: [],
      } as TieredRecords<RawCard>,
      setLookup,
    );
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.canonicalKey).toBe('en-swsh9-018');
    expect(result.canonical[0]?.sourceMetadata['primary']).toBe('tcgdex-en');
    // The resolver records validation-tier agreement on `name`.
    const md = result.canonical[0]?.sourceMetadata as { validation?: Record<string, string[]> };
    expect(md.validation?.['name']).toContain('ptcgio');
  });
});
