// Barrel for the collection-feature data layer. Internal-to-mobile
// (only consumed by `src/screens/collection/` and the per-feature
// component bundle).

export {
  clampPercent,
  formatCount,
  formatPercent,
} from './format.js';

export {
  compareSummariesForHome,
  computeCompletionForSet,
  partitionPrintingsForDrillDown,
  summarizeCollection,
  summaryFromResult,
} from './completion.js';
export type {
  CollectionGlobalSummary,
  CollectionSetSummary,
  CollectionSummary,
  OwnedPrintingContext,
  PerSetCompletionInput,
  SetCompletionResult,
} from './completion.js';

export {
  COLLECTION_QUERY_KEYS,
  useCollectionItemsQuery,
  useOwnedPrintingsContextQuery,
  useSetDrillDownQuery,
} from './hooks.js';
export type {
  OwnedContextQueryState,
  SetDrillDownData,
  SetDrillDownQueryState,
  UseCollectionItemsOptions,
  UseCollectionItemsQueryResult,
} from './hooks.js';
