// Barrel for the custom + smart collections data layer. Internal
// to mobile (only consumed by `src/screens/collections/` and its
// per-feature component bundle).

export {
  COLLECTIONS_QUERY_KEYS,
  isPaidTier,
  useAddPrintingToCustomCollectionMutation,
  useCreateCustomCollectionMutation,
  useCustomCollectionItemsQuery,
  useCustomCollectionQuery,
  useCustomCollectionsQuery,
  useDeleteCustomCollectionMutation,
  useRemovePrintingFromCustomCollectionMutation,
  useSmartCollectionRuleQuery,
  useSubscriptionQuery,
  useUpdateCustomCollectionMutation,
} from './hooks.js';
export type {
  AddPrintingInput,
  UpdateCustomCollectionInput,
  UseCustomCollectionItemsQueryResult,
  UseCustomCollectionQueryResult,
  UseCustomCollectionsOptions,
  UseCustomCollectionsQueryResult,
  UseCustomCollectionOptions,
  UseSmartCollectionRuleQueryResult,
  UseSubscriptionQueryResult,
} from './hooks.js';

export {
  evaluateAgainstCatalog,
  parseDslText,
} from './dsl.js';
export type {
  CatalogPrintingRow,
  EvaluateMatch,
  ParseDslResult,
} from './dsl.js';

export {
  FREE_TIER_CUSTOM_LIMIT,
  formatCustomUsage,
  formatDateLabel,
  slugify,
  truncate,
} from './format.js';
