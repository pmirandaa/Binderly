// `resolveListingToPrinting` integration tests against an in-memory
// catalog fixture. The fixture is shaped as `ParserCatalogReader`
// so the same code path is testable here and pluggable into a real
// `@binderly/db` query layer downstream.

import { describe, expect, it } from 'vitest';

import { resolveListingToPrinting } from './joiner.js';
import { parseEbayListing } from './parse.js';

import type { ParserCatalogCard, ParserCatalogPrinting, ParserCatalogReader } from './joiner.js';

interface Fixture {
  readonly cards: ReadonlyArray<ParserCatalogCard>;
  readonly printings: ReadonlyArray<ParserCatalogPrinting>;
}

function makeReader(fixture: Fixture): ParserCatalogReader {
  return {
    async findCardByCanonicalKey(canonicalKey) {
      return fixture.cards.find((c) => c.canonicalKey === canonicalKey) ?? null;
    },
    async findCardsByNameAndSetCode({ nameLike, setCanonicalKey, limit = 5 }) {
      const lowerName = nameLike.toLowerCase();
      const candidates = fixture.cards.filter((c) => {
        const nameOk = c.name.toLowerCase().includes(lowerName);
        const setOk = setCanonicalKey == null || c.setCanonicalKey === setCanonicalKey;
        return nameOk && setOk;
      });
      return candidates.slice(0, limit);
    },
    async findPrintingsByCardId(cardId) {
      return fixture.printings.filter((p) => p.cardId === cardId);
    },
  };
}

const FIXTURE: Fixture = {
  cards: [
    {
      id: 'card-base1-charizard',
      canonicalKey: 'en-base1-004',
      setCanonicalKey: 'en-base1',
      name: 'Charizard',
    },
    {
      id: 'card-base1-pikachu',
      canonicalKey: 'en-base1-058',
      setCanonicalKey: 'en-base1',
      name: 'Pikachu',
    },
    {
      id: 'card-swsh7-sylveon-v',
      canonicalKey: 'en-swsh7-091',
      setCanonicalKey: 'en-swsh7',
      name: 'Sylveon V',
    },
    {
      id: 'card-jp-base1-charizard',
      canonicalKey: 'jp-base1-004',
      setCanonicalKey: 'jp-base1',
      name: 'Lizardon',
    },
  ],
  printings: [
    {
      id: 'p-base1-charizard-holo-fe-sl',
      variantKey: 'en-base1-004-holo-fe-sl',
      cardId: 'card-base1-charizard',
      variantClass: 'HOLO',
      variantFlags: ['FIRST_EDITION', 'SHADOWLESS'],
    },
    {
      id: 'p-base1-charizard-holo-sl',
      variantKey: 'en-base1-004-holo-sl',
      cardId: 'card-base1-charizard',
      variantClass: 'HOLO',
      variantFlags: ['SHADOWLESS'],
    },
    {
      id: 'p-base1-charizard-holo',
      variantKey: 'en-base1-004-holo',
      cardId: 'card-base1-charizard',
      variantClass: 'HOLO',
      variantFlags: [],
    },
    {
      id: 'p-base1-pikachu-nonholo',
      variantKey: 'en-base1-058-nonholo',
      cardId: 'card-base1-pikachu',
      variantClass: 'NON_HOLO',
      variantFlags: [],
    },
    {
      id: 'p-base1-pikachu-rh',
      variantKey: 'en-base1-058-rh',
      cardId: 'card-base1-pikachu',
      variantClass: 'REVERSE_HOLO',
      variantFlags: [],
    },
    {
      id: 'p-swsh7-sylveon-v-altart',
      variantKey: 'en-swsh7-091-altart',
      cardId: 'card-swsh7-sylveon-v',
      variantClass: 'ALT_ART',
      variantFlags: [],
    },
    {
      id: 'p-swsh7-sylveon-v-holo',
      variantKey: 'en-swsh7-091-holo',
      cardId: 'card-swsh7-sylveon-v',
      variantClass: 'HOLO',
      variantFlags: [],
    },
    {
      id: 'p-jp-base1-charizard-holo-fe',
      variantKey: 'jp-base1-004-holo-fe',
      cardId: 'card-jp-base1-charizard',
      variantClass: 'HOLO',
      variantFlags: ['FIRST_EDITION'],
    },
  ],
};

describe('resolveListingToPrinting — canonical-key path', () => {
  const reader = makeReader(FIXTURE);

  it('maps a slabbed Charizard 4/102 to the Base Set Charizard card', async () => {
    const parsed = parseEbayListing('PSA 10 Charizard 4/102 Base Set 1st Edition Shadowless Holo');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBe('card-base1-charizard');
    expect(r.printingId).toBe('p-base1-charizard-holo-fe-sl');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('narrows to the shadowless (non-1st-Ed) printing when only shadowless asserted', async () => {
    const parsed = parseEbayListing('PSA 10 Charizard 4/102 Base Set Shadowless Holo');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBe('card-base1-charizard');
    expect(r.printingId).toBe('p-base1-charizard-holo-sl');
  });

  it('defaults to the unlimited holo printing when no flags asserted', async () => {
    const parsed = parseEbayListing('PSA 10 Charizard 4/102 Base Set Holo');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBe('card-base1-charizard');
    expect(r.printingId).toBe('p-base1-charizard-holo');
  });

  it('routes to Sylveon V Alt Art when "Alt Art" asserted', async () => {
    const parsed = parseEbayListing('PSA 10 Sylveon V Alt Art 091/069 Evolving Skies');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBe('card-swsh7-sylveon-v');
    expect(r.printingId).toBe('p-swsh7-sylveon-v-altart');
  });

  it('routes Pikachu Reverse Holo to the RH printing', async () => {
    const parsed = parseEbayListing('Pikachu Reverse Holo 58/102 Base Set NM');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBe('card-base1-pikachu');
    expect(r.printingId).toBe('p-base1-pikachu-rh');
  });
});

describe('resolveListingToPrinting — name fallback path', () => {
  const reader = makeReader(FIXTURE);

  it('falls back to name+set lookup when number missing', async () => {
    const parsed = parseEbayListing('Charizard Base Set Holo NM');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBe('card-base1-charizard');
    expect(r.printingId).not.toBeNull();
  });

  it('returns nulls when canonical key misses and name unrecognised', async () => {
    // Number 999/999 is not in the fixture; "Eldritch Horror" is
    // not a Pokémon species in the dictionary; no fallback hit.
    const parsed = parseEbayListing('Eldritch Horror 999/999 Unknown Set Holo');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBeNull();
    expect(r.printingId).toBeNull();
    expect(r.confidence).toBe(0);
  });
});

describe('resolveListingToPrinting — JP language', () => {
  const reader = makeReader(FIXTURE);

  it('routes JP listing to JP card', async () => {
    const parsed = parseEbayListing('Japanese Charizard 4/102 1st Edition Base Set Holo');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBe('card-jp-base1-charizard');
    expect(r.printingId).toBe('p-jp-base1-charizard-holo-fe');
  });
});

describe('resolveListingToPrinting — lots short-circuit', () => {
  const reader = makeReader(FIXTURE);

  it('refuses lot listings with confidence 0', async () => {
    const parsed = parseEbayListing('Pokemon Lot of 50 Cards Bulk');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.cardId).toBeNull();
    expect(r.printingId).toBeNull();
    expect(r.confidence).toBe(0);
  });
});

describe('resolveListingToPrinting — confidence multiplier', () => {
  const reader = makeReader(FIXTURE);

  it('canonical-key hit produces confidence in (0, parsed.confidenceScore]', async () => {
    const parsed = parseEbayListing('PSA 10 Charizard 4/102 Base Set Shadowless Holo');
    const r = await resolveListingToPrinting(parsed, reader);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(parsed.confidenceScore);
  });

  it('name-fallback path produces lower confidence than canonical hit', async () => {
    const fullParsed = parseEbayListing('Charizard 4/102 Base Set Holo');
    const fallback = parseEbayListing('Charizard Base Set Holo');
    const a = await resolveListingToPrinting(fullParsed, reader);
    const b = await resolveListingToPrinting(fallback, reader);
    if (b.cardId != null) {
      expect(b.confidence).toBeLessThanOrEqual(a.confidence);
    }
  });
});
