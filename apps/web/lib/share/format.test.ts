import { describe, expect, it } from 'vitest';

import {
  formatCardTally,
  formatHeaderTally,
  formatLastUpdated,
  formatOwnedShort,
  formatPercent,
  publicShareUrl,
} from './format';

describe('formatPercent', () => {
  it('renders one decimal place with a trailing %', () => {
    expect(formatPercent(13.456)).toBe('13.5%');
  });

  it('clamps negative / NaN inputs to 0.0%', () => {
    expect(formatPercent(-1)).toBe('0.0%');
    expect(formatPercent(Number.NaN)).toBe('0.0%');
  });

  it('clamps overflow above 100% to 100.0%', () => {
    expect(formatPercent(140)).toBe('100.0%');
  });
});

describe('formatCardTally', () => {
  it('adds thousands separators on both sides', () => {
    expect(formatCardTally(1234, 4321)).toBe('1,234 / 4,321 cards');
  });
});

describe('formatOwnedShort', () => {
  it('pluralises correctly', () => {
    expect(formatOwnedShort(0)).toBe('0 cards owned');
    expect(formatOwnedShort(1)).toBe('1 card owned');
    expect(formatOwnedShort(7)).toBe('7 cards owned');
  });
});

describe('formatHeaderTally', () => {
  it('composes the tally + percent header line', () => {
    expect(formatHeaderTally(142, 1832, 7.751)).toBe(
      '142 / 1,832 cards · 7.8% complete',
    );
  });

  it('falls back to the short owned form when catalogTotal is 0', () => {
    expect(formatHeaderTally(5, 0, 0)).toBe('5 cards owned');
  });
});

describe('formatLastUpdated', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');

  it('renders "Just now" for recent timestamps', () => {
    expect(formatLastUpdated('2026-05-15T11:59:30.000Z', now)).toBe('Just now');
  });

  it('renders minutes', () => {
    expect(formatLastUpdated('2026-05-15T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(formatLastUpdated('2026-05-15T11:59:00.000Z', now)).toBe('1 minute ago');
  });

  it('renders hours', () => {
    expect(formatLastUpdated('2026-05-15T07:00:00.000Z', now)).toBe('5 hours ago');
  });

  it('renders days', () => {
    expect(formatLastUpdated('2026-05-13T12:00:00.000Z', now)).toBe('2 days ago');
  });

  it('falls back to an ISO date for old timestamps', () => {
    expect(formatLastUpdated('2026-01-01T00:00:00.000Z', now)).toBe('2026-01-01');
  });

  it('handles unparseable input', () => {
    expect(formatLastUpdated('not a date', now)).toBe('Recently updated');
  });
});

describe('publicShareUrl', () => {
  it('builds the canonical URL', () => {
    expect(publicShareUrl('pablo', 'my-binder')).toBe('/c/pablo/my-binder');
  });

  it('encodes path-unsafe characters', () => {
    expect(publicShareUrl('pablo', 'spaced slug')).toBe('/c/pablo/spaced%20slug');
  });
});
