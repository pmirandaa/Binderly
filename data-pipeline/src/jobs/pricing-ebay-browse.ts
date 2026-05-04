// `runPricingEbayBrowseIngest` — the public entry point for the
// Layer-2 pricing ingestion job (eBay Browse — active listings).
//
// Mirrors the shape of `runFxRatesIngest` from
// `data-pipeline/src/jobs/fx-rates.ts`:
//
//   1. Caller (CLI / cron / test) constructs an `EbayBrowseAdapter`
//      (which wraps an `EbayBrowseClient` or a mock) plus a
//      `EbayBrowsePriceObservationRepo` (Drizzle in production; in-memory in
//      tests).
//   2. Caller decides on a query plan: either an explicit list of
//      free-text queries or a set canonical key (e.g. `'en-swsh9'`)
//      whose cards are enumerated into one query each.
//   3. The job iterates the query plan, calls
//      `adapter.streamObservationsForQuery`, batches the resulting
//      `RawEbayBrowsePriceObservation` rows into `repo.upsertMany`, and
//      tallies per-query stats into the report.
//
// Idempotency: relies on `price_observation`'s
// `UNIQUE (source, source_listing_id)` (default NULLS DISTINCT) per
// `packages/db/src/schema/prices.ts`. Re-running the job is a no-op
// for unchanged listings — every row hits the unique constraint and
// the upsert overwrites in place. The production repo wires Drizzle's
// `onConflictDoUpdate` on that pair.
//
// Reporting: returns a `PricingEbayBrowseReport` describing what
// happened. The CLI prints it as JSON on stdout; cron alerting
// consumes it directly.

import {
  EbayBrowseAdapter,
  PRICING_EBAY_BROWSE_SOURCE,
} from '../adapters/pricing-ebay-browse/index.js';
import { NotFoundError, type AdapterLogger } from '../interfaces/adapter.js';

import type { EbayMarketplace } from '../adapters/pricing-ebay-browse/index.js';
import type { RawEbayBrowsePriceObservation } from '../types.js';

// ============================================================
// Repo boundary
// ============================================================

/**
 * Thin abstraction the runner depends on for persistence. Tests
 * inject `InMemoryEbayBrowsePriceObservationRepo`; production wires a
 * Drizzle-backed implementation in
 * `scripts/pricing-ebay-browse.ts`.
 */
export interface EbayBrowsePriceObservationRepo {
  /**
   * Upsert all rows in a single batch. Returns the number of rows
   * processed (Postgres reports it; the in-memory shim returns
   * `rows.length`). Implementations MUST use the canonical UNIQUE
   * `(source, source_listing_id)` for ON CONFLICT.
   */
  upsertMany(rows: ReadonlyArray<RawEbayBrowsePriceObservation>): Promise<number>;
}

// ============================================================
// Set / catalog reader (for set-key driven query plans)
// ============================================================

/**
 * Minimal reader the runner needs to enumerate cards in a set when
 * the caller passes a `setKey`. Tests pass an in-memory list; the
 * CLI wires `@binderly/db` over `card`.
 */
export interface PricingSetReader {
  /**
   * Return every card in the named canonical set (e.g. `en-swsh9`),
   * ordered for deterministic test output.
   */
  listCardsInSet(setCanonicalKey: string): Promise<ReadonlyArray<PricingSetReaderCard>>;
}

export interface PricingSetReaderCard {
  readonly canonicalKey: string;
  readonly name: string;
  readonly number: string;
  readonly setCanonicalKey: string;
  readonly setName: string;
}

// ============================================================
// Public options + report
// ============================================================

/**
 * Per-query-or-error breadcrumb. Errors are non-fatal: the runner
 * collects them and keeps going. Fatal errors (network outage,
 * malformed schema) bubble out of `runPricingEbayBrowseIngest`
 * directly.
 */
export interface PricingEbayBrowseError {
  /** The query string the failure pertains to (`'*'` if pre-fetch). */
  query: string;
  message: string;
}

/**
 * End-of-run report. Always emitted, even on partial failure.
 */
export interface PricingEbayBrowseReport {
  source: typeof PRICING_EBAY_BROWSE_SOURCE;
  marketplace: EbayMarketplace;
  /** Total queries the job attempted. */
  queriesRequested: number;
  /** Queries that returned a non-error response. */
  queriesSucceeded: number;
  /** Total `itemSummary` rows seen from upstream. */
  listingsFetched: number;
  /** Listings that produced a `ParsedListing`. */
  listingsParsed: number;
  /** Dropped because `parsedListing.isLot === true`. */
  droppedLot: number;
  /** Dropped because confidence < threshold. */
  droppedLowConfidence: number;
  /** Dropped because `printingId` could not be resolved. */
  droppedUnresolved: number;
  /** Total rows the repo confirmed it wrote. */
  observationsUpserted: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  errors: ReadonlyArray<PricingEbayBrowseError>;
}

export interface RunPricingEbayBrowseIngestOptions {
  /** Adapter wired with client + catalog reader. */
  adapter: EbayBrowseAdapter;
  /** Persistence layer; injected by the CLI / tests. */
  repo: EbayBrowsePriceObservationRepo;
  /** Marketplace to drive (only one per run for v1). Defaults `EBAY_US`. */
  marketplace?: EbayMarketplace;
  /**
   * Explicit query strings. Each query becomes one
   * `searchItemSummaries` page-walk. Mutually exclusive with
   * `setKey`.
   */
  queries?: ReadonlyArray<string>;
  /**
   * Set canonical key (e.g. `'en-swsh9'`) — the runner enumerates
   * cards in the set and synthesises one query per card.
   * Requires `setReader`.
   */
  setKey?: string;
  /** Required when `setKey` is set. */
  setReader?: PricingSetReader;
  /**
   * Hard cap on queries dispatched. Bounded so the daily eBay
   * quota can't burn through on a runaway loop. Defaults to no
   * cap.
   */
  maxQueries?: number | null;
  /** Override the per-query page size (max 200). */
  pageSize?: number;
  /** Override the per-query max-pages cap. */
  maxPagesPerQuery?: number;
  /** Optional cap on listings *yielded* per query. */
  maxListingsPerQuery?: number;
  /** Optional logger; defaults to a noop. */
  logger?: AdapterLogger;
  /** Optional clock override (defaults to `() => new Date()`). */
  now?: () => Date;
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

/**
 * Run the pricing-ebay-browse ingest. Resolves with a
 * `PricingEbayBrowseReport`. Survivable failures (per-query 404,
 * partial-day failures) are recorded in `report.errors` and the run
 * continues; truly fatal errors (a network outage on the OAuth call,
 * a contract change at the upstream) bubble.
 */
export async function runPricingEbayBrowseIngest(
  opts: RunPricingEbayBrowseIngestOptions,
): Promise<PricingEbayBrowseReport> {
  if (!opts.adapter) throw new Error('runPricingEbayBrowseIngest: `adapter` is required');
  if (!opts.repo) throw new Error('runPricingEbayBrowseIngest: `repo` is required');

  const startedAt = Date.now();
  const logger = opts.logger ?? NOOP_LOGGER;
  const marketplace: EbayMarketplace = opts.marketplace ?? 'EBAY_US';

  const queries = await resolveQueryPlan(opts);
  const cap =
    opts.maxQueries == null
      ? queries.length
      : Math.max(0, Math.min(queries.length, opts.maxQueries));
  const cappedQueries = queries.slice(0, cap);

  const errors: PricingEbayBrowseError[] = [];
  const buffered: RawEbayBrowsePriceObservation[] = [];
  let listingsFetched = 0;
  let listingsParsed = 0;
  let droppedLot = 0;
  let droppedLowConfidence = 0;
  let droppedUnresolved = 0;
  let queriesSucceeded = 0;

  logger.info(
    {
      source: PRICING_EBAY_BROWSE_SOURCE,
      marketplace,
      queries: cappedQueries.length,
      total_queries_planned: queries.length,
    },
    'pricing-ebay-browse.start',
  );

  for (const query of cappedQueries) {
    try {
      const streamOpts: {
        -readonly [K in keyof Parameters<
          typeof opts.adapter.streamObservationsForQuery
        >[0]]: Parameters<typeof opts.adapter.streamObservationsForQuery>[0][K];
      } = {
        query,
        marketplace,
      };
      if (opts.pageSize !== undefined) streamOpts.pageSize = opts.pageSize;
      if (opts.maxPagesPerQuery !== undefined) streamOpts.maxPages = opts.maxPagesPerQuery;
      if (opts.maxListingsPerQuery !== undefined) streamOpts.maxListings = opts.maxListingsPerQuery;
      const { observations, stats } = await opts.adapter.streamObservationsForQuery(streamOpts);
      queriesSucceeded += 1;
      listingsFetched += stats.listingsFetched;
      listingsParsed += stats.listingsParsed;
      droppedLot += stats.droppedLot;
      droppedLowConfidence += stats.droppedLowConfidence;
      droppedUnresolved += stats.droppedUnresolved;
      buffered.push(...observations);
    } catch (err) {
      if (err instanceof NotFoundError) {
        // Empty result for this query — record + continue. Some
        // queries simply have no listings on a given day.
        errors.push({ query, message: `ebay-browse: 404 for query "${query}"` });
        logger.warn(
          { source: PRICING_EBAY_BROWSE_SOURCE, query },
          'pricing-ebay-browse.query.empty',
        );
      } else {
        // Anything else fatal — log + rethrow so the CLI exits
        // non-zero. The caller can re-run on a narrower window.
        logger.error(
          { source: PRICING_EBAY_BROWSE_SOURCE, query, err: errToObj(err) },
          'pricing-ebay-browse.query.failed',
        );
        throw err;
      }
    }
  }

  let observationsUpserted = 0;
  if (buffered.length > 0) {
    observationsUpserted = await opts.repo.upsertMany(buffered);
  }

  const durationMs = Date.now() - startedAt;
  const report: PricingEbayBrowseReport = {
    source: PRICING_EBAY_BROWSE_SOURCE,
    marketplace,
    queriesRequested: cappedQueries.length,
    queriesSucceeded,
    listingsFetched,
    listingsParsed,
    droppedLot,
    droppedLowConfidence,
    droppedUnresolved,
    observationsUpserted,
    durationMs,
    errors,
  };
  logger.info(
    {
      source: PRICING_EBAY_BROWSE_SOURCE,
      marketplace,
      queriesRequested: cappedQueries.length,
      queriesSucceeded,
      listingsFetched,
      listingsParsed,
      observationsUpserted,
      droppedLot,
      droppedLowConfidence,
      droppedUnresolved,
      errors: errors.length,
      durationMs,
    },
    'pricing-ebay-browse.done',
  );
  return report;
}

// ============================================================
// Internals — query plan resolution
// ============================================================

async function resolveQueryPlan(opts: RunPricingEbayBrowseIngestOptions): Promise<string[]> {
  const explicit = opts.queries && opts.queries.length > 0;
  const setBased = typeof opts.setKey === 'string' && opts.setKey.length > 0;
  if (!explicit && !setBased) {
    throw new Error(
      'runPricingEbayBrowseIngest: must provide `queries` or `setKey` (with `setReader`)',
    );
  }
  if (explicit && setBased) {
    throw new Error('runPricingEbayBrowseIngest: `queries` and `setKey` are mutually exclusive');
  }
  if (explicit) {
    return [...(opts.queries as ReadonlyArray<string>)];
  }
  if (!opts.setReader) {
    throw new Error('runPricingEbayBrowseIngest: `setReader` is required when `setKey` is set');
  }
  const cards = await opts.setReader.listCardsInSet(opts.setKey as string);
  return cards.map((c) => `${c.name} ${c.setName} ${c.number}`);
}

function errToObj(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}

// ============================================================
// Test helpers
// ============================================================

/**
 * In-memory `EbayBrowsePriceObservationRepo`. Keys on the canonical UNIQUE
 * `(source, source_listing_id)`. Calling `upsertMany` twice with
 * the same key replaces the row in place — same posture as the SQL
 * `ON CONFLICT … DO UPDATE`.
 *
 * Useful for unit-testing the runner without spinning up Postgres.
 * Not exported from the public barrel; lives here so adapter-side
 * tests can reuse it.
 */
export class InMemoryEbayBrowsePriceObservationRepo implements EbayBrowsePriceObservationRepo {
  /** `(source, source_listing_id)` → row. */
  readonly rows = new Map<string, RawEbayBrowsePriceObservation>();

  async upsertMany(rows: ReadonlyArray<RawEbayBrowsePriceObservation>): Promise<number> {
    for (const row of rows) {
      const key = `${row.source}|${row.sourceListingId ?? '\u0000'}`;
      this.rows.set(key, { ...row });
    }
    return rows.length;
  }

  size(): number {
    return this.rows.size;
  }

  list(): RawEbayBrowsePriceObservation[] {
    return [...this.rows.values()].sort((a, b) => {
      if (a.printingId !== b.printingId) return a.printingId.localeCompare(b.printingId);
      return (a.sourceListingId ?? '').localeCompare(b.sourceListingId ?? '');
    });
  }
}

/**
 * In-memory `PricingSetReader` for tests. Constructor takes a flat
 * card list; `listCardsInSet` filters by `setCanonicalKey`.
 */
export class InMemoryPricingSetReader implements PricingSetReader {
  constructor(private readonly cards: ReadonlyArray<PricingSetReaderCard>) {}

  async listCardsInSet(setCanonicalKey: string): Promise<ReadonlyArray<PricingSetReaderCard>> {
    return this.cards.filter((c) => c.setCanonicalKey === setCanonicalKey);
  }
}
