// Public barrel for the TCGdex EN adapter.
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`); internal
// modules can pull directly from this file.

export {
  TCGdexEnAdapter,
  createTCGdexEnAdapter,
  TCGDEX_DEFAULT_BASE_URL,
  TCGDEX_DEFAULT_BURST,
  TCGDEX_DEFAULT_RPS,
  TCGDEX_EN_BASE_PATH,
  TCGDEX_HOST,
  type TCGdexEnAdapterConfig,
} from './adapter.js';
export {
  TCGDEX_EN_SOURCE,
  tcgdexCardToPrintings,
  tcgdexCardToRaw,
  tcgdexSetToRaw,
  isTcgdexPromoSet,
} from './transform.js';
export type {
  TCGdexCard,
  TCGdexCardBrief,
  TCGdexCardSetRef,
  TCGdexCardVariants,
  TCGdexSerieBrief,
  TCGdexSet,
  TCGdexSetBrief,
  TCGdexSetCardCount,
  TCGdexVariantDetailed,
} from './api-types.js';
