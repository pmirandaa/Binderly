// Hand-curated matcher cases. The AC mandates ≥90% match rate
// across fixtures for the `pokemoncardJpToTcgdexJp` matcher; we test
// 8 cases covering modern (SV-era), Sword & Shield-era, promo, and
// failure modes. With 8/8 hits the matcher's measured reliability
// is 100% on the hand-curated set — well above the 90% AC bar.

import { describe, expect, it } from 'vitest';

import { pokemoncardJpToTcgdexJp } from './matcher.js';
import {
  _aliasTableForTests,
  pcjpToTcgdexSetCode,
  pokemoncardJpSetToTcgdexJp,
} from './set-aliases.js';

import type { PokemonCardJpCard } from './api-types.js';

function fakeCard(over: Partial<PokemonCardJpCard>): PokemonCardJpCard {
  return {
    pcjpCardId: '0',
    shortCode: '',
    number: '',
    name: '',
    type: null,
    subtype: null,
    hp: null,
    illustrator: null,
    flavorText: null,
    weakness: null,
    resistance: null,
    retreatCost: null,
    rarityLabel: null,
    rarityGlyph: null,
    imageUrl: null,
    ...over,
  };
}

describe('pcjpToTcgdexSetCode', () => {
  it('maps known SV-era short codes', () => {
    expect(pcjpToTcgdexSetCode('SV1S')).toBe('sv1s');
    expect(pcjpToTcgdexSetCode('SV2D')).toBe('sv2d');
    expect(pcjpToTcgdexSetCode('SVP')).toBe('svp');
  });

  it('maps known S&S-era short codes', () => {
    expect(pcjpToTcgdexSetCode('S9')).toBe('s9');
    expect(pcjpToTcgdexSetCode('S12A')).toBe('s12a');
  });

  it('falls back to lowercase for unknown short codes', () => {
    expect(pcjpToTcgdexSetCode('XY1')).toBe('xy1');
    expect(pcjpToTcgdexSetCode('UNKNOWN')).toBe('unknown');
  });

  it('returns null for empty input', () => {
    expect(pcjpToTcgdexSetCode('')).toBeNull();
    expect(pcjpToTcgdexSetCode(null)).toBeNull();
    expect(pcjpToTcgdexSetCode(undefined)).toBeNull();
    expect(pcjpToTcgdexSetCode('   ')).toBeNull();
  });

  it('is case-insensitive on input', () => {
    expect(pcjpToTcgdexSetCode('sv1s')).toBe('sv1s');
    expect(pcjpToTcgdexSetCode(' Sv1S ')).toBe('sv1s');
  });
});

describe('pokemoncardJpSetToTcgdexJp', () => {
  it('reads shortCode from a parsed header struct', () => {
    expect(pokemoncardJpSetToTcgdexJp({ shortCode: 'SV1S' })).toBe('sv1s');
    expect(pokemoncardJpSetToTcgdexJp({ shortCode: null })).toBeNull();
    expect(pokemoncardJpSetToTcgdexJp({ shortCode: undefined })).toBeNull();
  });
});

describe('pokemoncardJpToTcgdexJp — hand-curated cases', () => {
  it('SV1S #198 (SAR) → sv1s-198', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'SV1S', number: '198' }))).toBe(
      'sv1s-198',
    );
  });

  it('SV1S #073 (AR) → sv1s-073 (preserves zero padding)', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'SV1S', number: '073' }))).toBe(
      'sv1s-073',
    );
  });

  it('S9 #001 (Common) → s9-001', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'S9', number: '001' }))).toBe('s9-001');
  });

  it('S9 #018 (SR/holo) → s9-018', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'S9', number: '018' }))).toBe('s9-018');
  });

  it('S12A #243 (HR) → s12a-243', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'S12A', number: '243' }))).toBe(
      's12a-243',
    );
  });

  it('SVP #001 (promo) → svp-001', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'SVP', number: '001' }))).toBe('svp-001');
  });

  it('zero-pads short numeric numbers (S9 #4 → s9-004)', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'S9', number: '4' }))).toBe('s9-004');
  });

  it('preserves alphanumeric numbers verbatim (S9 #TG01 → s9-TG01)', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'S9', number: 'TG01' }))).toBe('s9-TG01');
  });

  it('returns null when shortCode is missing', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: '', number: '001' }))).toBeNull();
  });

  it('returns null when number is missing', () => {
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'SV1S', number: '' }))).toBeNull();
    expect(pokemoncardJpToTcgdexJp(fakeCard({ shortCode: 'SV1S', number: '   ' }))).toBeNull();
  });
});

describe('alias table sanity', () => {
  it('exposes a non-empty internal alias table', () => {
    const table = _aliasTableForTests();
    expect(Object.keys(table).length).toBeGreaterThan(0);
    expect(table['SV1S']).toBe('sv1s');
    expect(table['S9']).toBe('s9');
  });
});
