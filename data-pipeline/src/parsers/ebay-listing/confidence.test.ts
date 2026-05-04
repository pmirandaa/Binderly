// Confidence-distribution calibration test.
//
// Asserts the corpus-level distribution promised in the elaborated
// task spec:
//
//   - ≥95% of slab corpus entries score ≥0.7
//   - ≥80% of raw single-card corpus entries score ≥0.6
//   - every lot entry has `isLot === true` regardless of score
//
// The thresholds are SAT-checks, not maxima — a future improvement
// to the parser may raise scores; tests should still pass.

import { describe, expect, it } from 'vitest';

import { CORPUS } from './corpus.js';
import { parseEbayListing } from './parse.js';

import type { CorpusCategory } from './corpus.js';

const SLAB_CATEGORIES: ReadonlySet<CorpusCategory> = new Set([
  'psa-slab',
  'bgs-slab',
  'cgc-slab',
  'other-slab',
]);

const RAW_SINGLE_CATEGORIES: ReadonlySet<CorpusCategory> = new Set(['raw-nm', 'raw-played']);

describe('confidence calibration', () => {
  it('≥95% of slab entries score ≥ 0.7', () => {
    const slabs = CORPUS.filter((e) => SLAB_CATEGORIES.has(e.category));
    expect(slabs.length).toBeGreaterThanOrEqual(20);
    const passing = slabs.filter((e) => parseEbayListing(e.title).confidenceScore >= 0.7);
    const ratio = passing.length / slabs.length;
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  });

  it('≥80% of raw single-card entries score ≥ 0.6', () => {
    const raws = CORPUS.filter((e) => RAW_SINGLE_CATEGORIES.has(e.category));
    expect(raws.length).toBeGreaterThanOrEqual(15);
    const passing = raws.filter((e) => parseEbayListing(e.title).confidenceScore >= 0.6);
    const ratio = passing.length / raws.length;
    expect(ratio).toBeGreaterThanOrEqual(0.8);
  });

  it('every lot entry has isLot=true (regardless of confidence)', () => {
    const lots = CORPUS.filter((e) => e.category === 'lot');
    expect(lots.length).toBeGreaterThanOrEqual(8);
    for (const e of lots) {
      const parsed = parseEbayListing(e.title);
      expect(parsed.isLot, `"${e.title}" must be flagged isLot=true`).toBe(true);
    }
  });

  it('zero false-positive lot detection on single-card slab entries', () => {
    const slabs = CORPUS.filter((e) => SLAB_CATEGORIES.has(e.category));
    for (const e of slabs) {
      const parsed = parseEbayListing(e.title);
      expect(parsed.isLot, `"${e.title}" must NOT be flagged isLot=true`).toBe(false);
    }
  });

  it('zero false-positive lot detection on raw single-card entries', () => {
    const raws = CORPUS.filter((e) => RAW_SINGLE_CATEGORIES.has(e.category));
    for (const e of raws) {
      const parsed = parseEbayListing(e.title);
      expect(parsed.isLot, `"${e.title}" must NOT be flagged isLot=true`).toBe(false);
    }
  });

  it('confidence stays within [0, 1] for the whole corpus', () => {
    for (const e of CORPUS) {
      const parsed = parseEbayListing(e.title);
      expect(parsed.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(parsed.confidenceScore).toBeLessThanOrEqual(1);
    }
  });

  it('corpus has ≥100 entries with the documented composition', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(100);
    const counts = new Map<CorpusCategory, number>();
    for (const e of CORPUS) {
      counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    }
    expect(counts.get('psa-slab') ?? 0).toBeGreaterThanOrEqual(15);
    expect(counts.get('bgs-slab') ?? 0).toBeGreaterThanOrEqual(8);
    expect(counts.get('cgc-slab') ?? 0).toBeGreaterThanOrEqual(6);
    expect(counts.get('raw-nm') ?? 0).toBeGreaterThanOrEqual(10);
    expect(counts.get('lot') ?? 0).toBeGreaterThanOrEqual(8);
    expect(counts.get('jp') ?? 0).toBeGreaterThanOrEqual(8);
    expect(counts.get('variant') ?? 0).toBeGreaterThanOrEqual(8);
  });
});
