// Per-source rarity normalization tests. Covers the registered
// adapters (TCGdex EN/JP, ptcgio, Bulbapedia EN) and the failure modes
// (unknown source, unknown rarity).

import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetRarityRegistryForTests,
  normalizeRarity,
  normalizeRarityWithTable,
  registerRarityMapping,
} from './rarity.js';

afterEach(() => {
  _resetRarityRegistryForTests();
});

describe('normalizeRarity — TCGdex EN', () => {
  it('maps base rarities', () => {
    expect(normalizeRarity('tcgdex-en', 'Common')).toBe('COMMON');
    expect(normalizeRarity('tcgdex-en', 'Uncommon')).toBe('UNCOMMON');
    expect(normalizeRarity('tcgdex-en', 'Rare')).toBe('RARE');
    expect(normalizeRarity('tcgdex-en', 'Rare Holo')).toBe('HOLO_RARE');
  });

  it('maps modern ultra-rare flavors', () => {
    expect(normalizeRarity('tcgdex-en', 'Rare Holo V')).toBe('ULTRA_RARE');
    expect(normalizeRarity('tcgdex-en', 'Rare Holo VMAX')).toBe('ULTRA_RARE');
    expect(normalizeRarity('tcgdex-en', 'Rare Holo VSTAR')).toBe('ULTRA_RARE');
    expect(normalizeRarity('tcgdex-en', 'Rare Holo EX')).toBe('ULTRA_RARE');
    expect(normalizeRarity('tcgdex-en', 'Rare Holo GX')).toBe('ULTRA_RARE');
    expect(normalizeRarity('tcgdex-en', 'Rare Ultra')).toBe('ULTRA_RARE');
  });

  it('maps SV-era illustration tiers and Double Rare', () => {
    expect(normalizeRarity('tcgdex-en', 'Double Rare')).toBe('DOUBLE_RARE');
    expect(normalizeRarity('tcgdex-en', 'Illustration Rare')).toBe('ILLUSTRATION_RARE');
    expect(normalizeRarity('tcgdex-en', 'Special Illustration Rare')).toBe(
      'SPECIAL_ILLUSTRATION_RARE',
    );
  });

  it('maps secret / hyper / rainbow tiers', () => {
    expect(normalizeRarity('tcgdex-en', 'Rare Secret')).toBe('SECRET_RARE');
    expect(normalizeRarity('tcgdex-en', 'Hyper Rare')).toBe('HYPER_RARE');
    expect(normalizeRarity('tcgdex-en', 'Rainbow Rare')).toBe('RAINBOW_RARE');
  });

  it('maps amazing and radiant rares', () => {
    expect(normalizeRarity('tcgdex-en', 'Amazing Rare')).toBe('AMAZING_RARE');
    expect(normalizeRarity('tcgdex-en', 'Radiant Rare')).toBe('RADIANT_RARE');
  });

  it('maps promo tiers', () => {
    expect(normalizeRarity('tcgdex-en', 'Promo')).toBe('PROMO');
    expect(normalizeRarity('tcgdex-en', 'Rare Promo')).toBe('PROMO');
  });

  it('is case-insensitive on a fallback path', () => {
    expect(normalizeRarity('tcgdex-en', 'rare holo')).toBe('HOLO_RARE');
    expect(normalizeRarity('tcgdex-en', 'COMMON')).toBe('COMMON');
  });

  it('trims whitespace before lookup', () => {
    expect(normalizeRarity('tcgdex-en', '  Rare Holo V  ')).toBe('ULTRA_RARE');
  });
});

describe('normalizeRarity — pokemontcg.io', () => {
  it('maps the public dataset values', () => {
    expect(normalizeRarity('ptcgio', 'Common')).toBe('COMMON');
    expect(normalizeRarity('ptcgio', 'Rare Holo Star')).toBe('ULTRA_RARE');
    expect(normalizeRarity('ptcgio', 'Rare Prime')).toBe('ULTRA_RARE');
    expect(normalizeRarity('ptcgio', 'Rare BREAK')).toBe('ULTRA_RARE');
    expect(normalizeRarity('ptcgio', 'Rare Prism Star')).toBe('ULTRA_RARE');
    expect(normalizeRarity('ptcgio', 'Trainer Gallery Rare Holo')).toBe('HOLO_RARE');
  });
});

describe('normalizeRarity — Bulbapedia EN', () => {
  it('maps Bulbapedia rarity strings (cross-validation use only)', () => {
    expect(normalizeRarity('bulbapedia-en', 'Holo Rare')).toBe('HOLO_RARE');
    expect(normalizeRarity('bulbapedia-en', 'Ultra Rare')).toBe('ULTRA_RARE');
    expect(normalizeRarity('bulbapedia-en', 'Secret Rare')).toBe('SECRET_RARE');
  });
});

describe('normalizeRarity — TCGdex JP', () => {
  it('maps the JP-specific tiers', () => {
    expect(normalizeRarity('tcgdex-jp', 'Art Rare')).toBe('ILLUSTRATION_RARE');
    expect(normalizeRarity('tcgdex-jp', 'Special Art Rare')).toBe('SPECIAL_ILLUSTRATION_RARE');
    expect(normalizeRarity('tcgdex-jp', 'Character Rare')).toBe('ULTRA_RARE');
    expect(normalizeRarity('tcgdex-jp', 'Shiny Super Rare')).toBe('ULTRA_RARE');
  });
});

describe('normalizeRarity — failure modes', () => {
  it('throws on unknown source', () => {
    expect(() => normalizeRarity('not-a-source' as never, 'Common')).toThrow(/unknown source/);
  });

  it('throws on known source + unknown rarity', () => {
    expect(() => normalizeRarity('tcgdex-en', 'Mythical Rare')).toThrow(/no mapping for rarity/);
  });

  it('registerRarityMapping extends an existing source without replacing', () => {
    expect(() => normalizeRarity('test', 'Some Custom Tier')).toThrow();
    registerRarityMapping('test', { 'Some Custom Tier': 'ULTRA_RARE' });
    expect(normalizeRarity('test', 'Some Custom Tier')).toBe('ULTRA_RARE');
  });
});

describe('normalizeRarityWithTable', () => {
  it('uses the provided table', () => {
    expect(normalizeRarityWithTable({ Glittery: 'HOLO_RARE' }, 'Glittery')).toBe('HOLO_RARE');
  });

  it('throws on miss', () => {
    expect(() => normalizeRarityWithTable({}, 'Anything')).toThrow();
  });
});
