// Pure helpers for the BrowseScreen's filter / sort surface.
//
// Kept side-effect free so the BrowseScreen tests can pin the
// filter logic without rendering the screen, and so the screen
// itself stays a thin presentational layer over a `useMemo`.
//
// The browse filter model is intentionally tiny — three knobs:
//
//   - Language: `'en' | 'jp' | 'ALL'`
//   - Series: a set of selected series names (multi-select chips).
//     The empty set means "no filter" (== all series). The `null`
//     series of a SetDto is bucketed under the synthetic
//     `UNKNOWN_SERIES` token so it remains chip-selectable.
//   - Search: case-insensitive substring match against
//     `set.name` and `set.code`.
//
// Sorting is always `release_date` descending — Pablo's #1
// complaint about Collectr (PROJECT.md § 10). Sets without a
// release date sort to the end deterministically by `name`.

import type { SetDto } from '@binderly/api-contracts';

/** Synthetic token used for sets with `series === null`. */
export const UNKNOWN_SERIES = '__unknown_series__';

export type LanguageFilter = 'en' | 'jp' | 'ALL';

export interface SetFilters {
  readonly language: LanguageFilter;
  /**
   * Selected series names (or {@link UNKNOWN_SERIES}). Empty set
   * means "no filter". A plain `ReadonlySet` keeps `.has()` O(1)
   * for chip rendering.
   */
  readonly series: ReadonlySet<string>;
  /** Raw search input; trimmed + lowercased inside the helper. */
  readonly search: string;
}

/** Sentinel "no filter" value — handy for hook defaults / resets. */
export const EMPTY_FILTERS: SetFilters = {
  language: 'ALL',
  series: new Set<string>(),
  search: '',
};

/**
 * Apply the three filter knobs to a `SetDto[]` and return a new
 * array (never mutates the input). Sorting is part of the
 * pipeline so callers get a single deterministic result.
 */
export function filterAndSortSets(sets: ReadonlyArray<SetDto>, filters: SetFilters): SetDto[] {
  const needle = filters.search.trim().toLowerCase();
  const filtered = sets.filter((set) => {
    if (filters.language !== 'ALL' && set.language !== filters.language) return false;
    if (filters.series.size > 0) {
      const token = set.series ?? UNKNOWN_SERIES;
      if (!filters.series.has(token)) return false;
    }
    if (needle.length > 0) {
      const haystack = `${set.name} ${set.code}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
  return sortByReleaseDateDesc(filtered);
}

/**
 * Sort a copy of the input array by `release_date` descending.
 * Stable tiebreak on `name` ascending so the order doesn't shift
 * between renders.
 */
export function sortByReleaseDateDesc(sets: ReadonlyArray<SetDto>): SetDto[] {
  return [...sets].sort((a, b) => {
    if (a.releaseDate !== b.releaseDate) {
      return a.releaseDate < b.releaseDate ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Collect the unique series chips to render across all sets. The
 * synthetic {@link UNKNOWN_SERIES} token is appended at the end
 * iff at least one set has a `null` series — keeps the chip row
 * tidy when the catalog is fully populated.
 */
export function collectSeriesChips(sets: ReadonlyArray<SetDto>): string[] {
  const seen = new Set<string>();
  let hasUnknown = false;
  for (const set of sets) {
    if (set.series === null) {
      hasUnknown = true;
    } else {
      seen.add(set.series);
    }
  }
  const ordered = Array.from(seen).sort((a, b) => a.localeCompare(b));
  if (hasUnknown) ordered.push(UNKNOWN_SERIES);
  return ordered;
}

/**
 * Toggle a single series token in/out of the current filter set.
 * Returns a new `Set` (never mutates) so React state updates stay
 * referential.
 */
export function toggleSeries(current: ReadonlySet<string>, token: string): Set<string> {
  const next = new Set(current);
  if (next.has(token)) {
    next.delete(token);
  } else {
    next.add(token);
  }
  return next;
}
