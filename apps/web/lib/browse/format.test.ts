import { describe, expect, it } from 'vitest';

import { makeSet } from './fixtures';
import {
  formatCurrentPriceComputedAt,
  formatLastSeenAt,
  formatReleaseDate,
  freshnessLabel,
  languageLabel,
  printingDisplayName,
  rarityLabel,
  sortSetsByReleaseDateDesc,
} from './format';

describe('formatReleaseDate', () => {
  it('renders an ISO date as a short locale-aware label', () => {
    expect(formatReleaseDate('2024-03-22', 'en-US')).toMatch(/Mar 22, 2024/);
  });

  it('returns the raw input when the date is unparseable', () => {
    expect(formatReleaseDate('not-a-date')).toBe('not-a-date');
  });
});

describe('languageLabel', () => {
  it('maps en → English and jp → Japanese', () => {
    expect(languageLabel('en')).toBe('English');
    expect(languageLabel('jp')).toBe('Japanese');
  });
});

describe('rarityLabel', () => {
  it('returns a friendly label for known rarities', () => {
    expect(rarityLabel('HOLO_RARE')).toBe('Holo Rare');
    expect(rarityLabel('SECRET_RARE')).toBe('Secret Rare');
  });

  it('returns "Unknown rarity" for null', () => {
    expect(rarityLabel(null)).toBe('Unknown rarity');
  });
});

describe('printingDisplayName', () => {
  it('formats card name + number + variant', () => {
    expect(
      printingDisplayName({ cardName: 'Charizard', cardNumber: '4', variantClass: 'HOLO' }),
    ).toBe('Charizard #4 (holo)');
  });

  it('replaces underscores in multi-word variants', () => {
    expect(
      printingDisplayName({
        cardName: 'Pikachu',
        cardNumber: '25',
        variantClass: 'REVERSE_HOLO',
      }),
    ).toBe('Pikachu #25 (reverse holo)');
  });
});

describe('sortSetsByReleaseDateDesc', () => {
  it('orders newest release first (the Pablo regression test)', () => {
    const sets = [
      makeSet({ id: 'a', name: 'Old', releaseDate: '1999-01-09' }),
      makeSet({ id: 'b', name: 'New', releaseDate: '2024-03-22' }),
      makeSet({ id: 'c', name: 'Mid', releaseDate: '2022-05-27' }),
    ];
    const sorted = sortSetsByReleaseDateDesc(sets);
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties on name ascending', () => {
    const sets = [
      makeSet({ id: 'a', name: 'Zeta', releaseDate: '2024-01-01' }),
      makeSet({ id: 'b', name: 'Alpha', releaseDate: '2024-01-01' }),
    ];
    const sorted = sortSetsByReleaseDateDesc(sets);
    expect(sorted.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const sets = [
      makeSet({ id: 'a', releaseDate: '1999-01-09' }),
      makeSet({ id: 'b', releaseDate: '2024-03-22' }),
    ];
    const ids = sets.map((s) => s.id);
    sortSetsByReleaseDateDesc(sets);
    expect(sets.map((s) => s.id)).toEqual(ids);
  });
});

describe('freshnessLabel', () => {
  it('maps each band to a UI-friendly word', () => {
    expect(freshnessLabel('fresh')).toBe('Fresh');
    expect(freshnessLabel('stale')).toBe('Stale');
    expect(freshnessLabel('stale_old')).toBe('Outdated');
  });
});

describe('formatCurrentPriceComputedAt', () => {
  it('renders an ISO timestamp as a short date', () => {
    expect(
      formatCurrentPriceComputedAt('2026-05-18T12:00:00.000Z', 'en-US'),
    ).toMatch(/May 18, 2026/);
  });

  it('returns the raw string when the input is unparseable', () => {
    expect(formatCurrentPriceComputedAt('not-a-date')).toBe('not-a-date');
  });
});

describe('formatLastSeenAt', () => {
  it('renders an ISO timestamp as a short date', () => {
    expect(formatLastSeenAt('2026-05-20T09:30:00.000Z', 'en-US')).toMatch(
      /May 20, 2026/,
    );
  });

  it('returns null for null / undefined input', () => {
    expect(formatLastSeenAt(null)).toBeNull();
    expect(formatLastSeenAt(undefined)).toBeNull();
  });

  it('returns null for an unparseable string', () => {
    expect(formatLastSeenAt('not-a-date')).toBeNull();
  });
});
