import { describe, expect, it } from 'vitest';

import { detectSetNumber } from './set-number.js';

describe('detectSetNumber — slash patterns', () => {
  it('extracts "4/102" → "4"', () => {
    expect(detectSetNumber('charizard 4/102 base set').cardNumber).toBe('4');
  });

  it('preserves leading zeros: "091/069" → "091"', () => {
    expect(detectSetNumber('sylveon v 091/069 evolving skies').cardNumber).toBe('091');
  });

  it('extracts "TG10/TG30" with prefix preserved → "TG10"', () => {
    const r = detectSetNumber('charizard tg10/tg30 astral radiance');
    expect(r.cardNumber).toBe('TG10');
  });

  it('extracts "GG70/GG70" → "GG70"', () => {
    expect(detectSetNumber('giratina gg70/gg70 crown zenith').cardNumber).toBe('GG70');
  });
});

describe('detectSetNumber — prefix-only patterns', () => {
  it('extracts "SWSH050" → "SWSH050"', () => {
    expect(detectSetNumber('charizard swsh050 black star promo').cardNumber).toBe('SWSH050');
  });

  it('extracts "XY174"', () => {
    expect(detectSetNumber('pokemon center xy174 charizard').cardNumber).toBe('XY174');
  });
});

describe('detectSetNumber — long-form patterns', () => {
  it('extracts "4 of 102" → "4"', () => {
    expect(detectSetNumber('charizard 4 of 102 base set').cardNumber).toBe('4');
  });
});

describe('detectSetNumber — set name lookup', () => {
  it('matches "base set" → base1', () => {
    const r = detectSetNumber('charizard 4/102 base set');
    expect(r.setName).toBe('base set');
    expect(r.setCode).toBe('base1');
  });

  it('matches "evolving skies" → swsh7', () => {
    expect(detectSetNumber('sylveon v 091/069 evolving skies').setCode).toBe('swsh7');
  });

  it('matches "crown zenith" → swsh125', () => {
    expect(detectSetNumber('giratina gg70/gg70 crown zenith galarian gallery').setCode).toBe(
      'swsh125',
    );
  });

  it('matches "obsidian flames" → sv3', () => {
    expect(detectSetNumber('charizard ex 199/197 obsidian flames').setCode).toBe('sv3');
  });

  it('matches "paldean fates" → sv4pt5', () => {
    expect(detectSetNumber('greninja ex 106/091 paldean fates').setCode).toBe('sv4pt5');
  });

  it('longest set name wins', () => {
    const r = detectSetNumber('pokemon team rocket returns dark magneton');
    expect(r.setName).toBe('team rocket returns');
  });

  it('returns null setCode when set name unknown', () => {
    const r = detectSetNumber('charizard 4/102 unknown set');
    expect(r.setCode).toBeNull();
  });
});

describe('detectSetNumber — redaction', () => {
  it('redacts the matched span', () => {
    const r = detectSetNumber('charizard 4/102 base set holo');
    expect(r.remaining).not.toContain('4/102');
    expect(r.remaining).not.toContain('base set');
    expect(r.remaining).toContain('charizard');
    expect(r.remaining).toContain('holo');
  });
});

describe('detectSetNumber — pathological input', () => {
  it('long input completes quickly', () => {
    const start = Date.now();
    const big = '/'.repeat(5000) + ' charizard 4/102 base set';
    expect(detectSetNumber(big).cardNumber).toBe('4');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
