// Barrel for the browse-feature data layer. Internal-to-mobile
// (only consumed by `src/screens/browse/`, `src/screens/set/`,
// `src/screens/card/`).

export {
  collectSeriesChips,
  EMPTY_FILTERS,
  filterAndSortSets,
  sortByReleaseDateDesc,
  toggleSeries,
  UNKNOWN_SERIES,
} from './filters.js';
export type { LanguageFilter, SetFilters } from './filters.js';

export { formatReleaseDate, languageLabel, variantClassLabel } from './format.js';

export {
  BROWSE_QUERY_KEYS,
  useCardQuery,
  useCardsInSetQuery,
  useSetBySlugQuery,
  useSetsQuery,
} from './hooks.js';
export type {
  CardInSetDto,
  SetsQueryData,
  UseCardQueryResult,
  UseCardsInSetQueryResult,
  UseSetBySlugQueryResult,
  UseSetsQueryResult,
} from './hooks.js';
