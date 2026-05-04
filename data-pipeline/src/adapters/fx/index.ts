// Public barrel for the Frankfurter FX adapter.
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`); internal
// modules — chiefly `data-pipeline/src/jobs/fx-rates.ts` — pull
// directly from this file.

export {
  FrankfurterClient,
  createFrankfurterClient,
  FRANKFURTER_BASE_PATH,
  FRANKFURTER_DEFAULT_BASE_URL,
  FRANKFURTER_DEFAULT_BURST,
  FRANKFURTER_DEFAULT_RPS,
  FRANKFURTER_DEFAULT_USER_AGENT,
  FRANKFURTER_HOST,
  FRANKFURTER_SOURCE,
  type FrankfurterClientConfig,
  type FrankfurterRequestOptions,
} from './frankfurter.js';
export {
  BINDERLY_FX_BASE_CURRENCY,
  BINDERLY_FX_QUOTE_CURRENCIES,
  frankfurterRangeResponseSchema,
  frankfurterRatesResponseSchema,
  isoDateSchema,
  type BinderlyFxQuoteCurrency,
  type FrankfurterRangeResponse,
  type FrankfurterRatesResponse,
} from './types.js';
