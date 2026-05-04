import { describe, expect, it } from 'vitest';

import { detectVariants } from './variants.js';

describe('detectVariants — class flags', () => {
  it('matches "holo"', () => {
    const r = detectVariants('charizard holo');
    expect(r.hints.isHolo).toBe(true);
  });

  it('matches "reverse holo" before plain "holo"', () => {
    const r = detectVariants('charizard reverse holo 4/102');
    expect(r.hints.isReverseHolo).toBe(true);
    expect(r.hints.isHolo).toBeNull();
  });

  it('matches "1st edition"', () => {
    const r = detectVariants('1st edition charizard');
    expect(r.hints.isFirstEdition).toBe(true);
  });

  it('matches "first edition" spelled out', () => {
    expect(detectVariants('first edition charizard').hints.isFirstEdition).toBe(true);
  });

  it('matches "shadowless"', () => {
    expect(detectVariants('shadowless charizard').hints.isShadowless).toBe(true);
  });

  it('matches "full art"', () => {
    expect(detectVariants('full art charizard').hints.isFullArt).toBe(true);
  });

  it('matches "alt art" and "special illustration rare"', () => {
    expect(detectVariants('alt art charizard').hints.isAltArt).toBe(true);
    expect(detectVariants('special illustration rare charizard').hints.isAltArt).toBe(true);
    expect(detectVariants('charizard sir').hints.isAltArt).toBe(true);
  });

  it('matches "rainbow" and "rainbow rare"', () => {
    expect(detectVariants('rainbow rare charizard').hints.isRainbow).toBe(true);
    expect(detectVariants('rainbow charizard').hints.isRainbow).toBe(true);
  });

  it('matches "gold" but not "gold star"', () => {
    expect(detectVariants('gold rare charizard').hints.isGold).toBe(true);
    expect(detectVariants('charizard gold star').hints.isGold).toBeNull();
  });

  it('matches "secret rare"', () => {
    expect(detectVariants('charizard secret rare').hints.isSecretRare).toBe(true);
  });

  it('matches "promo" and "black star promo"', () => {
    expect(detectVariants('charizard promo').hints.isPromo).toBe(true);
    expect(detectVariants('charizard black star promo').hints.isPromo).toBe(true);
  });

  it('matches "staff" and "prerelease"', () => {
    expect(detectVariants('charizard staff stamped').hints.isStaff).toBe(true);
    expect(detectVariants('charizard prerelease').hints.isPrerelease).toBe(true);
    expect(detectVariants('charizard pre-release').hints.isPrerelease).toBe(true);
  });

  it('matches "master ball pattern" and "poke ball pattern"', () => {
    expect(detectVariants('charizard master ball pattern').hints.isMasterBallPattern).toBe(true);
    expect(detectVariants('charizard poke ball pattern').hints.isPokeBallPattern).toBe(true);
  });
});

describe('detectVariants — rarity hints', () => {
  it.each([
    ['charizard vmax', 'VMAX'],
    ['charizard vstar', 'VSTAR'],
    ['charizard v-star', 'VSTAR'],
    ['charizard tag team', 'TAG_TEAM'],
    ['charizard break', 'BREAK'],
    ['charizard mega', 'MEGA'],
    ['charizard ex', 'ex'],
    ['charizard gx', 'GX'],
    ['charizard v', 'V'],
  ])('extracts %s → %s', (input, expected) => {
    expect(detectVariants(input).hints.rarityHint).toBe(expected);
  });

  it('VMAX wins over V when both present', () => {
    expect(detectVariants('charizard vmax').hints.rarityHint).toBe('VMAX');
  });

  it('VSTAR wins over V when both present', () => {
    expect(detectVariants('charizard vstar').hints.rarityHint).toBe('VSTAR');
  });

  it('does not falsely match "v" inside a word', () => {
    const r = detectVariants('shovel charizard');
    expect(r.hints.rarityHint).toBeNull();
  });
});

describe('detectVariants — composition', () => {
  it('multiple flags can stack on the same input', () => {
    const r = detectVariants('1st edition shadowless holo charizard');
    expect(r.hints.isFirstEdition).toBe(true);
    expect(r.hints.isShadowless).toBe(true);
    expect(r.hints.isHolo).toBe(true);
  });

  it('returns all-null hints when nothing matches', () => {
    const r = detectVariants('charizard 4/102');
    expect(Object.values(r.hints).every((v) => v === null)).toBe(true);
  });
});

describe('detectVariants — pathological input', () => {
  it('long input completes quickly', () => {
    const start = Date.now();
    const big = 'a'.repeat(20_000) + ' holo';
    expect(detectVariants(big).hints.isHolo).toBe(true);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
