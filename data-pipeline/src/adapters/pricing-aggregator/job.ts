// `runPricingAggregatorIngest` — the runtime job that drives the
// pricing aggregator end-to-end:
//
//   PricingAggregatorClient.fetchQuotes(opts)
//     → for each quote:
//         resolveQuote (variant-key lookup ‖ listing-title parse + join)
//         synthesizeSourceListingId
//         build RawPriceObservation
//     → PriceObservationRepo.upsertMany(rows)
//   → PricingAggregatorIngestReport
//
// Per-quote failures (lot dropped, missing printing, unresolved
// listing, unknown market) are non-fatal: they're recorded in
// `report.errors[]` and the run continues. Fatal failures (the
// client throws, the repo throws on the batch write) bubble out;
// the future cron entry is expected to exit non-zero on those.

import { synthesizeSourceListingId } from './canonical-id.js';
import { type PricingAggregatorClient } from './client.js';
import { type PriceObservationRepo } from './repo.js';
import { resolveQuote, type PricingAggregatorCatalogReader } from './resolver.js';
import { marketCodeSchema, type AggregatorQuote, type RawPriceObservation } from './types.js';
import { type AdapterLogger } from '../../interfaces/adapter.js';

// ============================================================
// Public types
// ============================================================

export interface PricingAggregatorIngestError {
  readonly kind:
    | 'parse_failed'
    | 'unresolved_listing'
    | 'missing_printing'
    | 'lot_dropped'
    | 'unknown_market';
  readonly sourceListingId?: string;
  readonly variantKey?: string;
  readonly listingTitle?: string;
  readonly message: string;
}

export interface PricingAggregatorIngestReport {
  /** `aggregator_<vendor>` — same string the rows carry. */
  readonly source: string;
  /** Echo of the runner inputs the caller supplied. */
  readonly rangeRequested: {
    readonly since?: string;
    readonly until?: string;
    readonly printings?: number;
  };
  readonly quotesFetched: number;
  /** Number of quotes that resolved to a printing (pre-write). */
  readonly observationsResolved: number;
  /** Number of rows the repo confirmed it wrote. */
  readonly observationsWritten: number;
  readonly durationMs: number;
  readonly errors: ReadonlyArray<PricingAggregatorIngestError>;
}

export interface RunPricingAggregatorIngestOptions {
  readonly client: PricingAggregatorClient;
  readonly catalog: PricingAggregatorCatalogReader;
  readonly repo: PriceObservationRepo;
  readonly logger?: AdapterLogger;
  /** Echoed into the report and forwarded to the client. */
  readonly since?: string;
  readonly until?: string;
  readonly printings?: ReadonlyArray<string>;
  /** Optional clock override for tests. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

// ============================================================
// Public entry
// ============================================================

export async function runPricingAggregatorIngest(
  options: RunPricingAggregatorIngestOptions,
): Promise<PricingAggregatorIngestReport> {
  const logger = options.logger ?? NOOP_LOGGER;
  const clock = options.clock ?? (() => Date.now());
  const startedAt = clock();
  const source = `aggregator_${options.client.vendor}`;

  logger.info(
    {
      source,
      since: options.since,
      until: options.until,
      printings: options.printings?.length,
    },
    'pricing-aggregator.start',
  );

  const fetchOpts: {
    since?: string;
    until?: string;
    printings?: ReadonlyArray<string>;
  } = {};
  if (options.since !== undefined) fetchOpts.since = options.since;
  if (options.until !== undefined) fetchOpts.until = options.until;
  if (options.printings !== undefined) fetchOpts.printings = options.printings;
  const quotes = await options.client.fetchQuotes(fetchOpts);

  const errors: PricingAggregatorIngestError[] = [];
  const observations: RawPriceObservation[] = [];

  for (const quote of quotes) {
    const built = await processOneQuote({
      quote,
      catalog: options.catalog,
      source,
    });
    if (built.error) {
      errors.push(built.error);
      continue;
    }
    observations.push(built.observation);
  }

  let observationsWritten = 0;
  if (observations.length > 0) {
    observationsWritten = await options.repo.upsertMany(observations);
  }

  const durationMs = clock() - startedAt;
  const report: PricingAggregatorIngestReport = {
    source,
    rangeRequested: buildRange(options),
    quotesFetched: quotes.length,
    observationsResolved: observations.length,
    observationsWritten,
    durationMs,
    errors,
  };
  logger.info(
    {
      source,
      quotesFetched: report.quotesFetched,
      observationsResolved: report.observationsResolved,
      observationsWritten: report.observationsWritten,
      errorCount: errors.length,
      durationMs,
    },
    'pricing-aggregator.done',
  );
  return report;
}

// ============================================================
// Per-quote processing
// ============================================================

interface ProcessOneArgs {
  readonly quote: AggregatorQuote;
  readonly catalog: PricingAggregatorCatalogReader;
  readonly source: string;
}

type ProcessOneResult =
  | { readonly observation: RawPriceObservation; readonly error?: undefined }
  | { readonly observation?: undefined; readonly error: PricingAggregatorIngestError };

async function processOneQuote(args: ProcessOneArgs): Promise<ProcessOneResult> {
  const { quote, catalog, source } = args;

  // Validate market early — caller-supplied JSON could carry an
  // unknown code. Schema-level enum catches this for fixtures, but
  // a future live client could surface a new market value.
  const marketCheck = marketCodeSchema.safeParse(quote.market);
  if (!marketCheck.success) {
    return {
      error: {
        kind: 'unknown_market',
        message: `unknown market code: ${JSON.stringify(quote.market)}`,
      },
    };
  }

  let outcome;
  try {
    outcome = await resolveQuote(quote, catalog);
  } catch (cause) {
    return {
      error: {
        kind: 'parse_failed',
        listingTitle: quote.kind === 'ebay_sold_listing' ? quote.listingTitle : undefined,
        variantKey: quote.kind === 'cardmarket_quote' ? quote.printingVariantKey : undefined,
        message: `quote resolution threw: ${describeError(cause)}`,
      },
    };
  }

  if (outcome.status === 'lot_dropped') {
    return {
      error: {
        kind: 'lot_dropped',
        listingTitle: outcome.listingTitle,
        message: `listing parsed as lot; not a single-card observation`,
      },
    };
  }
  if (outcome.status === 'missing_printing') {
    return {
      error: {
        kind: 'missing_printing',
        variantKey: outcome.variantKey,
        message: `catalog has no printing for variantKey ${outcome.variantKey}`,
      },
    };
  }
  if (outcome.status === 'unresolved_listing') {
    return {
      error: {
        kind: 'unresolved_listing',
        listingTitle: outcome.listingTitle,
        message: `listing parser could not attribute the title to a printing`,
      },
    };
  }

  // outcome.status === 'resolved'
  const printingId = outcome.printingId;
  const sourceListingId = synthesizeSourceListingId(quote, { printingId });
  const observation = buildRawObservation({
    quote,
    source,
    sourceListingId,
    printingId,
    parseConfidence: outcome.parseConfidence,
  });
  return { observation };
}

interface BuildRawArgs {
  readonly quote: AggregatorQuote;
  readonly source: string;
  readonly sourceListingId: string;
  readonly printingId: string;
  readonly parseConfidence: number | null;
}

function buildRawObservation(args: BuildRawArgs): RawPriceObservation {
  const { quote, source, sourceListingId, printingId, parseConfidence } = args;
  const observationKind: RawPriceObservation['observationKind'] =
    quote.kind === 'cardmarket_quote' ? 'aggregator_quote' : 'sold';
  const observedAt =
    quote.observedAt instanceof Date ? quote.observedAt : new Date(quote.observedAt);
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error(
      `runPricingAggregatorIngest: invalid observedAt ${JSON.stringify(quote.observedAt)}`,
    );
  }
  const shipping = quote.shipping ?? null;
  return {
    source,
    sourceListingId,
    observationKind,
    printingId,
    gradeTier: quote.gradeTier,
    market: quote.market,
    observedPrice: quote.price,
    observedCurrency: quote.currency,
    shipping,
    parseConfidence: parseConfidence === null ? null : formatConfidence(parseConfidence),
    observedAt,
    observedDate: quote.observedDate,
    rawMetadata: { ...quote.rawPayload, kind: quote.kind },
  };
}

/**
 * Format a 0..1 confidence as a `numeric(3,2)`-friendly string.
 * Mirrors the FX-rate `formatRate` posture (string round-trip
 * avoids float-rounding surprises in postgres-js).
 */
export function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  const clamped = Math.max(0, Math.min(1, value));
  return clamped.toFixed(2);
}

function buildRange(
  options: RunPricingAggregatorIngestOptions,
): PricingAggregatorIngestReport['rangeRequested'] {
  const range: {
    -readonly [K in keyof PricingAggregatorIngestReport['rangeRequested']]?: PricingAggregatorIngestReport['rangeRequested'][K];
  } = {};
  if (options.since !== undefined) range.since = options.since;
  if (options.until !== undefined) range.until = options.until;
  if (options.printings !== undefined) range.printings = options.printings.length;
  return range;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
