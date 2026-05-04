// Public barrel for the pricing aggregator adapter
// (T-DL-PRICING-AGGREGATOR — Layer 1 pricing per PROJECT.md § 13).
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`);
// internal modules can pull directly from this file.

export {
  // Types + zod schemas
  aggregatorQuoteSchema,
  cardmarketQuoteSchema,
  ebaySoldListingQuoteSchema,
  marketCodeSchema,
  observationKindSchema,
  rawPriceObservationSchema,
  MARKET_CODES,
  OBSERVATION_KINDS,
  GRADE_TIERS,
  gradeTierSchema,
} from './types.js';
export type {
  AggregatorQuote,
  CardmarketQuote,
  EbaySoldListingQuote,
  GradeTier,
  MarketCode,
  ObservationKind,
  RawPriceObservation,
} from './types.js';

export {
  createLivePricingAggregatorClient,
  isMockAggregatorEnabled,
  LiveClientNotConfiguredError,
} from './client.js';
export type {
  FetchQuotesOptions,
  LivePricingAggregatorClientConfig,
  PricingAggregatorClient,
} from './client.js';

export {
  createMockPricingAggregatorClient,
  filterQuotes,
  MockPricingAggregatorClient,
  MOCK_FIXTURES_DIR,
  MOCK_PRICING_AGGREGATOR_VENDOR,
} from './mock.js';
export type { MockPricingAggregatorClientConfig } from './mock.js';

export { priceToPennies, synthesizeSourceListingId } from './canonical-id.js';
export type { SynthesizeContext } from './canonical-id.js';

export { resolveQuote } from './resolver.js';
export type {
  PricingAggregatorCatalogReader,
  PricingCatalogPrinting,
  ResolveQuoteOutcome,
} from './resolver.js';

export {
  DrizzlePricingAggregatorCatalogReader,
  DrizzlePriceObservationRepo,
  InMemoryPriceObservationRepo,
  rawToNewPriceObservation,
} from './repo.js';
export type { PriceObservationRepo } from './repo.js';

export { formatConfidence, runPricingAggregatorIngest } from './job.js';
export type {
  PricingAggregatorIngestError,
  PricingAggregatorIngestReport,
  RunPricingAggregatorIngestOptions,
} from './job.js';
