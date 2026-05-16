import { describe, expect, it } from 'vitest';

import { computeCapStatus, formatUpdatedAt, memberCountLabel, slugify } from './format';

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('My Charizards')).toBe('my-charizards');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('  Hello world!  ')).toBe('hello-world');
  });

  it('falls back to "collection" when input has no alphanumerics', () => {
    expect(slugify('  ---!!!')).toBe('collection');
  });

  it('drops accents so the slug stays in the contract regex', () => {
    expect(slugify('Pokémon Café')).toBe('pokemon-cafe');
  });

  it('clamps long slugs to 64 characters', () => {
    const long = 'a'.repeat(80);
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe('memberCountLabel', () => {
  it('uses the singular form for one card', () => {
    expect(memberCountLabel(1)).toBe('1 card');
  });

  it('uses the plural form for zero or many', () => {
    expect(memberCountLabel(0)).toBe('0 cards');
    expect(memberCountLabel(7)).toBe('7 cards');
  });
});

describe('formatUpdatedAt', () => {
  it('formats a real ISO timestamp', () => {
    const out = formatUpdatedAt('2024-04-15T12:00:00.000Z');
    expect(out).toMatch(/^Updated /);
    expect(out).toMatch(/2024/);
  });

  it('returns a sane fallback for garbage input', () => {
    expect(formatUpdatedAt('not-a-date')).toBe('Updated recently');
  });
});

describe('computeCapStatus', () => {
  it('reports under-cap when used < cap', () => {
    expect(computeCapStatus(1, 3)).toEqual({ used: 1, cap: 3, atCap: false });
  });

  it('reports at-cap when used === cap', () => {
    expect(computeCapStatus(3, 3)).toEqual({ used: 3, cap: 3, atCap: true });
  });

  it('reports at-cap when used > cap (defensive)', () => {
    expect(computeCapStatus(5, 3).atCap).toBe(true);
  });
});
