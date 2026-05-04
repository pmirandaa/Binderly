// Fixture-driven tests for the pure Pokemon-Card.com transforms.
// Every test reads a captured HTML response from `./fixtures/` and
// asserts the produced parsed struct + `Raw{Set,Card,Printing}`
// shapes (round-tripped through the zod schemas).
//
// Coverage targets:
//   - Set parser: SV-era + Sword & Shield-era expansion pages.
//   - Card parser: Common / Super Rare / Special Art Rare / Promo.
//   - "Card not found" body shape → null from the parser.
//   - Variant raw signals feed `classifyVariant` correctly:
//       AR → FULL_ART, SAR → ALT_ART, HR → GOLD, Promo → PROMO.
//   - `RawPrinting.sourceKey = ${pcjpCardId}-${variantTag}` idempotency.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  POKEMONCARD_JP_SOURCE,
  pokemonCardJpCardToPrintings,
  pokemonCardJpCardToRaw,
  pokemonCardJpHtmlToCard,
  pokemonCardJpHtmlToSet,
  pokemonCardJpSetToRaw,
} from './transform.js';
import { rawCardSchema, rawPrintingSchema, rawSetSchema } from '../../types.js';
import { classifyVariant } from '../../variant-classify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

// ============================================================
// Stage 1: HTML → parsed struct
// ============================================================

describe('pokemonCardJpHtmlToSet', () => {
  it('parses a modern SV-era expansion page (Triplet Beat / sv1s)', () => {
    const set = pokemonCardJpHtmlToSet(fixture('set.sv1s.html'), { pcjpSetId: '3186' });
    expect(set).not.toBeNull();
    expect(set?.pcjpSetId).toBe('3186');
    expect(set?.name).toBe('トリプレットビート');
    expect(set?.shortCode).toBe('SV1S');
    expect(set?.releaseDate).toBe('2023-03-10');
    expect(set?.series).toBe('スカーレット&バイオレット');
    expect(set?.logoUrl).toBe('https://www.pokemon-card.com/assets/img/expansion/sv1s/logo.png');
    expect(set?.symbolUrl).toBe(
      'https://www.pokemon-card.com/assets/img/expansion/sv1s/symbol.png',
    );
  });

  it('parses an S&S-era expansion page (Star Birth / s9)', () => {
    const set = pokemonCardJpHtmlToSet(fixture('set.s9.html'), { pcjpSetId: '2920' });
    expect(set).not.toBeNull();
    expect(set?.pcjpSetId).toBe('2920');
    expect(set?.name).toBe('スターバース');
    expect(set?.shortCode).toBe('S9');
    expect(set?.releaseDate).toBe('2022-01-14');
    expect(set?.series).toBe('ソード&シールド');
  });

  it('returns null when the expansion header is missing', () => {
    const set = pokemonCardJpHtmlToSet('<html><body><p>nope</p></body></html>', {
      pcjpSetId: '0',
    });
    expect(set).toBeNull();
  });
});

describe('pokemonCardJpHtmlToCard', () => {
  it('parses a Common Pokémon card (s9-001 ナエトル)', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.s9-001-c.html'), {
      pcjpCardId: '40001',
    });
    expect(card).not.toBeNull();
    expect(card?.pcjpCardId).toBe('40001');
    expect(card?.shortCode).toBe('S9');
    expect(card?.number).toBe('001');
    expect(card?.name).toBe('ナエトル');
    expect(card?.type).toBe('Grass');
    expect(card?.subtype).toBe('Pokemon');
    expect(card?.hp).toBe(70);
    expect(card?.rarityGlyph).toBe('C');
    expect(card?.rarityLabel).toBe('Common');
    expect(card?.weakness).toEqual([{ type: 'Fire', value: '×2' }]);
    expect(card?.retreatCost).toBe(1);
    expect(card?.imageUrl).toBe('https://www.pokemon-card.com/assets/img/card/s9/001.jpg');
  });

  it('parses an SR card (s9-018 リザードンVSTAR)', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.s9-018-sr.html'), {
      pcjpCardId: '40018',
    });
    expect(card).not.toBeNull();
    expect(card?.name).toBe('リザードンVSTAR');
    expect(card?.shortCode).toBe('S9');
    expect(card?.number).toBe('018');
    expect(card?.hp).toBe(280);
    expect(card?.type).toBe('Fire');
    expect(card?.rarityGlyph).toBe('RRR');
    expect(card?.rarityLabel).toBe('Super Rare');
  });

  it('parses an SAR card (sv1s-198)', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.sv1s-198-sar.html'), {
      pcjpCardId: '46892',
    });
    expect(card).not.toBeNull();
    expect(card?.name).toBe('ニャオハ');
    expect(card?.shortCode).toBe('SV1S');
    expect(card?.number).toBe('198');
    expect(card?.rarityGlyph).toBe('SAR');
    expect(card?.rarityLabel).toBe('Special Art Rare');
    expect(card?.illustrator).toBe('Akira Komayama');
  });

  it('parses a Promo card (svp-001)', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.svp-001-promo.html'), {
      pcjpCardId: '50001',
    });
    expect(card).not.toBeNull();
    expect(card?.name).toBe('ピカチュウ');
    expect(card?.shortCode).toBe('SVP');
    expect(card?.number).toBe('001');
    expect(card?.rarityGlyph).toBe('PROMO');
    expect(card?.rarityLabel).toBe('Promo');
  });

  it('returns null on a "card not found" body shape', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.notfound.html'), {
      pcjpCardId: '999999',
    });
    expect(card).toBeNull();
  });
});

// ============================================================
// Stage 2: parsed struct → Raw*
// ============================================================

describe('pokemonCardJpSetToRaw', () => {
  it('matches an SV-era set to its TCGdex JP code (sv1s)', () => {
    const set = pokemonCardJpHtmlToSet(fixture('set.sv1s.html'), { pcjpSetId: '3186' });
    const raw = pokemonCardJpSetToRaw(set!);
    rawSetSchema.parse(raw);
    expect(raw.source).toBe(POKEMONCARD_JP_SOURCE);
    expect(raw.sourceKey).toBe('3186');
    expect(raw.code).toBe('sv1s');
    expect(raw.language).toBe('jp');
    expect(raw.name).toBe('トリプレットビート');
    expect(raw.releaseDate).toBe('2023-03-10');
    expect(raw.printedTotal).toBeNull();
    expect(raw.total).toBeNull();
    expect(raw.extra?.['pcjpSetId']).toBe('3186');
    expect(raw.extra?.['shortCode']).toBe('SV1S');
  });

  it('matches an S&S-era set to its TCGdex JP code (s9)', () => {
    const set = pokemonCardJpHtmlToSet(fixture('set.s9.html'), { pcjpSetId: '2920' });
    const raw = pokemonCardJpSetToRaw(set!);
    rawSetSchema.parse(raw);
    expect(raw.code).toBe('s9');
    expect(raw.releaseDate).toBe('2022-01-14');
  });
});

describe('pokemonCardJpCardToRaw', () => {
  it('maps a Common card', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.s9-001-c.html'), {
      pcjpCardId: '40001',
    });
    const raw = pokemonCardJpCardToRaw(card!);
    rawCardSchema.parse(raw);
    expect(raw.source).toBe(POKEMONCARD_JP_SOURCE);
    expect(raw.sourceKey).toBe('40001');
    expect(raw.setCode).toBe('s9');
    expect(raw.language).toBe('jp');
    expect(raw.number).toBe('001');
    expect(raw.name).toBe('ナエトル');
    expect(raw.typeRaw).toBe('Grass');
    expect(raw.subtypeRaw).toBe('Pokemon');
    expect(raw.hp).toBe(70);
    expect(raw.rarityRaw).toBe('Common');
    expect(raw.attacks).toBeNull();
    expect(raw.extra?.['pcjpCardId']).toBe('40001');
    expect(raw.extra?.['rarityGlyph']).toBe('C');
  });

  it('maps an SAR card with the Special Art Rare alias', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.sv1s-198-sar.html'), {
      pcjpCardId: '46892',
    });
    const raw = pokemonCardJpCardToRaw(card!);
    rawCardSchema.parse(raw);
    expect(raw.setCode).toBe('sv1s');
    expect(raw.rarityRaw).toBe('Special Art Rare');
    expect(raw.illustrator).toBe('Akira Komayama');
  });
});

describe('pokemonCardJpCardToPrintings — variant raw signals', () => {
  it('Common → NON_HOLO (no holo signals; classifier defaults to NON_HOLO)', () => {
    const setRaw = pokemonCardJpSetToRaw(
      pokemonCardJpHtmlToSet(fixture('set.s9.html'), { pcjpSetId: '2920' })!,
    );
    const card = pokemonCardJpHtmlToCard(fixture('card.s9-001-c.html'), {
      pcjpCardId: '40001',
    })!;
    const cardRaw = pokemonCardJpCardToRaw(card);
    const printings = pokemonCardJpCardToPrintings(card);
    printings.forEach((p) => rawPrintingSchema.parse(p));
    expect(printings).toHaveLength(1);
    expect(printings[0]?.sourceKey).toBe('40001-c');
    expect(printings[0]?.cardKey).toBe('40001');
    expect(printings[0]?.isHolo).toBe(false);
    expect(printings[0]?.isFullArt).toBe(false);
    expect(printings[0]?.isAltArt).toBe(false);
    expect(printings[0]?.isPromo).toBe(false);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('NON_HOLO');
  });

  it('SR → HOLO (isHolo true)', () => {
    const setRaw = pokemonCardJpSetToRaw(
      pokemonCardJpHtmlToSet(fixture('set.s9.html'), { pcjpSetId: '2920' })!,
    );
    const card = pokemonCardJpHtmlToCard(fixture('card.s9-018-sr.html'), {
      pcjpCardId: '40018',
    })!;
    const cardRaw = pokemonCardJpCardToRaw(card);
    const printings = pokemonCardJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isHolo).toBe(true);
    expect(printings[0]?.sourceKey).toBe('40018-rrr');
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('HOLO');
  });

  it('SAR → ALT_ART (isAltArt true)', () => {
    const setRaw = pokemonCardJpSetToRaw(
      pokemonCardJpHtmlToSet(fixture('set.sv1s.html'), { pcjpSetId: '3186' })!,
    );
    const card = pokemonCardJpHtmlToCard(fixture('card.sv1s-198-sar.html'), {
      pcjpCardId: '46892',
    })!;
    const cardRaw = pokemonCardJpCardToRaw(card);
    const printings = pokemonCardJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isAltArt).toBe(true);
    expect(printings[0]?.isFullArt).toBe(false);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('ALT_ART');
  });

  it('Promo set printing → PROMO (isPromo true)', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.svp-001-promo.html'), {
      pcjpCardId: '50001',
    })!;
    const cardRaw = pokemonCardJpCardToRaw(card);
    // Construct a synthetic SVP set raw (no fixture for svp landing).
    const setRaw = pokemonCardJpSetToRaw({
      pcjpSetId: '3000',
      shortCode: 'SVP',
      name: 'プロモカードパック',
      series: null,
      releaseDate: '2023-01-20',
      logoUrl: null,
      symbolUrl: null,
    });
    const printings = pokemonCardJpCardToPrintings(card);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.isPromo).toBe(true);
    const cls = classifyVariant(printings[0]!, cardRaw, setRaw);
    expect(cls.variant_class).toBe('PROMO');
  });

  it('Idempotent: two runs over the same fixture produce identical printings', () => {
    const card = pokemonCardJpHtmlToCard(fixture('card.s9-018-sr.html'), {
      pcjpCardId: '40018',
    })!;
    const a = pokemonCardJpCardToPrintings(card);
    const b = pokemonCardJpCardToPrintings(card);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a[0]?.sourceKey).toBe(b[0]?.sourceKey);
  });
});
