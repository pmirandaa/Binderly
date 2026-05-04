// Public barrel for the pokemontcg.io (PTCGIO) adapter.
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`); internal
// modules can pull directly from this file.

export {
  PTCGIOAdapter,
  createPTCGIOAdapter,
  buildQueryUrl,
  PTCGIO_API_KEY_ENV,
  PTCGIO_BASE_PATH,
  PTCGIO_DEFAULT_BASE_URL,
  PTCGIO_DEFAULT_BURST,
  PTCGIO_DEFAULT_RPS,
  PTCGIO_HOST,
  PTCGIO_MAX_PAGE_SIZE,
  type PTCGIOAdapterConfig,
} from './adapter.js';
export {
  PTCGIO_SOURCE,
  isPtcgioPromoSet,
  normalizePtcgioDate,
  ptcgioCardToPrintings,
  ptcgioCardToRaw,
  ptcgioSetToRaw,
} from './transform.js';
export type {
  PTCGIOAbility,
  PTCGIOAncientTrait,
  PTCGIOAttack,
  PTCGIOCard,
  PTCGIOCardSetRef,
  PTCGIOEffectStat,
  PTCGIOEnvelope,
  PTCGIOImages,
  PTCGIOLegalities,
  PTCGIOListEnvelope,
  PTCGIOSet,
  PTCGIOSetImages,
  PTCGIOTcgPlayerBlock,
} from './api-types.js';
