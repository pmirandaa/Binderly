// Fixture-driven tests for the PTCGIO pure transforms. No HTTP —
// every test reads a captured PTCGIO JSON response from `./fixtures/`
// and asserts the produced `Raw{Set,Card,Printing}` shapes.
//
// The fixtures are intentionally trimmed of `cardmarket` (volatile,
// daily-changing) and have `tcgplayer.prices.<key>` inner values
// emptied to `{}` (we keep only the variant-signal-bearing key set).
// Otherwise byte-for-byte from the live API at capture time.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isPtcgioPromoSet,
  normalizePtcgioDate,
  ptcgioCardToPrintings,
  ptcgioCardToRaw,
  ptcgioSetToRaw,
} from './transform.js';
import { normalizeRarity } from '../../normalize/rarity.js';
import { rawCardSchema, rawPrintingSchema, rawSetSchema } from '../../types.js';
import { classifyVariant } from '../../variant-classify.js';

import type { PTCGIOCard, PTCGIOSet } from './api-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadSet(name: string): PTCGIOSet {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as PTCGIOSet;
}
function loadCard(name: string): PTCGIOCard {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as PTCGIOCard;
}

const ALL_CARD_FIXTURES = [
  'card.swsh9-1.json',
  'card.swsh9-18.json',
  'card.swsh9-174.json',
  'card.swsh9-181.json',
  'card.base1-4.json',
  'card.sv1-200.json',
  'card.sv1-244.json',
  'card.sv1-258.json',
  'card.swshp-SWSH001.json',
] as const;

describe('normalizePtcgioDate', () => {
  it('converts yyyy/mm/dd → yyyy-mm-dd', () => {
    expect(normalizePtcgioDate('2022/02/25')).toBe('2022-02-25');
    expect(normalizePtcgioDate('1999/01/09')).toBe('1999-01-09');
  });

  it('pads single-digit month/day', () => {
    expect(normalizePtcgioDate('2023/3/9')).toBe('2023-03-09');
  });

  it('passes through ISO yyyy-mm-dd verbatim', () => {
    expect(normalizePtcgioDate('2022-02-25')).toBe('2022-02-25');
  });

  it('throws on unrecognized format', () => {
    expect(() => normalizePtcgioDate('Feb 25, 2022')).toThrow(/cannot normalize/);
  });
});

describe('ptcgioSetToRaw', () => {
  it('maps a modern set (Brilliant Stars / swsh9)', () => {
    const set = loadSet('set.swsh9.json');
    const raw = ptcgioSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.source).toBe('ptcgio');
    expect(raw.sourceKey).toBe('swsh9');
    expect(raw.code).toBe('swsh9');
    expect(raw.language).toBe('en');
    expect(raw.name).toBe('Brilliant Stars');
    expect(raw.series).toBe('Sword & Shield');
    expect(raw.releaseDate).toBe('2022-02-25');
    expect(raw.printedTotal).toBe(172);
    // PTCGIO under-counts vs TCGdex (216 — TG sub-set excluded).
    expect(raw.total).toBe(186);
    expect(raw.logoUrl).toBe('https://images.pokemontcg.io/swsh9/logo.png');
    expect(raw.symbolUrl).toBe('https://images.pokemontcg.io/swsh9/symbol.png');
    expect(raw.extra?.['ptcgoCode']).toBe('BRS');
    expect(raw.extra?.['legalities']).toMatchObject({ standard: 'Legal' });
  });

  it('maps a vintage set (Base Set / base1)', () => {
    const set = loadSet('set.base1.json');
    const raw = ptcgioSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('base1');
    expect(raw.name).toBe('Base');
    expect(raw.printedTotal).toBe(102);
    expect(raw.total).toBe(102);
    expect(raw.releaseDate).toBe('1999-01-09');
  });

  it('maps an SV-era set (Scarlet & Violet / sv1)', () => {
    const set = loadSet('set.sv1.json');
    const raw = ptcgioSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('sv1');
    expect(raw.printedTotal).toBe(198);
    expect(raw.total).toBe(258);
  });

  it('maps a promo set (SWSH Black Star Promos / swshp)', () => {
    const set = loadSet('set.swshp.json');
    const raw = ptcgioSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('swshp');
    expect(isPtcgioPromoSet(raw.code)).toBe(true);
  });

  it('coerces missing series to null', () => {
    const set: PTCGIOSet = {
      id: 'tst',
      name: 'Test',
      releaseDate: '2024/01/01',
    };
    const raw = ptcgioSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.series).toBe(null);
  });
});

describe('ptcgioCardToRaw', () => {
  it('maps a Common Pokémon card (swsh9-1)', () => {
    const card = loadCard('card.swsh9-1.json');
    const raw = ptcgioCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.source).toBe('ptcgio');
    expect(raw.sourceKey).toBe('swsh9-1');
    expect(raw.setCode).toBe('swsh9');
    expect(raw.number).toBe('1');
    expect(raw.name).toBe('Exeggcute');
    expect(raw.typeRaw).toBe('Grass');
    expect(raw.subtypeRaw).toBe('Pokemon');
    expect(raw.hp).toBe(50);
    expect(raw.illustrator).toBe('0313');
    expect(raw.rarityRaw).toBe('Common');
    expect(raw.attacks).toHaveLength(2);
    expect(raw.retreatCost).toBe(1);
    expect(raw.extra?.['regulationMark']).toBe('F');
    expect(raw.extra?.['supertype']).toBe('Pokémon');
    expect(raw.extra?.['imageLarge']).toBe('https://images.pokemontcg.io/swsh9/1_hires.png');
  });

  it('maps an Ultra Rare VSTAR card (swsh9-18)', () => {
    const card = loadCard('card.swsh9-18.json');
    const raw = ptcgioCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.rarityRaw).toBe('Rare Holo VSTAR');
    expect(raw.hp).toBe(280);
    expect(raw.extra?.['evolvesFrom']).toBe('Charizard V');
    expect(raw.extra?.['subtypes']).toEqual(['VSTAR']);
  });

  it('maps a Hyper Rare basic energy (sv1-258)', () => {
    const card = loadCard('card.sv1-258.json');
    const raw = ptcgioCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.subtypeRaw).toBe('Basic Energy');
    expect(raw.rarityRaw).toBe('Hyper Rare');
    expect(raw.hp).toBe(null);
    expect(raw.extra?.['supertype']).toBe('Energy');
  });

  it('derives Trainer subtype from supertype + subtypes array', () => {
    const card: PTCGIOCard = {
      id: 'swsh9-150',
      name: 'Ultra Ball',
      supertype: 'Trainer',
      subtypes: ['Item'],
      rules: ['Search your deck.'],
      number: '150',
      set: {
        id: 'swsh9',
        name: 'Brilliant Stars',
        releaseDate: '2022/02/25',
      },
      rarity: 'Uncommon',
    };
    const raw = ptcgioCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.subtypeRaw).toBe('Item');
    expect(raw.extra?.['rules']).toEqual(['Search your deck.']);
  });

  it('coerces empty rarity to null', () => {
    const card: PTCGIOCard = {
      id: 't-1',
      name: 'Test',
      supertype: 'Pokémon',
      number: '1',
      set: { id: 't', name: 'T', releaseDate: '2024/01/01' },
      rarity: '',
    };
    const raw = ptcgioCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.rarityRaw).toBe(null);
  });

  it('parses non-numeric hp ("?") as null', () => {
    const card: PTCGIOCard = {
      id: 't-1',
      name: 'Test',
      supertype: 'Pokémon',
      number: '1',
      hp: '?',
      set: { id: 't', name: 'T', releaseDate: '2024/01/01' },
    };
    const raw = ptcgioCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.hp).toBe(null);
  });
});

describe('ptcgioCardToPrintings — via classifyVariant', () => {
  // We assert the variant signals fed into the classifier produce the
  // expected variant_class. The classifier is tested in detail
  // upstream; here we verify the adapter wires the right signals.

  it('Common with normal+reverseHolofoil → 2 printings (NON_HOLO + REVERSE_HOLO)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-1.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    printings.forEach((p) => rawPrintingSchema.parse(p));
    expect(printings).toHaveLength(2);

    const classes = printings.map((p) => classifyVariant(p, cardRaw, setRaw).variant_class);
    expect(classes.sort()).toEqual(['NON_HOLO', 'REVERSE_HOLO']);
  });

  it('Holo VSTAR (holofoil only) → 1 HOLO printing (swsh9-18)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-18.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('HOLO');
    expect(cls.variant_code).toBe('holo');
    expect(printings[0]?.imageSourceUrl).toBe('https://images.pokemontcg.io/swsh9/18_hires.png');
  });

  it('Rare Rainbow (number > printed_total) → RAINBOW (overlay wins) (swsh9-174)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-174.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isRainbowRare).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('RAINBOW');
  });

  it('Rare Secret with no class signal → SECRET_RARE via numbering (swsh9-181)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-181.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('SECRET_RARE');
  });

  it('Vintage Charizard (Base Set) emits ONE holo printing (PTCGIO collapses 1st-Ed/Shadowless/Unlimited)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.base1.json'));
    const card = loadCard('card.base1-4.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    printings.forEach((p) => rawPrintingSchema.parse(p));
    expect(printings[0]?.isFirstEdition).toBe(false);
    expect(printings[0]?.isShadowless).toBe(false);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('HOLO');
    // No vintage flags — this is a documented validation-tier limit;
    // the resolver retains TCGDEX-EN's primary `variants_detailed`.
    expect(cls.variant_flags).toEqual([]);
  });

  it('Illustration Rare → FULL_ART (sv1-200)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.sv1.json'));
    const card = loadCard('card.sv1-200.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isFullArt).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('FULL_ART');
  });

  it('Special Illustration Rare → ALT_ART (sv1-244)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.sv1.json'));
    const card = loadCard('card.sv1-244.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isAltArt).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('ALT_ART');
  });

  it('Hyper Rare → GOLD (sv1-258)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.sv1.json'));
    const card = loadCard('card.sv1-258.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isGoldRare).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('GOLD');
  });

  it('Promo set printing → PROMO with isPromo true (swshp-SWSH001)', () => {
    const setRaw = ptcgioSetToRaw(loadSet('set.swshp.json'));
    const card = loadCard('card.swshp-SWSH001.json');
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isPromo).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('PROMO');
  });

  it('1stEditionHolofoil price key → FIRST_EDITION flag', () => {
    // Synthesize a vintage payload with PTCGIO's documented 1st-Ed
    // price keys (none of our captured fixtures carry these because
    // PTCGIO collapses Base Set Charizard to a single `holofoil`
    // entry; we still exercise the code path so the seed-ingest is
    // covered if PTCGIO ever splits the rows).
    const card: PTCGIOCard = {
      id: 'base1-4',
      name: 'Charizard',
      supertype: 'Pokémon',
      subtypes: ['Stage 2'],
      hp: '120',
      types: ['Fire'],
      number: '4',
      rarity: 'Rare Holo',
      set: {
        id: 'base1',
        name: 'Base',
        printedTotal: 102,
        total: 102,
        releaseDate: '1999/01/09',
      },
      tcgplayer: {
        prices: { '1stEditionHolofoil': {}, '1stEditionNormal': {} },
      },
    };
    const setRaw = ptcgioSetToRaw(loadSet('set.base1.json'));
    const cardRaw = ptcgioCardToRaw(card);
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(2);
    printings.forEach((p) => expect(p.isFirstEdition).toBe(true));
    const codes = printings.map((p) => classifyVariant(p, cardRaw, setRaw).variant_code).sort();
    expect(codes).toEqual(['holo-fe', 'nonholo-fe']);
  });

  it('rarity-only fallback when tcgplayer.prices is absent', () => {
    const card: PTCGIOCard = {
      id: 'tst-1',
      name: 'Test',
      supertype: 'Pokémon',
      number: '1',
      rarity: 'Rare Holo',
      set: { id: 'tst', name: 'T', releaseDate: '2024/01/01' },
    };
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isHolo).toBe(true);
  });

  it('Idempotent: same card transforms to identical printings on repeat call', () => {
    const card = loadCard('card.swsh9-1.json');
    const a = ptcgioCardToPrintings(card);
    const b = ptcgioCardToPrintings(card);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((p) => p.sourceKey).sort()).toEqual(b.map((p) => p.sourceKey).sort());
  });

  it('ignores unknown tcgplayer.prices keys (forward-compatible)', () => {
    const card: PTCGIOCard = {
      id: 'tst-1',
      name: 'Test',
      supertype: 'Pokémon',
      number: '1',
      rarity: 'Rare Holo',
      set: { id: 'tst', name: 'T', releaseDate: '2024/01/01' },
      tcgplayer: {
        prices: { holofoil: {}, futureExoticHolofoil: {} },
      },
    };
    const printings = ptcgioCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.sourceKey).toBe('tst-1-holo');
  });
});

describe('rarity registry coverage', () => {
  it('every observed fixture rarity resolves through normalizeRarity("ptcgio", …)', () => {
    const rarities = new Set<string>();
    for (const name of ALL_CARD_FIXTURES) {
      const card = loadCard(name);
      if (card.rarity && card.rarity.trim() && card.rarity.trim().toLowerCase() !== 'none') {
        rarities.add(card.rarity);
      }
    }
    expect(rarities.size).toBeGreaterThan(0);
    for (const r of rarities) {
      expect(() => normalizeRarity('ptcgio', r)).not.toThrow();
    }
  });
});

describe('isPtcgioPromoSet', () => {
  it('matches per-era promo sets', () => {
    expect(isPtcgioPromoSet('basep')).toBe(true);
    expect(isPtcgioPromoSet('swshp')).toBe(true);
    expect(isPtcgioPromoSet('xyp')).toBe(true);
    expect(isPtcgioPromoSet('dpp')).toBe(true);
  });

  it('rejects regular numbered sets', () => {
    expect(isPtcgioPromoSet('swsh9')).toBe(false);
    expect(isPtcgioPromoSet('base1')).toBe(false);
    expect(isPtcgioPromoSet('sv1')).toBe(false);
  });

  it('handles empty / whitespace input', () => {
    expect(isPtcgioPromoSet('')).toBe(false);
    expect(isPtcgioPromoSet('  ')).toBe(false);
  });
});
