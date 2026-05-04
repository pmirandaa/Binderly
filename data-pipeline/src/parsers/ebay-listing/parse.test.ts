// Corpus-driven parser tests. Every entry in `corpus.ts` round-trips
// through `parseEbayListing()` and asserts:
//
//   1. The output validates against `parsedListingSchema` (zod).
//   2. The expected partial fields match.
//
// Per-pass tests live in `passes/*.test.ts`; this file is the
// integration / end-to-end surface.

import { describe, expect, it } from 'vitest';

import { CORPUS } from './corpus.js';
import { parseEbayListing } from './parse.js';
import { parsedListingSchema } from './types.js';

describe('parseEbayListing', () => {
  it('runs over the full corpus without throwing', () => {
    for (const entry of CORPUS) {
      expect(() => parseEbayListing(entry.title)).not.toThrow();
    }
  });

  it('output schema validates for every corpus entry', () => {
    for (const entry of CORPUS) {
      const parsed = parseEbayListing(entry.title);
      expect(() => parsedListingSchema.parse(parsed)).not.toThrow();
    }
  });

  describe.each(CORPUS)('$category | $title', (entry) => {
    it('matches expected partial', () => {
      const parsed = parseEbayListing(entry.title);
      const exp = entry.expected;

      if (exp.grading) {
        if (exp.grading.company !== undefined) {
          expect(parsed.grading.company).toBe(exp.grading.company);
        }
        if (exp.grading.grade !== undefined) {
          expect(parsed.grading.grade).toBe(exp.grading.grade);
        }
        if (exp.grading.isSlab !== undefined) {
          expect(parsed.grading.isSlab).toBe(exp.grading.isSlab);
        }
        if (exp.grading.gradeTier !== undefined) {
          expect(parsed.grading.gradeTier).toBe(exp.grading.gradeTier);
        }
      }
      if (exp.condition !== undefined) {
        expect(parsed.condition).toBe(exp.condition);
      }
      if (exp.language !== undefined) {
        expect(parsed.language).toBe(exp.language);
      }
      if (exp.setCode !== undefined) {
        expect(parsed.set.codeHint).toBe(exp.setCode);
      }
      if (exp.setName !== undefined) {
        expect(parsed.set.nameHint).toBe(exp.setName);
      }
      if (exp.cardNumber !== undefined) {
        expect(parsed.card.numberHint).toBe(exp.cardNumber);
      }
      if (exp.cardName !== undefined) {
        expect(parsed.card.nameHint).toBe(exp.cardName);
      }
      if (exp.variants) {
        for (const [key, expectedValue] of Object.entries(exp.variants)) {
          const actualValue = parsed.variantHints[key as keyof typeof parsed.variantHints];
          expect(actualValue, `variant ${key}`).toBe(expectedValue);
        }
      }
      if (exp.isLot !== undefined) {
        expect(parsed.isLot).toBe(exp.isLot);
      }
      if (exp.lotSize !== undefined) {
        expect(parsed.lotSize).toBe(exp.lotSize);
      }
      if (exp.minConfidence !== undefined) {
        expect(parsed.confidenceScore).toBeGreaterThanOrEqual(exp.minConfidence);
      }
    });
  });

  it('never throws on empty input', () => {
    expect(() => parseEbayListing('')).not.toThrow();
    const parsed = parseEbayListing('');
    expect(parsed.rawTitle).toBe('');
    expect(parsed.cleanedTitle).toBe('');
    expect(parsed.grading.isSlab).toBe(false);
    expect(parsed.isLot).toBe(false);
  });

  it('accepts non-string input safely (TS escape hatch)', () => {
    // The parser is exposed at runtime in environments where a
    // listing payload may have been mistyped; fail-closed instead
    // of throwing so a single bad row doesn't crash the ingest job.
    const parsed = parseEbayListing(undefined as unknown as string);
    expect(parsed.rawTitle).toBe('');
  });
});

describe('parser determinism', () => {
  it('produces identical output for identical input across calls', () => {
    const title = 'PSA 10 GEM MINT Charizard 4/102 Base Set 1999 Holo Rare';
    const a = parseEbayListing(title);
    const b = parseEbayListing(title);
    expect(b).toEqual(a);
  });
});

describe('catastrophic-backtracking guards', () => {
  it.each([
    'a'.repeat(2000),
    '1'.repeat(2000),
    '/'.repeat(500),
    ' '.repeat(2000),
    `${'psa '.repeat(500)}10`,
    `${'lot of '.repeat(200)}50`,
    `${'holo '.repeat(500)}charizard`,
  ])('completes within reasonable time on long pathological input', (input) => {
    const start = Date.now();
    expect(() => parseEbayListing(input)).not.toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
