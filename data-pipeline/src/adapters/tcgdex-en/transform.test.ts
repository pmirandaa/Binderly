// Fixture-driven tests for the pure transforms. No HTTP — every test
// reads a captured TCGdex JSON response from `./fixtures/` and asserts
// the produced `Raw{Set,Card,Printing}` shapes.
//
// The fixtures are intentionally trimmed of `pricing` (volatile,
// daily-changing) but otherwise byte-for-byte from the live API at
// capture time.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isTcgdexPromoSet,
  tcgdexCardToPrintings,
  tcgdexCardToRaw,
  tcgdexSetToRaw,
} from './transform.js';
import { rawCardSchema, rawPrintingSchema, rawSetSchema } from '../../types.js';
import { classifyVariant } from '../../variant-classify.js';

import type { TCGdexCard, TCGdexSet } from './api-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadSet(name: string): TCGdexSet {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as TCGdexSet;
}
function loadCard(name: string): TCGdexCard {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as TCGdexCard;
}

describe('tcgdexSetToRaw', () => {
  it('maps a modern set (Brilliant Stars / swsh9)', () => {
    const set = loadSet('set.swsh9.json');
    const raw = tcgdexSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.source).toBe('tcgdex-en');
    expect(raw.sourceKey).toBe('swsh9');
    expect(raw.code).toBe('swsh9');
    expect(raw.language).toBe('en');
    expect(raw.name).toBe('Brilliant Stars');
    expect(raw.series).toBe('Sword & Shield');
    expect(raw.releaseDate).toBe('2022-02-25');
    expect(raw.printedTotal).toBe(172);
    expect(raw.total).toBe(216);
    expect(raw.logoUrl).toBe('https://assets.tcgdex.net/en/swsh/swsh9/logo.png');
    expect(raw.symbolUrl).toBe('https://assets.tcgdex.net/univ/swsh/swsh9/symbol.png');
    expect(raw.extra?.['tcgOnline']).toBe('BRS');
    expect(raw.extra?.['abbreviation']).toBe('BRS');
    expect(raw.extra?.['serieId']).toBe('swsh');
  });

  it('maps a vintage set (Base Set / base1)', () => {
    const set = loadSet('set.base1.json');
    const raw = tcgdexSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('base1');
    expect(raw.name).toBe('Base Set');
    expect(raw.printedTotal).toBe(102);
    expect(raw.total).toBe(102);
  });

  it('maps an SV-era set (Scarlet & Violet / sv01)', () => {
    const set = loadSet('set.sv01.json');
    const raw = tcgdexSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('sv01');
    expect(raw.printedTotal).toBe(198);
    expect(raw.total).toBe(258);
    expect(raw.extra?.['abbreviation']).toBe('SVI');
  });

  it('maps a promo set (SWSH Black Star Promos / swshp)', () => {
    const set = loadSet('set.swshp.json');
    const raw = tcgdexSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('swshp');
    expect(isTcgdexPromoSet(raw.code)).toBe(true);
  });
});

describe('tcgdexCardToRaw', () => {
  it('maps a Common Pokémon card (swsh9-001)', () => {
    const card = loadCard('card.swsh9-001.json');
    const raw = tcgdexCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.source).toBe('tcgdex-en');
    expect(raw.sourceKey).toBe('swsh9-001');
    expect(raw.setCode).toBe('swsh9');
    expect(raw.number).toBe('001');
    expect(raw.name).toBe('Exeggcute');
    expect(raw.typeRaw).toBe('Grass');
    expect(raw.subtypeRaw).toBe('Pokemon');
    expect(raw.hp).toBe(50);
    expect(raw.rarityRaw).toBe('Common');
    expect(raw.attacks).toHaveLength(2);
    expect(raw.extra?.['regulationMark']).toBe('F');
  });

  it('maps an Ultra Rare VSTAR card (swsh9-018)', () => {
    const card = loadCard('card.swsh9-018.json');
    const raw = tcgdexCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.rarityRaw).toBe('Holo Rare VSTAR');
    expect(raw.hp).toBe(280);
    expect(raw.extra?.['suffix']).toBe('V');
    expect(raw.extra?.['stage']).toBe('VSTAR');
  });

  it('maps a Trainer card with trainerType (Ultra Ball)', () => {
    const card = loadCard('card.swsh9-001.json');
    // Synthesize a Trainer payload from the fixture so the test
    // remains insensitive to TCGdex changing prose; the deriveSubtype
    // path is the contract under test.
    const trainerCard: TCGdexCard = {
      ...card,
      id: 'swsh9-150',
      localId: '150',
      name: 'Ultra Ball',
      category: 'Trainer',
      trainerType: 'Item',
      effect: 'Search your deck.',
      hp: undefined,
      types: undefined,
    };
    const raw = tcgdexCardToRaw(trainerCard);
    rawCardSchema.parse(raw);
    expect(raw.subtypeRaw).toBe('Item');
    expect(raw.extra?.['trainerType']).toBe('Item');
    expect(raw.extra?.['effect']).toBe('Search your deck.');
  });

  it('maps an Energy card (Hyper Rare basic energy / sv01-258)', () => {
    const card = loadCard('card.sv01-258.json');
    const raw = tcgdexCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.subtypeRaw).toBe('Basic Energy');
    expect(raw.rarityRaw).toBe('Hyper rare');
    expect(raw.extra?.['energyType']).toBe('Normal');
  });

  it('coerces "None" rarity to null on promo cards (swshp-SWSH001)', () => {
    const card = loadCard('card.swshp-SWSH001.json');
    const raw = tcgdexCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.rarityRaw).toBe(null);
  });
});

describe('tcgdexCardToPrintings — via classifyVariant', () => {
  // We assert the variant signals fed into the classifier produce
  // the expected variant_class. The classifier is tested in detail
  // upstream; here we only verify the adapter wires the right
  // signals.

  it('Common card with normal+reverse → 2 printings (NON_HOLO + REVERSE_HOLO)', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-001.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    printings.forEach((p) => rawPrintingSchema.parse(p));
    expect(printings).toHaveLength(2);

    const classes = printings.map((p) => classifyVariant(p, cardRaw, setRaw).variant_class);
    expect(classes.sort()).toEqual(['NON_HOLO', 'REVERSE_HOLO']);
  });

  it('Holo VSTAR (variants.holo only) → 1 HOLO printing', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-018.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(1);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('HOLO');
    expect(cls.variant_code).toBe('holo');
    expect(printings[0]?.imageSourceUrl).toBe(
      'https://assets.tcgdex.net/en/swsh/swsh9/018/high.png',
    );
  });

  it('Number > printed_total with no special signal → SECRET_RARE (swsh9-174)', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-174.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(1);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('SECRET_RARE');
  });

  it('Trainer Gallery localId TG03 → TRAINER_GALLERY', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.swsh9.json'));
    const card = loadCard('card.swsh9-TG03.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isTrainerGallery).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('TRAINER_GALLERY');
  });

  it('Vintage variants_detailed → 4 printings with FE/Shadowless/Unlimited flags (base1-4)', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.base1.json'));
    const card = loadCard('card.base1-4.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(4);
    printings.forEach((p) => rawPrintingSchema.parse(p));

    const results = printings.map((p) => ({
      label: p.sourcePrintingLabel,
      sourceKey: p.sourceKey,
      ...classifyVariant(p, cardRaw, setRaw),
    }));

    // Every printing is a HOLO class on Base Set Charizard. Flags
    // differentiate them.
    expect(results.every((r) => r.variant_class === 'HOLO')).toBe(true);

    // Find the 1st Edition Shadowless print: flags include both
    // FIRST_EDITION and SHADOWLESS, variant_code is `holo-fe-sl`.
    const feSl = results.find((r) => r.variant_code === 'holo-fe-sl');
    expect(feSl).toBeDefined();
    expect(feSl?.variant_flags.sort()).toEqual(['FIRST_EDITION', 'SHADOWLESS']);

    // Plain Shadowless print: variant_code `holo-sl`.
    const sl = results.find((r) => r.variant_code === 'holo-sl');
    expect(sl).toBeDefined();
    expect(sl?.variant_flags).toEqual(['SHADOWLESS']);

    // Unlimited print: classifier reads `extra.isUnlimited === true`
    // and emits the UNLIMITED flag.
    const unl = results.find((r) => r.variant_flags.includes('UNLIMITED'));
    expect(unl).toBeDefined();
    expect(unl?.variant_code).toBe('holo-unl');

    // 1999-2000 copyright print: no flags, just `holo`.
    const plain = results.find(
      (r) =>
        !r.variant_flags.includes('UNLIMITED') &&
        !r.variant_flags.includes('SHADOWLESS') &&
        !r.variant_flags.includes('FIRST_EDITION'),
    );
    expect(plain).toBeDefined();
    expect(plain?.variant_code).toBe('holo');
  });

  it('Illustration Rare → FULL_ART (sv01-199)', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.sv01.json'));
    const card = loadCard('card.sv01-199.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isFullArt).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('FULL_ART');
  });

  it('Special Illustration Rare → ALT_ART (sv01-245)', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.sv01.json'));
    const card = loadCard('card.sv01-245.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isAltArt).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('ALT_ART');
  });

  it('Hyper Rare → GOLD (sv01-258)', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.sv01.json'));
    const card = loadCard('card.sv01-258.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isGoldRare).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('GOLD');
  });

  it('Promo set printing → PROMO with isPromo true (swshp-SWSH001)', () => {
    const setRaw = tcgdexSetToRaw(loadSet('set.swshp.json'));
    const card = loadCard('card.swshp-SWSH001.json');
    const cardRaw = tcgdexCardToRaw(card);
    const printings = tcgdexCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isPromo).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('PROMO');
  });

  it('Idempotent: same card transforms to identical printings on repeat call', () => {
    const card = loadCard('card.base1-4.json');
    const a = tcgdexCardToPrintings(card);
    const b = tcgdexCardToPrintings(card);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((p) => p.sourceKey).sort()).toEqual(b.map((p) => p.sourceKey).sort());
  });
});

describe('isTcgdexPromoSet', () => {
  it('matches per-era promo sets', () => {
    expect(isTcgdexPromoSet('basep')).toBe(true);
    expect(isTcgdexPromoSet('swshp')).toBe(true);
    expect(isTcgdexPromoSet('xyp')).toBe(true);
    expect(isTcgdexPromoSet('wp')).toBe(true);
  });

  it('rejects regular numbered sets', () => {
    expect(isTcgdexPromoSet('swsh9')).toBe(false);
    expect(isTcgdexPromoSet('base1')).toBe(false);
    expect(isTcgdexPromoSet('sv01')).toBe(false);
  });

  it('handles empty / whitespace input', () => {
    expect(isTcgdexPromoSet('')).toBe(false);
    expect(isTcgdexPromoSet('  ')).toBe(false);
  });
});
