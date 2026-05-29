// `@binderly/pricing-display` — public barrel.
//
// External consumers (the price-aggregate enrichment paths in
// `apps/api-python/`'s sibling Edge Functions, the web app's
// card-detail page, the mobile card-detail page) MUST import
// from this entry point. Deep imports like
// `@binderly/pricing-display/convert` are not exposed in the
// package.json `exports` map.
//
// The package is pure logic — no IO, no DB, no HTTP — so every
// export is either a function, a type, or a constant.

export { convertPrice, convertPriceRange, bestEffortConvert } from './convert.js';

export { formatPrice, isSupportedCurrency, isWellFormedCurrencyCode } from './format.js';

export {
  formatTrendPercent,
  hasRenderableTrend,
  trendArrow,
  trendDirectionLabel,
} from './trend.js';

export type { PriceTrendDirection } from './trend.js';

export { convertCurrentPriceRow } from './row-helpers.js';

export {
  DEFAULT_FALLBACK_WINDOW_DAYS,
  DEFAULT_LOCALE,
  FX_BASE_CURRENCY,
  SUPPORTED_CURRENCIES,
} from './types.js';

export type {
  ConversionFailureReason,
  ConversionOptions,
  ConversionRangeResult,
  ConversionResult,
  ConvertedCurrentPrice,
  ConvertedCurrentPriceResult,
  ConvertedPrice,
  ConvertedPriceRange,
  CurrentPriceRow,
  FxRateLookup,
  PriceObservationInput,
  PriceRangeInput,
  SupportedCurrency,
} from './types.js';
