import { describe, expect, it } from 'vitest';

import {
  FREE_TIER_CUSTOM_LIMIT,
  formatCustomUsage,
  formatDateLabel,
  slugify,
  truncate,
} from './format';

describe('FREE_TIER_CUSTOM_LIMIT', () => {
  it('matches PROJECT.md § 16 (free tier 3 manual collections)', () => {
    expect(FREE_TIER_CUSTOM_LIMIT).toBe(3);
  });
});

describe('formatCustomUsage', () => {
  it('renders a count under the cap', () => {
    expect(formatCustomUsage(0)).toBe('0 / 3 used');
    expect(formatCustomUsage(2)).toBe('2 / 3 used');
  });

  it('renders the at-cap state', () => {
    expect(formatCustomUsage(3)).toBe('3 / 3 used');
  });
});

describe('truncate', () => {
  it('returns the original when within the cap', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('appends an ellipsis when too long', () => {
    expect(truncate('a'.repeat(20), 5)).toBe('aaaa…');
  });
});

describe('formatDateLabel', () => {
  it('renders an ISO timestamp without the year when same year', () => {
    const now = new Date();
    const iso = `${now.getUTCFullYear()}-03-14T00:00:00Z`;
    expect(formatDateLabel(iso)).toBe('Mar 14');
  });

  it('renders with the year when different year', () => {
    expect(formatDateLabel('2020-07-04T00:00:00Z')).toBe('Jul 4, 2020');
  });

  it('returns a dash for null', () => {
    expect(formatDateLabel(null)).toBe('—');
  });

  it('returns a dash for unparseable input', () => {
    expect(formatDateLabel('not a date')).toBe('—');
  });
});

describe('slugify', () => {
  it('lowercases + dasherises', () => {
    expect(slugify('My Charizards')).toBe('my-charizards');
  });

  it('strips diacritics', () => {
    expect(slugify('Pokémon Café')).toBe('pokemon-cafe');
  });

  it('collapses whitespace and punctuation', () => {
    expect(slugify('Hello, world! Foo  bar?')).toBe('hello-world-foo-bar');
  });

  it('trims leading/trailing dashes', () => {
    expect(slugify('   --hello--   ')).toBe('hello');
  });

  it('caps to 64 characters', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long).length).toBe(64);
  });
});
