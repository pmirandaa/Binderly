import { describe, expect, it } from 'vitest';

import {
  formatTrendPercent,
  hasRenderableTrend,
  trendArrow,
  trendDirectionLabel,
  type PriceTrendDirection,
} from './trend.js';

describe('trendArrow', () => {
  it('maps up/down/flat to the expected glyphs', () => {
    expect(trendArrow('up')).toBe('\u25B2');
    expect(trendArrow('down')).toBe('\u25BC');
    expect(trendArrow('flat')).toBe('\u2192');
  });

  it('returns an empty string for unknown', () => {
    expect(trendArrow('unknown')).toBe('');
  });
});

describe('trendDirectionLabel', () => {
  it('returns human labels for each direction', () => {
    expect(trendDirectionLabel('up')).toBe('Up');
    expect(trendDirectionLabel('down')).toBe('Down');
    expect(trendDirectionLabel('flat')).toBe('Flat');
    expect(trendDirectionLabel('unknown')).toBe('No trend');
  });
});

describe('hasRenderableTrend', () => {
  it('is true for up/down/flat', () => {
    expect(hasRenderableTrend('up')).toBe(true);
    expect(hasRenderableTrend('down')).toBe(true);
    expect(hasRenderableTrend('flat')).toBe(true);
  });

  it('is false for unknown / null / undefined', () => {
    expect(hasRenderableTrend('unknown')).toBe(false);
    expect(hasRenderableTrend(null)).toBe(false);
    expect(hasRenderableTrend(undefined)).toBe(false);
  });
});

describe('formatTrendPercent', () => {
  it('prepends a + sign for positive values', () => {
    expect(formatTrendPercent('8.4')).toBe('+8.40%');
    expect(formatTrendPercent(12.5)).toBe('+12.50%');
  });

  it('keeps the inherent - sign for negative values', () => {
    expect(formatTrendPercent('-4.2')).toBe('-4.20%');
    expect(formatTrendPercent(-0.5)).toBe('-0.50%');
  });

  it('renders exact zero without a sign', () => {
    expect(formatTrendPercent('0')).toBe('0.00%');
    expect(formatTrendPercent(0)).toBe('0.00%');
  });

  it('normalises to exactly two fraction digits', () => {
    expect(formatTrendPercent('120')).toBe('+120.00%');
    expect(formatTrendPercent('1.005')).toBe('+1.00%');
  });

  it('returns null for null / undefined', () => {
    expect(formatTrendPercent(null)).toBeNull();
    expect(formatTrendPercent(undefined)).toBeNull();
  });

  it('returns null for non-finite / malformed inputs', () => {
    expect(formatTrendPercent('not-a-number')).toBeNull();
    expect(formatTrendPercent(Number.NaN)).toBeNull();
    expect(formatTrendPercent(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('accepts the api-contracts direction union structurally', () => {
    const direction: PriceTrendDirection = 'up';
    expect(trendArrow(direction)).toBe('\u25B2');
  });
});
