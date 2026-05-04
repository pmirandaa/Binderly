// Default rules table tests.
//
// Two invariants this file guards:
//   1. `DEFAULT_INCLUDE_BY_CLASS` is exhaustive over `VARIANT_CLASSES`.
//      If someone adds a new class to the enum without updating the
//      table, the test fails loudly.
//   2. `DEFAULT_INCLUDE_BY_CLASS` agrees with the variant classifier's
//      own `decideMasterDefault` for every class. The classifier is
//      the runtime source of truth; this table is documentation.
//      Drift between the two would silently desync downstream
//      behavior.

import { describe, expect, it } from 'vitest';

import {
  VARIANT_CLASSES,
  VARIANT_FLAGS,
  type RawCard,
  type RawPrinting,
  type RawSet,
  type VariantClass,
  type VariantFlag,
} from '../types.js';
import { classifyVariant } from '../variant-classify.js';
import {
  classToTogglePath,
  DEFAULT_INCLUDE_BY_CLASS,
  DEFAULT_INCLUDE_BY_FLAG,
  flagToTogglePath,
  TOGGLE_PRECEDENCE,
} from './rules.js';

// Minimal RawSet/Card stubs. The classifier looks at `printedTotal`
// (for SECRET_RARE numerical fallback) and the card `number` (for
// TG/GG prefix detection) — keep them benign so each test exercises
// just the class signal we care about.
function set(): RawSet {
  return {
    source: 'test',
    sourceKey: 'test-set',
    code: 'test',
    language: 'en',
    name: 'Test',
    series: null,
    releaseDate: '2020-01-01',
    printedTotal: 100,
    total: 110,
    logoUrl: null,
    symbolUrl: null,
  };
}
function card(over: Partial<RawCard> = {}): RawCard {
  return {
    source: 'test',
    sourceKey: 'test-card',
    setCode: 'test',
    language: 'en',
    number: '1',
    name: 'Test',
    nameLocalized: null,
    typeRaw: null,
    subtypeRaw: null,
    hp: null,
    illustrator: null,
    flavorText: null,
    attacks: null,
    weakness: null,
    resistance: null,
    retreatCost: null,
    rarityRaw: null,
    ...over,
  };
}

// Build a `RawPrinting` whose classification will yield `cls`. The
// table maps class → minimal signal set the classifier needs.
function printingForClass(cls: VariantClass): {
  printing: RawPrinting;
  card: RawCard;
} {
  const base: RawPrinting = {
    source: 'test',
    sourceKey: `test-${cls}`,
    cardKey: 'test-card',
    sourcePrintingLabel: null,
    rarityRaw: null,
    isHolo: null,
    isReverseHolo: null,
    isFirstEdition: null,
    isShadowless: null,
    isFullArt: null,
    isAltArt: null,
    isGoldRare: null,
    isRainbowRare: null,
    isTextured: null,
    isTrainerGallery: null,
    isPromo: null,
    isError: null,
    pattern: null,
    stamp: null,
    imageSourceUrl: null,
  };
  switch (cls) {
    case 'HOLO':
      return { printing: { ...base, isHolo: true }, card: card({ number: '1' }) };
    case 'NON_HOLO':
      return { printing: base, card: card({ number: '2' }) };
    case 'REVERSE_HOLO':
      return { printing: { ...base, isReverseHolo: true }, card: card({ number: '3' }) };
    case 'FULL_ART':
      return { printing: { ...base, isFullArt: true }, card: card({ number: '4' }) };
    case 'ALT_ART':
      return { printing: { ...base, isAltArt: true }, card: card({ number: '5' }) };
    case 'SECRET_RARE':
      // Number > printed_total (100), no other class signal.
      return { printing: { ...base, isHolo: true }, card: card({ number: '105' }) };
    case 'GOLD':
      return { printing: { ...base, isGoldRare: true }, card: card({ number: '6' }) };
    case 'RAINBOW':
      return { printing: { ...base, isRainbowRare: true }, card: card({ number: '7' }) };
    case 'TEXTURED':
      return { printing: { ...base, isTextured: true }, card: card({ number: '8' }) };
    case 'TRAINER_GALLERY':
      return {
        printing: { ...base, isTrainerGallery: true, isHolo: true },
        card: card({ number: 'TG01' }),
      };
    case 'PROMO':
      return { printing: { ...base, isPromo: true }, card: card({ number: 'P1' }) };
  }
}

describe('DEFAULT_INCLUDE_BY_CLASS', () => {
  it('covers every VariantClass enum value', () => {
    for (const cls of VARIANT_CLASSES) {
      expect(
        Object.prototype.hasOwnProperty.call(DEFAULT_INCLUDE_BY_CLASS, cls),
        `missing class default for ${cls}`,
      ).toBe(true);
    }
  });

  it('is frozen (immutable at runtime)', () => {
    expect(Object.isFrozen(DEFAULT_INCLUDE_BY_CLASS)).toBe(true);
  });

  it('agrees with the variant classifier for every class', () => {
    const s = set();
    for (const cls of VARIANT_CLASSES) {
      const { printing, card: c } = printingForClass(cls);
      const classified = classifyVariant(printing, c, s);
      expect(classified.variant_class).toBe(cls);
      expect(
        classified.include_in_master_set_default,
        `classifier default for ${cls} != table value`,
      ).toBe(DEFAULT_INCLUDE_BY_CLASS[cls]);
    }
  });
});

describe('DEFAULT_INCLUDE_BY_FLAG', () => {
  it('only forces ERROR and STAMPED_STAFF to false', () => {
    expect(DEFAULT_INCLUDE_BY_FLAG.ERROR).toBe(false);
    expect(DEFAULT_INCLUDE_BY_FLAG.STAMPED_STAFF).toBe(false);
    // Every other flag inherits its class default.
    const forcedFlags = Object.keys(DEFAULT_INCLUDE_BY_FLAG);
    expect(forcedFlags.sort()).toEqual(['ERROR', 'STAMPED_STAFF']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_INCLUDE_BY_FLAG)).toBe(true);
  });
});

describe('flagToTogglePath / classToTogglePath', () => {
  it('flagToTogglePath returns either a known toggle key or null for every flag', () => {
    const validToggleKeys = new Set([
      'include_textured',
      'include_trainer_gallery',
      'include_pattern_variants',
      'include_prerelease',
      'include_league',
      'include_buildbattle',
      'include_championship',
      'include_staff',
      'include_error',
    ]);
    for (const flag of VARIANT_FLAGS) {
      const path = flagToTogglePath(flag);
      if (path !== null) {
        expect(validToggleKeys.has(path)).toBe(true);
      }
    }
  });

  it('classToTogglePath returns either a known toggle key or null for every class', () => {
    const validToggleKeys = new Set(['include_textured', 'include_trainer_gallery']);
    for (const cls of VARIANT_CLASSES) {
      const path = classToTogglePath(cls);
      if (path !== null) {
        expect(validToggleKeys.has(path)).toBe(true);
      }
    }
  });

  it('pattern flags both map to include_pattern_variants', () => {
    expect(flagToTogglePath('POKE_BALL_PATTERN')).toBe('include_pattern_variants');
    expect(flagToTogglePath('MASTER_BALL_PATTERN')).toBe('include_pattern_variants');
  });

  it('FIRST_EDITION / SHADOWLESS / UNLIMITED have no set-level toggle', () => {
    expect(flagToTogglePath('FIRST_EDITION')).toBeNull();
    expect(flagToTogglePath('SHADOWLESS')).toBeNull();
    expect(flagToTogglePath('UNLIMITED')).toBeNull();
  });

  it('COSMOS / GALAXY patterns have no set-level toggle', () => {
    expect(flagToTogglePath('COSMOS_PATTERN')).toBeNull();
    expect(flagToTogglePath('GALAXY_PATTERN')).toBeNull();
  });

  it('TEXTURED flag (vs TEXTURED class) has no toggle', () => {
    // TEXTURED-the-flag (layered on another class) follows the class
    // default; TEXTURED-the-class is governed by classToTogglePath.
    expect(flagToTogglePath('TEXTURED' as VariantFlag)).toBeNull();
  });
});

describe('TOGGLE_PRECEDENCE', () => {
  it('lists every toggle exactly once', () => {
    const list = [...TOGGLE_PRECEDENCE];
    expect(new Set(list).size).toBe(list.length);
  });

  it('staff and error sit at the end (most-restrictive-wins ordering)', () => {
    const len = TOGGLE_PRECEDENCE.length;
    expect(TOGGLE_PRECEDENCE[len - 2]).toBe('include_staff');
    expect(TOGGLE_PRECEDENCE[len - 1]).toBe('include_error');
  });
});
