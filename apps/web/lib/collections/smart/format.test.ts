import { describe, expect, it } from 'vitest';

import {
  formatSavedCount,
  formatTimestamp,
  prettyPrintJson,
  slugify,
  truncateExpression,
  variantClassLabel,
} from './format';

describe('slugify', () => {
  it('lower-cases and kebab-cases a freeform display name', () => {
    expect(slugify('All English Charizards')).toBe('all-english-charizards');
  });

  it('strips diacritics', () => {
    expect(slugify('Pokémon — Tcg')).toBe('pokemon-tcg');
  });

  it('returns an empty string when the name has no alphanumeric content', () => {
    expect(slugify('!!! ?? ...')).toBe('');
  });

  it('collapses multiple punctuation runs into a single dash', () => {
    expect(slugify('Foo  --  Bar !! Baz')).toBe('foo-bar-baz');
  });
});

describe('truncateExpression', () => {
  it('returns the JSON unchanged when shorter than max', () => {
    expect(truncateExpression({ a: 1 })).toBe('{"a":1}');
  });

  it('truncates with an ellipsis past the max length', () => {
    const long = { a: 'x'.repeat(200) };
    const out = truncateExpression(long, 30);
    expect(out.length).toBe(30);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles unserialisable values', () => {
    const a: { self?: unknown } = {};
    a.self = a;
    expect(truncateExpression(a)).toBe('<unserialisable expression>');
  });
});

describe('formatTimestamp', () => {
  it('renders Never for null', () => {
    expect(formatTimestamp(null)).toBe('Never');
  });

  it('formats a valid ISO timestamp', () => {
    const out = formatTimestamp('2026-05-15T20:00:00.000Z');
    expect(out).toMatch(/2026/);
  });

  it('returns the raw value when unparseable', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('formatSavedCount', () => {
  it('renders X / 0 for free tier', () => {
    expect(formatSavedCount({ count: 0, tier: 'free' })).toBe('Saved: 0 / 0');
  });

  it('renders X / ∞ for pro tier', () => {
    expect(formatSavedCount({ count: 7, tier: 'pro' })).toBe('Saved: 7 / ∞');
  });
});

describe('variantClassLabel', () => {
  it('lower-cases and replaces underscores with spaces', () => {
    expect(variantClassLabel('REVERSE_HOLO')).toBe('reverse holo');
    expect(variantClassLabel('ALT_ART')).toBe('alt art');
  });
});

describe('prettyPrintJson', () => {
  it('indents with two spaces', () => {
    expect(prettyPrintJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
