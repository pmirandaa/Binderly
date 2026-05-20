// Pure verdict-classifier tests.

import { describe, expect, it } from 'vitest';

import { classifyConfidence } from '../confidence.js';
import { MATCH_DEFAULTS } from '../matcher.js';

import type { AnnSearchResult } from '@/scanner/ann';

function result(printingId: string, score: number): AnnSearchResult {
  return { printingId, score, distance: 1 - score };
}

describe('classifyConfidence', () => {
  it('returns "reject" + zero confidence for an empty candidate list', () => {
    const verdict = classifyConfidence([], MATCH_DEFAULTS);
    expect(verdict.disposition).toBe('reject');
    expect(verdict.confidence).toBe(0);
    expect(verdict.printingId).toBe('');
    expect(verdict.topGap).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns auto-add when top-1 is well above threshold and gap is wide', () => {
    const v = classifyConfidence(
      [result('A', 0.92), result('B', 0.4)],
      MATCH_DEFAULTS,
    );
    expect(v.disposition).toBe('auto-add');
    expect(v.confidence).toBeCloseTo(0.92);
    expect(v.printingId).toBe('A');
    expect(v.topGap).toBeCloseTo(0.52);
  });

  it('demotes auto-add → disambiguate when the top gap is too small', () => {
    const v = classifyConfidence(
      // Both above the auto-add threshold but only 0.01 apart —
      // ambiguous, route to the picker.
      [result('A', 0.85), result('B', 0.84)],
      MATCH_DEFAULTS,
    );
    expect(v.disposition).toBe('disambiguate');
    expect(v.confidence).toBeCloseTo(0.85);
    expect(v.printingId).toBe('A');
  });

  it('returns disambiguate when top-1 sits between the two thresholds', () => {
    const v = classifyConfidence(
      [result('A', 0.65), result('B', 0.55)],
      MATCH_DEFAULTS,
    );
    expect(v.disposition).toBe('disambiguate');
    expect(v.confidence).toBeCloseTo(0.65);
  });

  it('returns reject when top-1 is below the disambig floor', () => {
    const v = classifyConfidence(
      [result('A', 0.3), result('B', 0.2)],
      MATCH_DEFAULTS,
    );
    expect(v.disposition).toBe('reject');
    expect(v.confidence).toBeCloseTo(0.3);
  });

  it('treats a single-candidate list as +Infinity gap (auto-add when above threshold)', () => {
    const v = classifyConfidence([result('A', 0.9)], MATCH_DEFAULTS);
    expect(v.disposition).toBe('auto-add');
    expect(v.topGap).toBe(Number.POSITIVE_INFINITY);
  });

  it('honours overridden thresholds (config-driven)', () => {
    const v = classifyConfidence(
      [result('A', 0.7), result('B', 0.1)],
      { ...MATCH_DEFAULTS, autoAddScore: 0.6, disambigScore: 0.4, topGapMin: 0.05 },
    );
    expect(v.disposition).toBe('auto-add');
    expect(v.confidence).toBeCloseTo(0.7);
  });

  it('treats exact-threshold top-1 as the higher-tier outcome (≥, not strict)', () => {
    const v = classifyConfidence(
      [result('A', MATCH_DEFAULTS.autoAddScore), result('B', 0.1)],
      MATCH_DEFAULTS,
    );
    expect(v.disposition).toBe('auto-add');
  });
});
