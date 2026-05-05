// Tests for `cards.ts`. Each schema gets at least one positive
// case (valid input parses) and one negative case (invalid input
// is rejected).

import { describe, expect, it } from 'vitest';

import {
  cardDto,
  cardSubtypeSchema,
  cardWithPrintingsDto,
  pokemonTypeSchema,
  printingDto,
  printingWithContextDto,
  raritySchema,
  setDto,
  variantClassSchema,
  variantFlagSchema,
} from './cards.js';

const NOW = '2026-05-05T12:00:00Z';
const SET_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CARD_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PRINTING_ID = 'cccccccc-3333-4333-8333-cccccccccccc';

const VALID_SET = {
  id: SET_ID,
  canonicalKey: 'en-swsh9',
  code: 'swsh9',
  language: 'en' as const,
  name: 'Brilliant Stars',
  series: 'Sword & Shield',
  releaseDate: '2022-02-25',
  printedTotal: 172,
  total: 186,
  logoUrl: 'https://images.binderly.app/sets/swsh9/logo.webp',
  symbolUrl: 'https://images.binderly.app/sets/swsh9/symbol.webp',
  masterSetRules: { include_pattern_variants: true },
  createdAt: NOW,
  updatedAt: NOW,
};

const VALID_CARD = {
  id: CARD_ID,
  canonicalKey: 'en-swsh9-018',
  setId: SET_ID,
  language: 'en' as const,
  number: '018',
  name: 'Charizard VSTAR',
  nameLocalized: { en: 'Charizard VSTAR', jp: 'リザードンVSTAR' },
  type: 'FIRE' as const,
  subtype: 'POKEMON' as const,
  hp: 280,
  illustrator: '5ban Graphics',
  flavorText: null,
  attacks: [{ name: 'Star Blaze' }],
  weakness: [{ type: 'WATER', value: '×2' }],
  resistance: null,
  retreatCost: 2,
  rarity: 'ULTRA_RARE' as const,
  createdAt: NOW,
  updatedAt: NOW,
};

const VALID_PRINTING = {
  id: PRINTING_ID,
  variantKey: 'en-swsh9-018-holo',
  cardId: CARD_ID,
  variantClass: 'HOLO' as const,
  variantFlags: [],
  variantCode: 'holo',
  includeInMasterSet: true,
  imageSmallUrl: 'https://images.binderly.app/printings/en-swsh9-018-holo/small.webp',
  imageLargeUrl: 'https://images.binderly.app/printings/en-swsh9-018-holo/large.webp',
  createdAt: NOW,
  updatedAt: NOW,
};

describe('variantClassSchema', () => {
  it('accepts canonical variant classes', () => {
    expect(variantClassSchema.parse('HOLO')).toBe('HOLO');
    expect(variantClassSchema.parse('TRAINER_GALLERY')).toBe('TRAINER_GALLERY');
  });

  it('rejects unknown classes', () => {
    expect(variantClassSchema.safeParse('SHINY_HOLO').success).toBe(false);
  });
});

describe('variantFlagSchema', () => {
  it('accepts FIRST_EDITION', () => {
    expect(variantFlagSchema.parse('FIRST_EDITION')).toBe('FIRST_EDITION');
  });

  it('rejects unknown flags', () => {
    expect(variantFlagSchema.safeParse('SHINY').success).toBe(false);
  });
});

describe('raritySchema', () => {
  it('accepts canonical rarities', () => {
    expect(raritySchema.parse('SECRET_RARE')).toBe('SECRET_RARE');
  });

  it('rejects unknown rarities', () => {
    expect(raritySchema.safeParse('LEGENDARY').success).toBe(false);
  });
});

describe('pokemonTypeSchema', () => {
  it('accepts canonical types', () => {
    expect(pokemonTypeSchema.parse('FIRE')).toBe('FIRE');
  });

  it('rejects unknown types', () => {
    expect(pokemonTypeSchema.safeParse('POISON').success).toBe(false);
  });
});

describe('cardSubtypeSchema', () => {
  it('accepts POKEMON and trainer subtypes', () => {
    expect(cardSubtypeSchema.parse('POKEMON')).toBe('POKEMON');
    expect(cardSubtypeSchema.parse('TRAINER_SUPPORTER')).toBe('TRAINER_SUPPORTER');
  });

  it('rejects unknown subtypes', () => {
    expect(cardSubtypeSchema.safeParse('TRAINER_OBJECT').success).toBe(false);
  });
});

describe('setDto', () => {
  it('parses a fully-populated set', () => {
    expect(setDto.parse(VALID_SET).code).toBe('swsh9');
  });

  it('parses a set with nullable fields null', () => {
    const minimal = {
      ...VALID_SET,
      series: null,
      printedTotal: null,
      total: null,
      logoUrl: null,
      symbolUrl: null,
    };
    expect(setDto.parse(minimal).series).toBeNull();
  });

  it('rejects an unknown extra key (strict)', () => {
    expect(setDto.safeParse({ ...VALID_SET, sourceMetadata: { tcgdex: {} } }).success).toBe(false);
  });

  it('rejects a non-ISO releaseDate', () => {
    expect(setDto.safeParse({ ...VALID_SET, releaseDate: '2022/02/25' }).success).toBe(false);
  });
});

describe('cardDto', () => {
  it('parses a fully-populated card', () => {
    expect(cardDto.parse(VALID_CARD).number).toBe('018');
  });

  it('rejects an invalid type enum', () => {
    expect(cardDto.safeParse({ ...VALID_CARD, type: 'POISON' }).success).toBe(false);
  });

  it('rejects an unknown extra key (strict)', () => {
    expect(cardDto.safeParse({ ...VALID_CARD, sourceMetadata: { tcgdex: {} } }).success).toBe(
      false,
    );
  });
});

describe('printingDto', () => {
  it('parses a holo printing', () => {
    expect(printingDto.parse(VALID_PRINTING).variantClass).toBe('HOLO');
  });

  it('parses a printing with stacked flags', () => {
    expect(
      printingDto.parse({
        ...VALID_PRINTING,
        variantClass: 'HOLO',
        variantFlags: ['FIRST_EDITION', 'SHADOWLESS'],
        variantCode: 'holo-fe-sl',
      }).variantFlags.length,
    ).toBe(2);
  });

  it('rejects unknown variantFlags', () => {
    expect(
      printingDto.safeParse({
        ...VALID_PRINTING,
        variantFlags: ['NOT_A_REAL_FLAG'],
      }).success,
    ).toBe(false);
  });

  it('rejects when imageSourceUrl leaks (strict)', () => {
    expect(
      printingDto.safeParse({
        ...VALID_PRINTING,
        imageSourceUrl: 'https://upstream/source.png',
      }).success,
    ).toBe(false);
  });
});

describe('cardWithPrintingsDto', () => {
  it('parses a card with its printings inlined', () => {
    expect(
      cardWithPrintingsDto.parse({ ...VALID_CARD, printings: [VALID_PRINTING] }).printings.length,
    ).toBe(1);
  });

  it('rejects when printings is missing', () => {
    expect(cardWithPrintingsDto.safeParse(VALID_CARD).success).toBe(false);
  });
});

describe('printingWithContextDto', () => {
  it('parses a printing with card + set context', () => {
    expect(
      printingWithContextDto.parse({ ...VALID_PRINTING, card: VALID_CARD, set: VALID_SET }).set
        .code,
    ).toBe('swsh9');
  });

  it('rejects when set context is missing', () => {
    expect(printingWithContextDto.safeParse({ ...VALID_PRINTING, card: VALID_CARD }).success).toBe(
      false,
    );
  });
});
