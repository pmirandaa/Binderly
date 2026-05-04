import { describe, expect, it } from 'vitest';

import { preclean } from './preclean.js';

describe('preclean', () => {
  it('lowercases and trims', () => {
    expect(preclean('  HELLO  WORLD  ').cleaned).toBe('hello world');
  });

  it('collapses whitespace runs', () => {
    expect(preclean('a\t b\n\nc').cleaned).toBe('a b c');
  });

  it('replaces fancy quotes with ASCII', () => {
    expect(preclean('it\u2019s a "test"').cleaned).toBe(`it's a "test"`);
  });

  it('replaces em / en / figure dashes with ASCII -', () => {
    expect(preclean('a\u2013b\u2014c\u2010d').cleaned).toBe('a-b-c-d');
  });

  it('strips emoji and bullets', () => {
    const r = preclean('Charizard \u{1F525}\u{1F525}\u2022 4/102 \u2B50');
    expect(r.cleaned).toBe('charizard 4/102');
  });

  it('NFKC-normalises full-width digits', () => {
    expect(preclean('１９９９').cleaned).toBe('1999');
  });

  it('handles non-string input safely', () => {
    expect(preclean(undefined as unknown as string).cleaned).toBe('');
    expect(preclean(null as unknown as string).cleaned).toBe('');
    expect(preclean(42 as unknown as string).cleaned).toBe('');
  });

  it('emits a token array of non-empty tokens', () => {
    const r = preclean('PSA 10 GEM MINT Charizard 4/102');
    expect(r.tokens).toEqual(['psa', '10', 'gem', 'mint', 'charizard', '4/102']);
  });

  it('preserves slashes (set-number tokens)', () => {
    expect(preclean('Charizard 4/102').cleaned).toBe('charizard 4/102');
  });

  it('is idempotent on already-clean input', () => {
    const a = preclean('charizard 4/102');
    const b = preclean(a.cleaned);
    expect(b.cleaned).toBe(a.cleaned);
  });

  it('survives long pathological input without backtracking', () => {
    const start = Date.now();
    const big = 'a'.repeat(50_000) + ' charizard';
    const r = preclean(big);
    expect(r.cleaned.length).toBe(big.length);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
