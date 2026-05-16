import { describe, expect, it } from 'vitest';

import type { SetDto } from '@binderly/api-contracts';

import {
  collectSeriesChips,
  EMPTY_FILTERS,
  filterAndSortSets,
  sortByReleaseDateDesc,
  toggleSeries,
  UNKNOWN_SERIES,
  type SetFilters,
} from './filters';


function makeSet(partial: Partial<SetDto> & { id: string }): SetDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-${partial.id}`,
    code: partial.code ?? partial.id,
    language: partial.language ?? 'en',
    name: partial.name ?? `Set ${partial.id}`,
    series: partial.series ?? null,
    releaseDate: partial.releaseDate ?? '2024-01-01',
    printedTotal: partial.printedTotal ?? 100,
    total: partial.total ?? 110,
    logoUrl: partial.logoUrl ?? null,
    symbolUrl: partial.symbolUrl ?? null,
    masterSetRules: partial.masterSetRules ?? {},
    createdAt: partial.createdAt ?? '2024-01-01T00:00:00Z',
    updatedAt: partial.updatedAt ?? '2024-01-01T00:00:00Z',
  };
}

describe('sortByReleaseDateDesc', () => {
  it('orders sets newest first', () => {
    const sets = [
      makeSet({ id: 'a', releaseDate: '2020-01-01' }),
      makeSet({ id: 'b', releaseDate: '2024-05-15' }),
      makeSet({ id: 'c', releaseDate: '2022-09-09' }),
    ];
    const sorted = sortByReleaseDateDesc(sets);
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties by name ascending', () => {
    const sets = [
      makeSet({ id: 'a', name: 'Zeta', releaseDate: '2024-01-01' }),
      makeSet({ id: 'b', name: 'Alpha', releaseDate: '2024-01-01' }),
    ];
    expect(sortByReleaseDateDesc(sets).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const sets = [
      makeSet({ id: 'a', releaseDate: '2020-01-01' }),
      makeSet({ id: 'b', releaseDate: '2024-01-01' }),
    ];
    const snapshot = sets.map((s) => s.id);
    void sortByReleaseDateDesc(sets);
    expect(sets.map((s) => s.id)).toEqual(snapshot);
  });
});

describe('filterAndSortSets', () => {
  const sets = [
    makeSet({
      id: 'a',
      name: 'Base Set',
      code: 'base1',
      language: 'en',
      series: 'Original',
      releaseDate: '1999-01-09',
    }),
    makeSet({
      id: 'b',
      name: 'Jungle',
      code: 'base2',
      language: 'en',
      series: 'Original',
      releaseDate: '1999-06-16',
    }),
    makeSet({
      id: 'c',
      name: 'Brilliant Stars',
      code: 'swsh9',
      language: 'en',
      series: 'Sword & Shield',
      releaseDate: '2022-02-25',
    }),
    makeSet({
      id: 'd',
      name: 'VSTAR Universe',
      code: 's12a',
      language: 'jp',
      series: 'Sword & Shield JP',
      releaseDate: '2022-12-02',
    }),
  ];

  it('returns every set ordered by release_date desc when no filter is applied', () => {
    const out = filterAndSortSets(sets, EMPTY_FILTERS);
    expect(out.map((s) => s.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('narrows by language when language is set to a specific value', () => {
    const filters: SetFilters = { ...EMPTY_FILTERS, language: 'jp' };
    expect(filterAndSortSets(sets, filters).map((s) => s.id)).toEqual(['d']);
  });

  it('narrows by series when at least one chip is selected', () => {
    const filters: SetFilters = { ...EMPTY_FILTERS, series: new Set(['Original']) };
    expect(filterAndSortSets(sets, filters).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('narrows by case-insensitive substring on name', () => {
    const filters: SetFilters = { ...EMPTY_FILTERS, search: 'brilliant' };
    expect(filterAndSortSets(sets, filters).map((s) => s.id)).toEqual(['c']);
  });

  it('narrows by substring on code as well as name', () => {
    const filters: SetFilters = { ...EMPTY_FILTERS, search: 'swsh' };
    expect(filterAndSortSets(sets, filters).map((s) => s.id)).toEqual(['c']);
  });

  it('returns an empty array when filters yield nothing', () => {
    const filters: SetFilters = { ...EMPTY_FILTERS, search: 'nonexistent' };
    expect(filterAndSortSets(sets, filters)).toEqual([]);
  });

  it('combines language + search filters', () => {
    const filters: SetFilters = { ...EMPTY_FILTERS, language: 'en', search: 'base' };
    expect(filterAndSortSets(sets, filters).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('buckets null-series rows under UNKNOWN_SERIES when that chip is selected', () => {
    const extra = makeSet({
      id: 'x',
      name: 'Mystery Promo',
      code: 'promo-x',
      language: 'en',
      series: null,
      releaseDate: '2023-08-10',
    });
    const filters: SetFilters = {
      ...EMPTY_FILTERS,
      series: new Set([UNKNOWN_SERIES]),
    };
    expect(filterAndSortSets([...sets, extra], filters).map((s) => s.id)).toEqual(['x']);
  });
});

describe('collectSeriesChips', () => {
  it('returns sorted unique series names', () => {
    const out = collectSeriesChips([
      makeSet({ id: 'a', series: 'Original' }),
      makeSet({ id: 'b', series: 'Sun & Moon' }),
      makeSet({ id: 'c', series: 'Original' }),
      makeSet({ id: 'd', series: 'Black & White' }),
    ]);
    expect(out).toEqual(['Black & White', 'Original', 'Sun & Moon']);
  });

  it('appends UNKNOWN_SERIES at the end iff any set has null series', () => {
    const out = collectSeriesChips([
      makeSet({ id: 'a', series: 'Original' }),
      makeSet({ id: 'b', series: null }),
    ]);
    expect(out).toEqual(['Original', UNKNOWN_SERIES]);
  });

  it('omits UNKNOWN_SERIES when every set has a real series name', () => {
    const out = collectSeriesChips([
      makeSet({ id: 'a', series: 'Original' }),
      makeSet({ id: 'b', series: 'Sword & Shield' }),
    ]);
    expect(out).toEqual(['Original', 'Sword & Shield']);
  });
});

describe('toggleSeries', () => {
  it('adds a token that is not present and returns a fresh set', () => {
    const start = new Set(['Original']);
    const next = toggleSeries(start, 'Sword & Shield');
    expect(next).not.toBe(start);
    expect([...next].sort()).toEqual(['Original', 'Sword & Shield']);
  });

  it('removes a token that is already present', () => {
    const start = new Set(['Original', 'Sword & Shield']);
    const next = toggleSeries(start, 'Original');
    expect([...next]).toEqual(['Sword & Shield']);
  });

  it('does not mutate the input set', () => {
    const start = new Set(['Original']);
    void toggleSeries(start, 'Sword & Shield');
    expect([...start]).toEqual(['Original']);
  });
});
