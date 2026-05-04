// Public barrel for the TCGdex JP adapter.
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`); internal
// modules can pull directly from this file.

// NOTE: `TCGDEX_HOST` / `TCGDEX_DEFAULT_BASE_URL` /
// `TCGDEX_DEFAULT_RPS` / `TCGDEX_DEFAULT_BURST` and `isTcgdexPromoSet`
// are intentionally NOT re-exported here because the EN sibling
// barrel already re-exports identical bindings of the same name from
// the same upstream constants. Re-exporting them from both barrels
// triggers an "ambiguous re-export" silent drop when the top-level
// `data-pipeline/src/adapters/index.ts` does `export * from
// './tcgdex-en/index.js'` and `export * from './tcgdex-jp/index.js'`.
// External consumers can import these via the EN barrel; internal
// modules can import directly from `./adapter.js` /
// `./transform.js` if needed.
export {
  TCGdexJpAdapter,
  createTCGdexJpAdapter,
  TCGDEX_JP_BASE_PATH,
  type TCGdexJpAdapterConfig,
} from './adapter.js';
export {
  TCGDEX_JP_SOURCE,
  tcgdexJpCardToPrintings,
  tcgdexJpCardToRaw,
  tcgdexJpSetToRaw,
} from './transform.js';
export type {
  TCGdexJpCard,
  TCGdexJpCardBrief,
  TCGdexJpCardSetRef,
  TCGdexJpCardVariants,
  TCGdexJpSerieBrief,
  TCGdexJpSet,
  TCGdexJpSetBrief,
  TCGdexJpSetCardCount,
  TCGdexJpVariantDetailed,
} from './api-types.js';
