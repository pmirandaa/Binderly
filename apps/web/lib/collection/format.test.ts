import { describe, expect, it } from 'vitest';

import {
  conditionLabel,
  formatGlobalCount,
  formatOwnedCount,
  formatPercent,
  languageBadge,
  sortByCompletionThenRelease,
} from './format';

describe('formatPercent', () => {
  it('rounds to one decimal place with a trailing %', () => {
    expect(formatPercent(13.456)).toBe('13.5%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('clamps NaN / Infinity / negative values to 0.0%', () => {
    expect(formatPercent(Number.NaN)).toBe('0.0%');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('0.0%');
    expect(formatPercent(-12)).toBe('0.0%');
  });
});

describe('formatOwnedCount', () => {
  it('renders the brief copy literally', () => {
    expect(formatOwnedCount(12, 102)).toBe('12 / 102 owned');
  });

  it('handles a zero-numerator gracefully', () => {
    expect(formatOwnedCount(0, 50)).toBe('0 / 50 owned');
  });
});

describe('formatGlobalCount', () => {
  it('renders the global badge copy', () => {
    expect(formatGlobalCount(247, 1832)).toBe('247 / 1832');
  });
});

describe('conditionLabel', () => {
  it('maps every condition to a short badge string', () => {
    expect(conditionLabel('NEAR_MINT')).toBe('NM');
    expect(conditionLabel('LIGHTLY_PLAYED')).toBe('LP');
    expect(conditionLabel('MODERATELY_PLAYED')).toBe('MP');
    expect(conditionLabel('HEAVILY_PLAYED')).toBe('HP');
    expect(conditionLabel('DAMAGED')).toBe('DMG');
    expect(conditionLabel('UNKNOWN')).toBe('Raw');
  });
});

describe('languageBadge', () => {
  it('returns short two-letter codes', () => {
    expect(languageBadge('en')).toBe('EN');
    expect(languageBadge('jp')).toBe('JP');
  });
});

describe('sortByCompletionThenRelease', () => {
  it('sorts by completionPct desc, then releaseDate desc, then setId', () => {
    const rows = [
      { setId: 'a', completionPct: 50, releaseDate: '2020-01-01' },
      { setId: 'b', completionPct: 75, releaseDate: '2024-01-01' },
      { setId: 'c', completionPct: 50, releaseDate: '2024-01-01' },
      { setId: 'd', completionPct: 75, releaseDate: '2024-01-01' },
    ];
    const sorted = sortByCompletionThenRelease(rows).map((r) => r.setId);
    expect(sorted).toEqual(['b', 'd', 'c', 'a']);
  });
});
