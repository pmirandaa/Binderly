// Fixture-driven tests for the pure JP transforms. No HTTP — every
// test reads a captured TCGdex JSON response from `./fixtures/` and
// asserts the produced `Raw{Set,Card,Printing}` shapes.
//
// Fixtures are hand-curated to mirror the live `/v2/jp/*` payloads
// (shape parity with EN). Strings are realistic Japanese.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isTcgdexPromoSet,
  tcgdexJpCardToPrintings,
  tcgdexJpCardToRaw,
  tcgdexJpSetToRaw,
} from './transform.js';
import { rawCardSchema, rawPrintingSchema, rawSetSchema } from '../../types.js';
import { classifyVariant } from '../../variant-classify.js';

import type { TCGdexJpCard, TCGdexJpSet } from './api-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadSet(name: string): TCGdexJpSet {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as TCGdexJpSet;
}
function loadCard(name: string): TCGdexJpCard {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as TCGdexJpCard;
}

describe('tcgdexJpSetToRaw', () => {
  it('maps a modern S&S-era set (Star Birth / s9)', () => {
    const set = loadSet('set.s9.json');
    const raw = tcgdexJpSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.source).toBe('tcgdex-jp');
    expect(raw.sourceKey).toBe('s9');
    expect(raw.code).toBe('s9');
    expect(raw.language).toBe('jp');
    expect(raw.name).toBe('スターバース');
    expect(raw.series).toBe('ソード&シールド');
    expect(raw.releaseDate).toBe('2022-01-14');
    expect(raw.printedTotal).toBe(100);
    expect(raw.total).toBe(172);
    expect(raw.logoUrl).toBe('https://assets.tcgdex.net/jp/swsh/s9/logo.png');
    expect(raw.symbolUrl).toBe('https://assets.tcgdex.net/univ/swsh/s9/symbol.png');
    expect(raw.extra?.['abbreviation']).toBe('S9');
    expect(raw.extra?.['serieId']).toBe('swsh');
  });

  it('maps an SV-era set (Triplet Beat / sv1s)', () => {
    const set = loadSet('set.sv1s.json');
    const raw = tcgdexJpSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('sv1s');
    expect(raw.name).toBe('トリプレットビート');
    expect(raw.printedTotal).toBe(71);
    expect(raw.total).toBe(108);
    expect(raw.extra?.['abbreviation']).toBe('SV1S');
  });

  it('maps a promo set (SV Promotion Card Pack / svp)', () => {
    const set = loadSet('set.svp.json');
    const raw = tcgdexJpSetToRaw(set);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('svp');
    expect(isTcgdexPromoSet(raw.code)).toBe(true);
  });
});

describe('tcgdexJpCardToRaw', () => {
  it('maps a Common Pokémon card (s9-001 ナエトル)', () => {
    const card = loadCard('card.s9-001.json');
    const raw = tcgdexJpCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.source).toBe('tcgdex-jp');
    expect(raw.sourceKey).toBe('s9-001');
    expect(raw.setCode).toBe('s9');
    expect(raw.language).toBe('jp');
    expect(raw.number).toBe('001');
    expect(raw.name).toBe('ナエトル');
    expect(raw.typeRaw).toBe('Grass');
    expect(raw.subtypeRaw).toBe('Pokemon');
    expect(raw.hp).toBe(70);
    expect(raw.rarityRaw).toBe('Common');
    expect(raw.attacks).toHaveLength(1);
    expect(raw.extra?.['regulationMark']).toBe('F');
  });

  it('maps an Ultra Rare VSTAR card (s9-018 リザードンVSTAR)', () => {
    const card = loadCard('card.s9-018.json');
    const raw = tcgdexJpCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.rarityRaw).toBe('Holo Rare VSTAR');
    expect(raw.hp).toBe(280);
    expect(raw.extra?.['suffix']).toBe('V');
    expect(raw.extra?.['stage']).toBe('VSTAR');
    expect(raw.extra?.['evolveFrom']).toBe('リザードンV');
  });

  it('maps an Energy card with Hyper Rare tier (sv1s-108)', () => {
    const card = loadCard('card.sv1s-108.json');
    const raw = tcgdexJpCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.subtypeRaw).toBe('Basic Energy');
    expect(raw.rarityRaw).toBe('Hyper Rare');
    expect(raw.extra?.['energyType']).toBe('Normal');
  });

  it('maps an Art Rare card with JP-tier rarity alias (sv1s-073)', () => {
    const card = loadCard('card.sv1s-073.json');
    const raw = tcgdexJpCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.rarityRaw).toBe('Art Rare');
    expect(raw.illustrator).toBe('REND');
  });

  it('maps a Special Art Rare card with JP-tier rarity alias (sv1s-198)', () => {
    const card = loadCard('card.sv1s-198.json');
    const raw = tcgdexJpCardToRaw(card);
    rawCardSchema.parse(raw);
    expect(raw.rarityRaw).toBe('Special Art Rare');
  });
});

describe('tcgdexJpCardToPrintings — via classifyVariant', () => {
  it('Common card with normal+reverse → 2 printings (NON_HOLO + REVERSE_HOLO)', () => {
    const setRaw = tcgdexJpSetToRaw(loadSet('set.s9.json'));
    const card = loadCard('card.s9-001.json');
    const cardRaw = tcgdexJpCardToRaw(card);
    const printings = tcgdexJpCardToPrintings(card);
    printings.forEach((p) => rawPrintingSchema.parse(p));
    expect(printings).toHaveLength(2);

    const classes = printings.map((p) => classifyVariant(p, cardRaw, setRaw).variant_class);
    expect(classes.sort()).toEqual(['NON_HOLO', 'REVERSE_HOLO']);
  });

  it('Holo VSTAR (variants_detailed[type=holo]) → 1 HOLO printing', () => {
    const setRaw = tcgdexJpSetToRaw(loadSet('set.s9.json'));
    const card = loadCard('card.s9-018.json');
    const cardRaw = tcgdexJpCardToRaw(card);
    const printings = tcgdexJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('HOLO');
    expect(cls.variant_code).toBe('holo');
    expect(printings[0]?.imageSourceUrl).toBe('https://assets.tcgdex.net/jp/swsh/s9/018/high.png');
  });

  it('JP-tier "Art Rare" → FULL_ART (sv1s-073)', () => {
    const setRaw = tcgdexJpSetToRaw(loadSet('set.sv1s.json'));
    const card = loadCard('card.sv1s-073.json');
    const cardRaw = tcgdexJpCardToRaw(card);
    const printings = tcgdexJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isFullArt).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('FULL_ART');
  });

  it('JP-tier "Special Art Rare" → ALT_ART (sv1s-198)', () => {
    const setRaw = tcgdexJpSetToRaw(loadSet('set.sv1s.json'));
    const card = loadCard('card.sv1s-198.json');
    const cardRaw = tcgdexJpCardToRaw(card);
    const printings = tcgdexJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isAltArt).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('ALT_ART');
  });

  it('Hyper Rare → GOLD (sv1s-108)', () => {
    const setRaw = tcgdexJpSetToRaw(loadSet('set.sv1s.json'));
    const card = loadCard('card.sv1s-108.json');
    const cardRaw = tcgdexJpCardToRaw(card);
    const printings = tcgdexJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isGoldRare).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('GOLD');
  });

  it('Promo set printing → PROMO with isPromo true (svp-001)', () => {
    const setRaw = tcgdexJpSetToRaw(loadSet('set.svp.json'));
    const card = loadCard('card.svp-001.json');
    const cardRaw = tcgdexJpCardToRaw(card);
    const printings = tcgdexJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isPromo).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('PROMO');
  });

  it('Idempotent: same card transforms to identical printings on repeat call', () => {
    const card = loadCard('card.s9-001.json');
    const a = tcgdexJpCardToPrintings(card);
    const b = tcgdexJpCardToPrintings(card);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((p) => p.sourceKey).sort()).toEqual(b.map((p) => p.sourceKey).sort());
  });
});

describe('isTcgdexPromoSet (re-exported)', () => {
  it('matches JP-side promo sets sharing the suffix-`p` rule', () => {
    expect(isTcgdexPromoSet('svp')).toBe(true);
    expect(isTcgdexPromoSet('smp')).toBe(true);
    expect(isTcgdexPromoSet('xyp')).toBe(true);
  });

  it('rejects regular numbered JP sets', () => {
    expect(isTcgdexPromoSet('s9')).toBe(false);
    expect(isTcgdexPromoSet('sv1s')).toBe(false);
    expect(isTcgdexPromoSet('sm1s')).toBe(false);
  });
});
