// Canonical-key generation tests. Every example from
// `context/tcg-domain.md` § 5 is covered, plus the "common pitfalls"
// from `rules/01-data-layer.md` (number padding, lettered numbers,
// idempotency).

import { describe, expect, it } from 'vitest';

import {
  canonicalCardKey,
  canonicalSetKey,
  normalizeCardNumberForKey,
  normalizeSetCodeForKey,
  printingVariantKey,
} from './canonical-keys.js';

describe('canonicalSetKey', () => {
  it('joins language and code as `{language}-{code}`', () => {
    expect(canonicalSetKey({ language: 'en', code: 'swsh9' })).toBe('en-swsh9');
    expect(canonicalSetKey({ language: 'en', code: 'base1' })).toBe('en-base1');
    expect(canonicalSetKey({ language: 'en', code: 'sv1' })).toBe('en-sv1');
  });

  it('lowercases set codes', () => {
    expect(canonicalSetKey({ language: 'en', code: 'SWSH9' })).toBe('en-swsh9');
    expect(canonicalSetKey({ language: 'en', code: 'Base1' })).toBe('en-base1');
  });

  it('strips spaces and slashes from set codes', () => {
    expect(canonicalSetKey({ language: 'en', code: 'sw sh9' })).toBe('en-swsh9');
    expect(canonicalSetKey({ language: 'en', code: 'sv/1' })).toBe('en-sv1');
  });

  it('supports the JP language', () => {
    expect(canonicalSetKey({ language: 'jp', code: 's9' })).toBe('jp-s9');
  });

  it('is idempotent (re-running produces the same string)', () => {
    const a = canonicalSetKey({ language: 'en', code: 'SWSH 9' });
    const b = canonicalSetKey({ language: 'en', code: a.slice(3) });
    expect(a).toBe(b);
  });

  it('throws on empty code', () => {
    expect(() => canonicalSetKey({ language: 'en', code: '   ' })).toThrow(
      /empty after normalization/,
    );
  });
});

describe('normalizeCardNumberForKey', () => {
  it('zero-pads pure-numeric numbers to 3 digits', () => {
    expect(normalizeCardNumberForKey('4')).toBe('004');
    expect(normalizeCardNumberForKey('18')).toBe('018');
    expect(normalizeCardNumberForKey('186')).toBe('186');
  });

  it('is idempotent on already-padded numbers', () => {
    expect(normalizeCardNumberForKey('004')).toBe('004');
    expect(normalizeCardNumberForKey('018')).toBe('018');
  });

  it('preserves Trainer Gallery / Galarian Gallery prefixes', () => {
    expect(normalizeCardNumberForKey('TG01')).toBe('TG01');
    expect(normalizeCardNumberForKey('GG12')).toBe('GG12');
  });

  it('preserves SWSH and other promo prefixes verbatim', () => {
    expect(normalizeCardNumberForKey('SWSH284')).toBe('SWSH284');
    expect(normalizeCardNumberForKey('H1')).toBe('H1');
  });

  it('preserves alpha suffixes (e.g. 4a)', () => {
    expect(normalizeCardNumberForKey('4a')).toBe('4a');
  });

  it('trims whitespace', () => {
    expect(normalizeCardNumberForKey('  04 ')).toBe('004');
    expect(normalizeCardNumberForKey('  TG01 ')).toBe('TG01');
  });

  it('throws on empty input', () => {
    expect(() => normalizeCardNumberForKey('')).toThrow(/empty/);
    expect(() => normalizeCardNumberForKey('   ')).toThrow(/empty/);
  });
});

describe('canonicalCardKey', () => {
  it('joins set canonical key with padded number', () => {
    expect(canonicalCardKey({ number: '4' }, { canonicalKey: 'en-base1' })).toBe('en-base1-004');
    expect(canonicalCardKey({ number: '18' }, { canonicalKey: 'en-swsh9' })).toBe('en-swsh9-018');
  });

  it('preserves lettered numbers (TG01, GG12)', () => {
    expect(canonicalCardKey({ number: 'TG01' }, { canonicalKey: 'en-swsh9' })).toBe(
      'en-swsh9-TG01',
    );
    expect(canonicalCardKey({ number: 'GG12' }, { canonicalKey: 'en-swsh12pt5' })).toBe(
      'en-swsh12pt5-GG12',
    );
  });

  it('accepts a raw set instead of a precomputed canonical key', () => {
    expect(canonicalCardKey({ number: '4' }, { language: 'en', code: 'base1' })).toBe(
      'en-base1-004',
    );
  });

  it('matches between precomputed and on-the-fly set forms', () => {
    const a = canonicalCardKey({ number: '186' }, { language: 'en', code: 'swsh9' });
    const b = canonicalCardKey({ number: '186' }, { canonicalKey: 'en-swsh9' });
    expect(a).toBe(b);
  });

  it('is idempotent across re-runs', () => {
    const a = canonicalCardKey({ number: '004' }, { canonicalKey: 'en-base1' });
    const b = canonicalCardKey({ number: '4' }, { canonicalKey: 'en-base1' });
    expect(a).toBe(b);
  });
});

describe('printingVariantKey', () => {
  it('joins card canonical key with variant code', () => {
    expect(
      printingVariantKey(
        { cardKey: 'en-base1-004', variantCode: 'holo-fe-sl' },
        { canonicalKey: 'en-base1-004' },
      ),
    ).toBe('en-base1-004-holo-fe-sl');
  });

  it('matches the documented example "Base Set Charizard 1st Edition Shadowless Holo"', () => {
    expect(
      printingVariantKey(
        { cardKey: 'en-base1-004', variantCode: 'holo-fe-sl' },
        { canonicalKey: 'en-base1-004' },
      ),
    ).toBe('en-base1-004-holo-fe-sl');
  });

  it('matches the documented example "Brilliant Stars Charizard VSTAR Rainbow Rare"', () => {
    expect(
      printingVariantKey(
        { cardKey: 'en-swsh9-174', variantCode: 'rainbow' },
        { canonicalKey: 'en-swsh9-174' },
      ),
    ).toBe('en-swsh9-174-rainbow');
  });

  it('matches the documented example "SWSH Promo SWSH284 Pikachu V Master Ball Pattern"', () => {
    expect(
      printingVariantKey(
        { cardKey: 'en-swshp-SWSH284', variantCode: 'nonholo-mb' },
        { canonicalKey: 'en-swshp-SWSH284' },
      ),
    ).toBe('en-swshp-SWSH284-nonholo-mb');
  });

  it('matches the documented example "Hidden Fates Shiny Charizard GX Secret Rare"', () => {
    expect(
      printingVariantKey(
        { cardKey: 'en-sm115-SV49', variantCode: 'secret' },
        { canonicalKey: 'en-sm115-SV49' },
      ),
    ).toBe('en-sm115-SV49-secret');
  });

  it('throws if variantCode is empty', () => {
    expect(() =>
      printingVariantKey(
        { cardKey: 'en-swsh9-018', variantCode: '' },
        { canonicalKey: 'en-swsh9-018' },
      ),
    ).toThrow(/variantCode is required/);
  });
});

describe('normalizeSetCodeForKey', () => {
  it('lowercases and strips whitespace + slashes', () => {
    expect(normalizeSetCodeForKey('SWSH9')).toBe('swsh9');
    expect(normalizeSetCodeForKey('  brilliant stars  ')).toBe('brilliantstars');
    expect(normalizeSetCodeForKey('sv/1')).toBe('sv1');
  });

  it('throws on empty after normalization', () => {
    expect(() => normalizeSetCodeForKey('   ')).toThrow();
  });
});
