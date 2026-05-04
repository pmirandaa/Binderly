import { describe, expect, it } from 'vitest';

import { detectName } from './name.js';

describe('detectName — dictionary matches', () => {
  it('matches a Pokemon species name', () => {
    const r = detectName('charizard 4/102 base set');
    expect(r.cardName).toBe('charizard');
    expect(r.fromDictionary).toBe(true);
  });

  it('matches multi-word species ("ho-oh", "tapu koko", "mr. mime")', () => {
    expect(detectName('ho-oh holo rare').cardName).toBe('ho-oh');
    expect(detectName('tapu koko gx').cardName).toBe('tapu koko');
    expect(detectName('mr. mime mp').cardName).toBe('mr. mime');
  });

  it('longest match wins ("eevee" vs "sylveon")', () => {
    const r = detectName('eevee evolving into sylveon');
    expect(r.cardName).toBe('sylveon');
  });

  it('matches modern SV-era featured species', () => {
    expect(detectName('iono sir').cardName).toBe('iono');
    expect(detectName('koraidon ex').cardName).toBe('koraidon');
    expect(detectName('miraidon ex').cardName).toBe('miraidon');
    expect(detectName('iron crown').cardName).toBe('iron crown');
  });
});

describe('detectName — fallback', () => {
  it('falls back to longest letter-only token run', () => {
    const r = detectName('professor research trainer');
    expect(r.cardName).not.toBeNull();
    expect(r.fromDictionary).toBe(false);
  });

  it('drops stop words and year tokens', () => {
    const r = detectName('pokemon card holo nm 1999');
    expect(r.cardName).toBeNull();
  });

  it('does not return single-token noise (length ≥ 4)', () => {
    expect(detectName('xy').cardName).toBeNull();
    expect(detectName('abc').cardName).toBeNull();
  });
});

describe('detectName — redaction', () => {
  it('removes the matched name span', () => {
    const r = detectName('charizard 4/102 base set');
    expect(r.remaining).not.toContain('charizard');
    expect(r.remaining).toContain('4/102');
  });
});
