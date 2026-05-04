import { describe, expect, it } from 'vitest';

import { normalizeLanguage } from './language.js';

describe('normalizeLanguage', () => {
  it('maps the two-letter codes', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('jp')).toBe('jp');
    expect(normalizeLanguage('ja')).toBe('jp');
  });

  it('maps full names', () => {
    expect(normalizeLanguage('English')).toBe('en');
    expect(normalizeLanguage('Japanese')).toBe('jp');
  });

  it('strips region subtags', () => {
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('en-GB')).toBe('en');
    expect(normalizeLanguage('ja-JP')).toBe('jp');
  });

  it('is case-insensitive', () => {
    expect(normalizeLanguage('EN')).toBe('en');
    expect(normalizeLanguage('JP')).toBe('jp');
  });

  it('throws on unsupported languages', () => {
    expect(() => normalizeLanguage('de')).toThrow(/unsupported language/);
    expect(() => normalizeLanguage('fr-FR')).toThrow(/unsupported language/);
  });

  it('throws on empty input', () => {
    expect(() => normalizeLanguage('')).toThrow();
  });
});
