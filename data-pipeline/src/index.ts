// Public barrel for `@binderly/data-pipeline`.
//
// Downstream consumers (the seed-ingest task, future adapter packages,
// the master-set rules engine) import only from this file. Internal
// modules can cross-import freely.

export * from './types.js';
export * from './interfaces/adapter.js';
export * from './canonical-keys.js';
export * from './variant-classify.js';
export * from './http/rate-limited-client.js';
export * from './resolver/resolver.js';

// Normalize helpers — re-export both as namespaces (so consumers can
// say `normalize.rarity('tcgdex-en', 'Rare Holo V')`) and as direct
// names for ergonomic single-imports.
export {
  normalizeRarity,
  normalizeRarityWithTable,
  registerRarityMapping,
} from './normalize/rarity.js';
export type { SourceName as RaritySourceName, RarityMappingTable } from './normalize/rarity.js';
export { normalizeCardSubtype, normalizePokemonType } from './normalize/type.js';
export { normalizeLanguage } from './normalize/language.js';
export {
  normalizeSetCode,
  registerSetCodeAlias,
  lookupCanonicalSetCode,
} from './normalize/set-code.js';
