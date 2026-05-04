// Fixture-driven tests for the pure Bulbapedia transforms. No HTTP —
// every test reads a hand-authored wikitext fixture and asserts the
// produced `Raw{Set,Card,Printing}` shapes.
//
// Fixtures are intentionally synthetic (Bulbapedia's anti-bot measures
// reject `WebFetch` from this environment, see the elaborated task
// notes appendix). Each fixture is hand-modeled against Bulbapedia's
// documented `CardInfobox` / `SetInfobox` template signatures.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  bulbapediaParsedCardToPrintings,
  bulbapediaParsedCardToRaw,
  bulbapediaParsedSetToRaw,
  bulbapediaWikitextToCard,
  bulbapediaWikitextToPrintings,
  bulbapediaWikitextToSet,
  isBulbapediaPromoSet,
  padCardNumber,
  resolveBulbapediaSetCode,
} from './transform.js';
import { rawCardSchema, rawPrintingSchema, rawSetSchema } from '../../types.js';
import { classifyVariant } from '../../variant-classify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');

function wt(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

// ============================================================
// Set transforms
// ============================================================

describe('bulbapediaWikitextToSet', () => {
  it('maps Base Set with mapped TCGdex code (base1)', () => {
    const raw = bulbapediaWikitextToSet('Base Set (TCG)', wt('wikitext.set-base-set.txt'));
    rawSetSchema.parse(raw);
    expect(raw.source).toBe('bulbapedia-en');
    expect(raw.sourceKey).toBe('Base Set (TCG)');
    expect(raw.code).toBe('base1');
    expect(raw.language).toBe('en');
    expect(raw.name).toBe('Base Set');
    expect(raw.series).toBe('Original');
    expect(raw.releaseDate).toBe('1999-01-09');
    expect(raw.printedTotal).toBe(102);
    expect(raw.total).toBe(102);
    expect(raw.logoUrl).toBeNull();
    expect(raw.symbolUrl).toBeNull();
    expect(raw.extra?.['bulbapediaTitle']).toBe('Base Set (TCG)');
    expect(raw.extra?.['bulbapediaSetName']).toBe('Base Set');
    expect(raw.extra?.['japaneseName']).toBe('拡張パック 第1弾');
  });

  it('maps Brilliant Stars (modern) with secret-rare total > printedTotal', () => {
    const raw = bulbapediaWikitextToSet(
      'Brilliant Stars (TCG)',
      wt('wikitext.set-brilliant-stars.txt'),
    );
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('swsh9');
    expect(raw.printedTotal).toBe(172);
    expect(raw.total).toBe(216);
    expect(raw.releaseDate).toBe('2022-02-25');
    expect(raw.series).toBe('Sword & Shield');
  });

  it('maps SWSH Black Star Promos (promo set)', () => {
    const raw = bulbapediaWikitextToSet(
      'SWSH Black Star Promos (TCG)',
      wt('wikitext.set-swsh-promos.txt'),
    );
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('swshp');
    expect(isBulbapediaPromoSet(raw.name)).toBe(true);
  });

  it('throws when releaseDate is missing (filler-tier MUST carry the join axis)', () => {
    expect(() =>
      bulbapediaParsedSetToRaw({
        pageTitle: 'Foo (TCG)',
        name: 'Foo',
        printedTotal: 1,
      }),
    ).toThrow(/releaseDate/);
  });

  it('throws when neither pageTitle nor name yields a set name', () => {
    expect(() =>
      bulbapediaParsedSetToRaw({
        pageTitle: '   ',
      }),
    ).toThrow();
  });

  it('falls back to slug for sets not in the TCGdex code table', () => {
    const raw = bulbapediaParsedSetToRaw({
      pageTitle: 'Made-Up Set (TCG)',
      name: 'Made-Up Set',
      releaseDate: '2030-01-01',
      printedTotal: 50,
    });
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('bulbapedia-made-up-set');
  });
});

// ============================================================
// Card transform
// ============================================================

describe('bulbapediaWikitextToCard', () => {
  it('maps Base Set Charizard (vintage Pokémon, holo, mapped set code)', () => {
    const raw = bulbapediaWikitextToCard(
      'Charizard (Base Set 4)',
      wt('wikitext.charizard-base-set-4.txt'),
    );
    rawCardSchema.parse(raw);
    expect(raw.source).toBe('bulbapedia-en');
    expect(raw.sourceKey).toBe('Charizard (Base Set 4)');
    expect(raw.setCode).toBe('base1');
    expect(raw.language).toBe('en');
    expect(raw.number).toBe('004');
    expect(raw.name).toBe('Charizard');
    expect(raw.typeRaw).toBe('Fire');
    expect(raw.subtypeRaw).toBe('Pokemon');
    expect(raw.hp).toBe(120);
    expect(raw.illustrator).toBe('Mitsuhiro Arita');
    expect(raw.retreatCost).toBe(3);
    expect(raw.rarityRaw).toBe('Holo Rare');
    expect(raw.nameLocalized).toEqual({ jp: 'リザードン' });
    expect(raw.extra?.['evostage']).toBe('Stage 2');
    expect(raw.extra?.['evolveFrom']).toBe('Charmeleon');
    expect(raw.extra?.['species']).toBe('Charizard');
    expect(raw.extra?.['cardno']).toBe('4/102');
    expect(raw.extra?.['expansion']).toBe('Base Set');
    expect(raw.extra?.['class']).toBe('Holographic');
    expect(raw.extra?.['bulbapediaTitle']).toBe('Charizard (Base Set 4)');
  });

  it('maps Charizard VSTAR Brilliant Stars 174 (modern rainbow, regulationMark uppercased)', () => {
    const raw = bulbapediaWikitextToCard(
      'Charizard VSTAR (Brilliant Stars 174)',
      wt('wikitext.charizard-vstar-rainbow.txt'),
    );
    rawCardSchema.parse(raw);
    expect(raw.setCode).toBe('swsh9');
    expect(raw.number).toBe('174');
    expect(raw.name).toBe('Charizard VSTAR');
    expect(raw.typeRaw).toBe('Fire');
    expect(raw.hp).toBe(280);
    expect(raw.rarityRaw).toBe('Rare Rainbow');
    expect(raw.illustrator).toBe('Aky CG Works');
    expect(raw.extra?.['regulationMark']).toBe('F');
    expect(raw.extra?.['class']).toBe('Rainbow Rare');
    expect(raw.extra?.['evostage']).toBe('VSTAR');
  });

  it('maps Lugia V SWSH Black Star Promo (lettered number, staff stamp)', () => {
    const raw = bulbapediaWikitextToCard(
      'Lugia V (SWSH Black Star Promos 285)',
      wt('wikitext.lugia-staff-promo.txt'),
    );
    rawCardSchema.parse(raw);
    expect(raw.setCode).toBe('swshp');
    expect(raw.number).toBe('SWSH285');
    expect(raw.name).toBe('Lugia V');
    expect(raw.rarityRaw).toBe('Promo');
    expect(raw.extra?.['expansion']).toBe('SWSH Black Star Promos');
  });

  it('throws when setName is missing (the set-join axis is mandatory)', () => {
    expect(() =>
      bulbapediaParsedCardToRaw({
        pageTitle: 'Foo (Bar 1)',
        name: 'Foo',
        number: '1',
      }),
    ).toThrow(/setName/);
  });

  it('throws when name is missing', () => {
    expect(() =>
      bulbapediaParsedCardToRaw({
        pageTitle: 'Foo (Bar 1)',
        setName: 'Bar',
        number: '1',
      }),
    ).toThrow(/name/);
  });

  it('throws when number is missing', () => {
    expect(() =>
      bulbapediaParsedCardToRaw({
        pageTitle: 'Foo (Bar 1)',
        setName: 'Bar',
        name: 'Foo',
      }),
    ).toThrow(/number/);
  });
});

// ============================================================
// Printing transforms — through the variant classifier
// ============================================================

describe('bulbapediaWikitextToPrintings — via classifyVariant', () => {
  it('Base Set Charizard → 3 HOLO printings (1stEd+SL / SL / Unlimited) all FE/SL/UNL flagged correctly', () => {
    const setRaw = bulbapediaWikitextToSet('Base Set (TCG)', wt('wikitext.set-base-set.txt'));
    const cardRaw = bulbapediaWikitextToCard(
      'Charizard (Base Set 4)',
      wt('wikitext.charizard-base-set-4.txt'),
    );
    const printings = bulbapediaWikitextToPrintings(
      'Charizard (Base Set 4)',
      wt('wikitext.charizard-base-set-4.txt'),
    );
    printings.forEach((p) => rawPrintingSchema.parse(p));
    expect(printings).toHaveLength(3);

    expect(printings.every((p) => p.cardKey === 'Charizard (Base Set 4)')).toBe(true);
    // sourceKey is `${pageTitle}-${variantTag}` and unique per print.
    const keys = printings.map((p) => p.sourceKey);
    expect(new Set(keys).size).toBe(3);

    const results = printings.map((p) => ({
      sourceKey: p.sourceKey,
      label: p.sourcePrintingLabel,
      isHolo: p.isHolo,
      isFirstEdition: p.isFirstEdition,
      isShadowless: p.isShadowless,
      ...classifyVariant(p, cardRaw, setRaw),
    }));
    expect(results.every((r) => r.variant_class === 'HOLO')).toBe(true);
    expect(results.every((r) => r.isHolo === true)).toBe(true);

    const feSl = results.find((r) => r.isFirstEdition && r.isShadowless);
    expect(feSl).toBeDefined();
    expect(feSl?.variant_flags.sort()).toEqual(['FIRST_EDITION', 'SHADOWLESS']);
    expect(feSl?.variant_code).toBe('holo-fe-sl');

    const sl = results.find((r) => !r.isFirstEdition && r.isShadowless);
    expect(sl).toBeDefined();
    expect(sl?.variant_flags).toEqual(['SHADOWLESS']);
    expect(sl?.variant_code).toBe('holo-sl');

    const unl = results.find((r) => r.variant_flags.includes('UNLIMITED'));
    expect(unl).toBeDefined();
    expect(unl?.variant_code).toBe('holo-unl');
  });

  it('Charizard VSTAR Rainbow → single RAINBOW printing (number > printed_total but rainbow signal wins)', () => {
    const setRaw = bulbapediaWikitextToSet(
      'Brilliant Stars (TCG)',
      wt('wikitext.set-brilliant-stars.txt'),
    );
    const cardRaw = bulbapediaWikitextToCard(
      'Charizard VSTAR (Brilliant Stars 174)',
      wt('wikitext.charizard-vstar-rainbow.txt'),
    );
    const printings = bulbapediaWikitextToPrintings(
      'Charizard VSTAR (Brilliant Stars 174)',
      wt('wikitext.charizard-vstar-rainbow.txt'),
    );
    printings.forEach((p) => rawPrintingSchema.parse(p));
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isRainbowRare).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('RAINBOW');
    expect(cls.variant_code).toBe('rainbow');
    // Bulbapedia images are explicitly NOT rehosted (CC-BY-NC-SA).
    expect(printings[0]?.imageSourceUrl).toBeNull();
  });

  it('Lugia V Staff Promo → PROMO + STAMPED_STAFF flag', () => {
    const setRaw = bulbapediaWikitextToSet(
      'SWSH Black Star Promos (TCG)',
      wt('wikitext.set-swsh-promos.txt'),
    );
    const cardRaw = bulbapediaWikitextToCard(
      'Lugia V (SWSH Black Star Promos 285)',
      wt('wikitext.lugia-staff-promo.txt'),
    );
    const printings = bulbapediaWikitextToPrintings(
      'Lugia V (SWSH Black Star Promos 285)',
      wt('wikitext.lugia-staff-promo.txt'),
    );
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isPromo).toBe(true);
    expect(printings[0]?.stamp).toBe('STAFF');
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('PROMO');
    expect(cls.variant_flags).toContain('STAMPED_STAFF');
  });

  it('Trainer Gallery prefix → TRAINER_GALLERY (synthetic)', () => {
    const setRaw = bulbapediaParsedSetToRaw({
      pageTitle: 'Brilliant Stars (TCG)',
      name: 'Brilliant Stars',
      releaseDate: '2022-02-25',
      printedTotal: 172,
      total: 216,
    });
    const printings = bulbapediaParsedCardToPrintings({
      pageTitle: 'Charizard (Brilliant Stars TG03)',
      name: 'Charizard',
      setName: 'Brilliant Stars',
      number: 'TG03',
      class: 'Holographic',
      rarity: 'Trainer Gallery Rare Holo',
      type: 'Fire',
      hp: 170,
    });
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isTrainerGallery).toBe(true);
    const cardRaw = bulbapediaParsedCardToRaw({
      pageTitle: 'Charizard (Brilliant Stars TG03)',
      name: 'Charizard',
      setName: 'Brilliant Stars',
      number: 'TG03',
      type: 'Fire',
      hp: 170,
      species: 'Charizard',
    });
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('TRAINER_GALLERY');
  });

  it('Idempotent: same wikitext → identical printings on repeat call', () => {
    const a = bulbapediaWikitextToPrintings(
      'Charizard (Base Set 4)',
      wt('wikitext.charizard-base-set-4.txt'),
    );
    const b = bulbapediaWikitextToPrintings(
      'Charizard (Base Set 4)',
      wt('wikitext.charizard-base-set-4.txt'),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((p) => p.sourceKey).sort()).toEqual(b.map((p) => p.sourceKey).sort());
  });

  it('Empty parsed card with no infobox → empty printings array (no crash)', () => {
    const printings = bulbapediaParsedCardToPrintings({
      pageTitle: 'Foo (Bar 1)',
    });
    expect(printings).toEqual([]);
  });

  it('Card with set name but no class signal in a non-promo set still emits no printing', () => {
    const printings = bulbapediaParsedCardToPrintings({
      pageTitle: 'Foo (Bar 1)',
      name: 'Foo',
      setName: 'Bar',
      number: '1',
    });
    expect(printings).toEqual([]);
  });
});

// ============================================================
// Helpers
// ============================================================

describe('padCardNumber', () => {
  it('pads pure numerics to 3', () => {
    expect(padCardNumber('1')).toBe('001');
    expect(padCardNumber('4')).toBe('004');
    expect(padCardNumber('100')).toBe('100');
    expect(padCardNumber('216')).toBe('216');
  });

  it('preserves lettered tokens verbatim (rule 01-data-layer)', () => {
    expect(padCardNumber('TG01')).toBe('TG01');
    expect(padCardNumber('GG14')).toBe('GG14');
    expect(padCardNumber('SWSH285')).toBe('SWSH285');
  });

  it('returns empty for empty input', () => {
    expect(padCardNumber('')).toBe('');
  });
});

describe('resolveBulbapediaSetCode', () => {
  it('returns mapped TCGdex code for known sets', () => {
    expect(resolveBulbapediaSetCode('Base Set')).toBe('base1');
    expect(resolveBulbapediaSetCode('Brilliant Stars')).toBe('swsh9');
    expect(resolveBulbapediaSetCode('SWSH Black Star Promos')).toBe('swshp');
  });

  it('falls back to slug for unmapped sets', () => {
    expect(resolveBulbapediaSetCode('Made-Up Set')).toBe('bulbapedia-made-up-set');
    expect(resolveBulbapediaSetCode('Pokémon Stamp Set')).toBe('bulbapedia-pok-mon-stamp-set');
  });
});

describe('isBulbapediaPromoSet', () => {
  it('matches Black Star Promo sets', () => {
    expect(isBulbapediaPromoSet('SWSH Black Star Promos')).toBe(true);
    expect(isBulbapediaPromoSet('SM Black Star Promos')).toBe(true);
    expect(isBulbapediaPromoSet('Wizards Black Star Promos')).toBe(true);
  });

  it('rejects regular numbered sets', () => {
    expect(isBulbapediaPromoSet('Base Set')).toBe(false);
    expect(isBulbapediaPromoSet('Brilliant Stars')).toBe(false);
  });

  it('handles empty input', () => {
    expect(isBulbapediaPromoSet('')).toBe(false);
  });
});
