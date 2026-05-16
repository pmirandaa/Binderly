import { describe, expect, it } from 'vitest';

import { formatReleaseDate, languageLabel, variantClassLabel } from './format';

describe('formatReleaseDate', () => {
  it('formats a valid ISO date in the en-US short format', () => {
    expect(formatReleaseDate('1999-01-09')).toBe('Jan 9, 1999');
  });

  it('returns the same string when the input fails to parse', () => {
    expect(formatReleaseDate('not-a-date')).toBe('not-a-date');
  });

  it('treats inputs as UTC so timezone does not shift the day', () => {
    expect(formatReleaseDate('2022-02-25')).toBe('Feb 25, 2022');
  });
});

describe('languageLabel', () => {
  it('renders en as EN', () => {
    expect(languageLabel('en')).toBe('EN');
  });
  it('renders jp as JP', () => {
    expect(languageLabel('jp')).toBe('JP');
  });
  it('uppercases unknown codes', () => {
    expect(languageLabel('fr')).toBe('FR');
  });
});

describe('variantClassLabel', () => {
  it('title-cases a single-word enum', () => {
    expect(variantClassLabel('HOLO')).toBe('Holo');
  });
  it('title-cases multi-word enums with underscores', () => {
    expect(variantClassLabel('REVERSE_HOLO')).toBe('Reverse Holo');
  });
  it('handles longer enums', () => {
    expect(variantClassLabel('STAMPED_PRERELEASE')).toBe('Stamped Prerelease');
  });
});
