// Variant classifier tests.
//
// Every edge case from `context/tcg-domain.md` § 3 (the "painful list")
// has at least one named test below. § 8 decision-tree precedence is
// covered by `decision-tree precedence` block.

import { describe, expect, it } from 'vitest';

import { assembleVariantCode, classifyVariant } from './variant-classify.js';

import type { RawCard, RawPrinting, RawSet } from './types.js';

// Test factories — only override what each case cares about.
function set(over: Partial<RawSet> = {}): RawSet {
  return {
    source: 'test',
    sourceKey: 'test-set',
    code: 'base1',
    language: 'en',
    name: 'Base Set',
    series: 'Base',
    releaseDate: '1999-01-09',
    printedTotal: 102,
    total: 102,
    logoUrl: null,
    symbolUrl: null,
    ...over,
  };
}

function card(over: Partial<RawCard> = {}): RawCard {
  return {
    source: 'test',
    sourceKey: 'test-card',
    setCode: 'base1',
    language: 'en',
    number: '4',
    name: 'Charizard',
    nameLocalized: null,
    typeRaw: 'Fire',
    subtypeRaw: 'Pokemon',
    hp: 120,
    illustrator: 'Mitsuhiro Arita',
    flavorText: null,
    attacks: null,
    weakness: null,
    resistance: null,
    retreatCost: 3,
    rarityRaw: 'Rare Holo',
    ...over,
  };
}

function printing(over: Partial<RawPrinting> = {}): RawPrinting {
  return {
    source: 'test',
    sourceKey: 'test-printing',
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
    ...over,
  };
}

describe('classifyVariant — decision-tree precedence', () => {
  it('Step 1: number > printed_total → SECRET_RARE', () => {
    const result = classifyVariant(
      printing({ isHolo: true }),
      card({ number: '210' }),
      set({ printedTotal: 207, total: 230 }),
    );
    expect(result.variant_class).toBe('SECRET_RARE');
    expect(result.variant_code).toBe('secret');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Step 2: explicit GOLD signal beats holo', () => {
    const result = classifyVariant(
      printing({ isHolo: true, isGoldRare: true }),
      card({ number: '120' }),
      set(),
    );
    expect(result.variant_class).toBe('GOLD');
    expect(result.variant_code).toBe('gold');
  });

  it('Step 2: explicit RAINBOW signal', () => {
    const result = classifyVariant(printing({ isRainbowRare: true }), card(), set());
    expect(result.variant_class).toBe('RAINBOW');
    expect(result.variant_code).toBe('rainbow');
  });

  it('Step 2: explicit ALT_ART beats FULL_ART', () => {
    const result = classifyVariant(printing({ isAltArt: true, isFullArt: true }), card(), set());
    expect(result.variant_class).toBe('ALT_ART');
    expect(result.variant_code).toBe('altart');
  });

  it('Step 2: TRAINER_GALLERY wins via explicit flag', () => {
    const result = classifyVariant(
      printing({ isTrainerGallery: true, isHolo: true }),
      card({ number: 'TG01' }),
      set({ code: 'swsh9' }),
    );
    expect(result.variant_class).toBe('TRAINER_GALLERY');
    expect(result.variant_code).toBe('tg');
  });

  it('Step 2: TRAINER_GALLERY inferred from TG prefix on number', () => {
    const result = classifyVariant(printing(), card({ number: 'TG01' }), set({ code: 'swsh9' }));
    expect(result.variant_class).toBe('TRAINER_GALLERY');
  });

  it('Step 2: Galarian Gallery (GG) prefix maps to TRAINER_GALLERY class', () => {
    const result = classifyVariant(
      printing(),
      card({ number: 'GG12' }),
      set({ code: 'swsh12pt5' }),
    );
    expect(result.variant_class).toBe('TRAINER_GALLERY');
  });

  it('Step 2: TEXTURED class when source flags texture and no other special class', () => {
    const result = classifyVariant(printing({ isTextured: true }), card(), set());
    expect(result.variant_class).toBe('TEXTURED');
    expect(result.variant_code).toBe('textured');
  });

  it('Step 2: PROMO class when source emits isPromo', () => {
    const result = classifyVariant(
      printing({ isPromo: true }),
      card({ number: 'SWSH284' }),
      set({ code: 'swshp', name: 'SWSH Black Star Promos' }),
    );
    expect(result.variant_class).toBe('PROMO');
  });

  it('Step 3: REVERSE_HOLO when isReverseHolo is set and no special class', () => {
    const result = classifyVariant(printing({ isReverseHolo: true }), card(), set());
    expect(result.variant_class).toBe('REVERSE_HOLO');
    expect(result.variant_code).toBe('revholo');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Step 4: HOLO when only isHolo', () => {
    const result = classifyVariant(printing({ isHolo: true }), card(), set());
    expect(result.variant_class).toBe('HOLO');
    expect(result.variant_code).toBe('holo');
  });

  it('Step 5: NON_HOLO fallback', () => {
    const result = classifyVariant(printing(), card(), set());
    expect(result.variant_class).toBe('NON_HOLO');
    expect(result.variant_code).toBe('nonholo');
  });
});

describe('classifyVariant — § 3 edge cases', () => {
  it('Base Set Charizard 1st Edition Shadowless Holo → holo-fe-sl', () => {
    const result = classifyVariant(
      printing({ isHolo: true, isFirstEdition: true, isShadowless: true }),
      card({ number: '4' }),
      set({ code: 'base1', printedTotal: 102 }),
    );
    expect(result.variant_class).toBe('HOLO');
    expect(result.variant_flags.sort()).toEqual(['FIRST_EDITION', 'SHADOWLESS']);
    expect(result.variant_code).toBe('holo-fe-sl');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Base Set Charizard Shadowless (non-1st-edition) Holo → holo-sl', () => {
    const result = classifyVariant(
      printing({ isHolo: true, isShadowless: true }),
      card({ number: '4' }),
      set({ code: 'base1', printedTotal: 102 }),
    );
    expect(result.variant_class).toBe('HOLO');
    expect(result.variant_flags).toEqual(['SHADOWLESS']);
    expect(result.variant_code).toBe('holo-sl');
  });

  it('Base Set Charizard Unlimited Holo (no 1st edition, no shadowless) → holo', () => {
    const result = classifyVariant(
      printing({ isHolo: true }),
      card({ number: '4' }),
      set({ code: 'base1', printedTotal: 102 }),
    );
    expect(result.variant_class).toBe('HOLO');
    expect(result.variant_flags).toEqual([]);
    expect(result.variant_code).toBe('holo');
  });

  it('Brilliant Stars Charizard VSTAR Rainbow Rare → rainbow', () => {
    const result = classifyVariant(
      printing({ isRainbowRare: true }),
      card({ number: '174', name: 'Charizard VSTAR' }),
      set({ code: 'swsh9', printedTotal: 172, total: 186 }),
    );
    expect(result.variant_class).toBe('RAINBOW');
    expect(result.variant_code).toBe('rainbow');
  });

  it('SWSH Promo SWSH284 Pikachu V Master Ball Pattern → nonholo-mb', () => {
    const result = classifyVariant(
      printing({ pattern: 'MASTER_BALL' }),
      card({ number: 'SWSH284', name: 'Pikachu V' }),
      set({ code: 'swshp' }),
    );
    expect(result.variant_class).toBe('NON_HOLO');
    expect(result.variant_flags).toEqual(['MASTER_BALL_PATTERN']);
    expect(result.variant_code).toBe('nonholo-mb');
  });

  it('Hidden Fates Shiny Charizard GX Secret Rare → secret', () => {
    const result = classifyVariant(
      printing({ isHolo: true }),
      card({ number: '69', name: 'Shiny Charizard GX' }),
      set({ code: 'sm115', printedTotal: 68, total: 69 }),
    );
    expect(result.variant_class).toBe('SECRET_RARE');
    expect(result.variant_code).toBe('secret');
  });

  it('Pokémon Center stamped reprints (STAFF stamp default-excluded from master)', () => {
    const result = classifyVariant(
      printing({ isHolo: true, stamp: 'STAFF' }),
      card({ number: '004' }),
      set(),
    );
    expect(result.variant_class).toBe('HOLO');
    expect(result.variant_flags).toEqual(['STAMPED_STAFF']);
    expect(result.variant_code).toBe('holo-staff');
    expect(result.include_in_master_set_default).toBe(false);
  });

  it('Prerelease build-and-battle stamp → STAMPED_PRERELEASE flag, included by default', () => {
    const result = classifyVariant(
      printing({ isHolo: true, stamp: 'PRERELEASE' }),
      card({ number: '004' }),
      set(),
    );
    expect(result.variant_flags).toEqual(['STAMPED_PRERELEASE']);
    expect(result.variant_code).toBe('holo-pre');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Trainer Gallery (TG01) included in parent set master by default', () => {
    const result = classifyVariant(
      printing({ isTrainerGallery: true, isHolo: true }),
      card({ number: 'TG01' }),
      set({ code: 'swsh9', printedTotal: 172, total: 186 }),
    );
    expect(result.variant_class).toBe('TRAINER_GALLERY');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Galarian Gallery (GG12) treated as TRAINER_GALLERY class', () => {
    const result = classifyVariant(
      printing({ isHolo: true }),
      card({ number: 'GG12' }),
      set({ code: 'swsh12pt5' }),
    );
    expect(result.variant_class).toBe('TRAINER_GALLERY');
  });

  it('Errors / misprints (Base Set Pikachu Red Cheeks) → ERROR flag, excluded from master', () => {
    const result = classifyVariant(
      printing({ isHolo: false, isError: true }),
      card({ number: '058', name: 'Pikachu' }),
      set({ code: 'base1', printedTotal: 102 }),
    );
    expect(result.variant_flags).toEqual(['ERROR']);
    expect(result.include_in_master_set_default).toBe(false);
  });

  it('Promo set (Black Star) → PROMO class, included in promo master', () => {
    const result = classifyVariant(
      printing({ isPromo: true }),
      card({ number: 'SWSH001' }),
      set({ code: 'swshp', name: 'SWSH Black Star Promos' }),
    );
    expect(result.variant_class).toBe('PROMO');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Reverse holo with Poké Ball pattern → revholo-pb, master-included', () => {
    const result = classifyVariant(
      printing({ isReverseHolo: true, pattern: 'POKE_BALL' }),
      card({ number: '004' }),
      set(),
    );
    expect(result.variant_class).toBe('REVERSE_HOLO');
    expect(result.variant_flags).toEqual(['POKE_BALL_PATTERN']);
    expect(result.variant_code).toBe('revholo-pb');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Reverse holo with Cosmos pattern → revholo-cosmos', () => {
    const result = classifyVariant(
      printing({ isReverseHolo: true, pattern: 'COSMOS' }),
      card(),
      set(),
    );
    expect(result.variant_code).toBe('revholo-cosmos');
  });

  it('Reverse holo with Galaxy pattern → revholo-galaxy', () => {
    const result = classifyVariant(
      printing({ isReverseHolo: true, pattern: 'GALAXY' }),
      card(),
      set(),
    );
    expect(result.variant_code).toBe('revholo-galaxy');
  });

  it('Full art with prerelease stamp → fullart-pre', () => {
    const result = classifyVariant(
      printing({ isFullArt: true, stamp: 'PRERELEASE' }),
      card({ number: '120' }),
      set(),
    );
    expect(result.variant_class).toBe('FULL_ART');
    expect(result.variant_code).toBe('fullart-pre');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Alt art (Special Illustration Rare) → altart, master-included', () => {
    const result = classifyVariant(printing({ isAltArt: true }), card({ number: '186' }), set());
    expect(result.variant_class).toBe('ALT_ART');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Gold (hyper rare) above printed_total stays GOLD — explicit class beats secret-rare numbering', () => {
    const result = classifyVariant(
      printing({ isGoldRare: true }),
      card({ number: '230' }),
      set({ printedTotal: 207 }),
    );
    expect(result.variant_class).toBe('GOLD');
  });

  it('Gold below printed_total stays GOLD', () => {
    const result = classifyVariant(
      printing({ isGoldRare: true }),
      card({ number: '120' }),
      set({ printedTotal: 207 }),
    );
    expect(result.variant_class).toBe('GOLD');
  });

  it('Numbered above printed_total without a special class → SECRET_RARE', () => {
    const result = classifyVariant(
      printing({ isHolo: true }),
      card({ number: '210' }),
      set({ printedTotal: 207 }),
    );
    expect(result.variant_class).toBe('SECRET_RARE');
    expect(result.variant_code).toBe('secret');
    expect(result.include_in_master_set_default).toBe(true);
  });

  it('Textured rare (e.g. Crown Zenith) → textured class', () => {
    const result = classifyVariant(printing({ isTextured: true }), card({ number: '110' }), set());
    expect(result.variant_class).toBe('TEXTURED');
    expect(result.variant_code).toBe('textured');
  });

  it('Textured + alt-art together → ALT_ART class with TEXTURED flag', () => {
    const result = classifyVariant(printing({ isAltArt: true, isTextured: true }), card(), set());
    expect(result.variant_class).toBe('ALT_ART');
    expect(result.variant_flags).toContain('TEXTURED');
    expect(result.variant_code).toBe('altart-tex');
  });

  it('Championship-stamped HOLO → STAMPED_CHAMPIONSHIP flag', () => {
    const result = classifyVariant(
      printing({ isHolo: true, stamp: 'CHAMPIONSHIP' }),
      card(),
      set(),
    );
    expect(result.variant_flags).toEqual(['STAMPED_CHAMPIONSHIP']);
    expect(result.variant_code).toBe('holo-champ');
  });

  it('League-stamped HOLO → STAMPED_LEAGUE flag', () => {
    const result = classifyVariant(printing({ isHolo: true, stamp: 'LEAGUE' }), card(), set());
    expect(result.variant_flags).toEqual(['STAMPED_LEAGUE']);
    expect(result.variant_code).toBe('holo-league');
  });

  it('Build-and-battle stamped → STAMPED_BUILDBATTLE flag', () => {
    const result = classifyVariant(printing({ isHolo: true, stamp: 'BUILDBATTLE' }), card(), set());
    expect(result.variant_flags).toEqual(['STAMPED_BUILDBATTLE']);
    expect(result.variant_code).toBe('holo-bb');
  });

  it('Unlimited explicit (vintage non-1st-edition non-shadowless) → UNLIMITED flag', () => {
    const result = classifyVariant(
      printing({ isHolo: true, extra: { isUnlimited: true } }),
      card(),
      set(),
    );
    expect(result.variant_flags).toEqual(['UNLIMITED']);
    expect(result.variant_code).toBe('holo-unl');
  });

  it('Idempotent: same input → same code over many runs', () => {
    const args = [
      printing({ isHolo: true, isFirstEdition: true, isShadowless: true }),
      card({ number: '4' }),
      set({ code: 'base1', printedTotal: 102 }),
    ] as const;
    const a = classifyVariant(...args);
    const b = classifyVariant(...args);
    const c = classifyVariant(...args);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe('assembleVariantCode', () => {
  it('sorts flag short codes alphabetically', () => {
    // FIRST_EDITION → 'fe', SHADOWLESS → 'sl' → 'fe' before 'sl'
    expect(assembleVariantCode('HOLO', ['SHADOWLESS', 'FIRST_EDITION'])).toBe('holo-fe-sl');
  });

  it('returns just the class short when no flags', () => {
    expect(assembleVariantCode('RAINBOW', [])).toBe('rainbow');
    expect(assembleVariantCode('SECRET_RARE', [])).toBe('secret');
  });

  it('matches all four documented examples from § 1', () => {
    expect(assembleVariantCode('HOLO', ['FIRST_EDITION', 'SHADOWLESS'])).toBe('holo-fe-sl');
    expect(assembleVariantCode('RAINBOW', [])).toBe('rainbow');
    expect(assembleVariantCode('NON_HOLO', ['MASTER_BALL_PATTERN'])).toBe('nonholo-mb');
    expect(assembleVariantCode('SECRET_RARE', [])).toBe('secret');
  });
});
