import { describe, expect, it } from 'vitest';

import { detectLot } from './lot.js';

describe('detectLot — true positives', () => {
  it('matches "lot of N"', () => {
    const r = detectLot('pokemon lot of 50 cards bulk');
    expect(r.isLot).toBe(true);
    expect(r.lotSize).toBe(50);
  });

  it('matches "Nx pokemon"', () => {
    const r = detectLot('100x pokemon cards');
    expect(r.isLot).toBe(true);
    expect(r.lotSize).toBe(100);
  });

  it('matches "N cards"', () => {
    const r = detectLot('charizard 200 cards lot');
    expect(r.isLot).toBe(true);
    expect(r.lotSize).toBe(200);
  });

  it('matches "card lot"', () => {
    const r = detectLot('pokemon card lot vintage');
    expect(r.isLot).toBe(true);
  });

  it('matches "complete set"', () => {
    const r = detectLot('pokemon complete set base');
    expect(r.isLot).toBe(true);
  });

  it('matches "complete master set"', () => {
    const r = detectLot('pokemon complete master set base');
    expect(r.isLot).toBe(true);
  });

  it('matches "binder lot"', () => {
    const r = detectLot('pokemon binder lot vintage');
    expect(r.isLot).toBe(true);
  });

  it('matches "booster pack/box/bundle"', () => {
    expect(detectLot('booster pack sealed').isLot).toBe(true);
    expect(detectLot('booster box sealed').isLot).toBe(true);
    expect(detectLot('booster bundle sealed').isLot).toBe(true);
  });

  it('matches "elite trainer box"', () => {
    expect(detectLot('crown zenith elite trainer box').isLot).toBe(true);
  });

  it('matches "factory sealed pack"', () => {
    expect(detectLot('factory sealed pack vintage').isLot).toBe(true);
  });

  it('matches "bulk lot"', () => {
    expect(detectLot('pokemon bulk lot wholesale').isLot).toBe(true);
  });
});

describe('detectLot — false-positive guards', () => {
  it('does NOT match a single-digit count word ("4 cards")', () => {
    const r = detectLot('charizard 4 of 102 base set');
    expect(r.isLot).toBe(false);
  });

  it('does NOT match year+singular ("1999 holo")', () => {
    const r = detectLot('charizard 4/102 base set 1999 holo');
    expect(r.isLot).toBe(false);
  });

  it('does NOT match "1999 card" (singular)', () => {
    const r = detectLot('charizard 1999 card');
    expect(r.isLot).toBe(false);
  });

  it('does NOT match isolated "lot" without context', () => {
    const r = detectLot('charizard a lot');
    expect(r.isLot).toBe(false);
  });

  it('does NOT match "4x102"-style numbering', () => {
    const r = detectLot('charizard 4x102');
    expect(r.isLot).toBe(false);
  });
});

describe('detectLot — redaction', () => {
  it('redacts the matched span', () => {
    const r = detectLot('pokemon lot of 50 cards charizard');
    expect(r.remaining).toContain('charizard');
    expect(r.remaining).not.toContain('lot of 50');
  });
});

describe('detectLot — survives pathological input', () => {
  it('long input completes quickly', () => {
    const start = Date.now();
    const big = 'a'.repeat(20_000) + ' lot of 50 cards';
    expect(detectLot(big).isLot).toBe(true);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
