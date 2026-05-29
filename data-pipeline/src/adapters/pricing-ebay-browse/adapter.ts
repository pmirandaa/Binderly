// `EbayBrowseAdapter` — orchestrates `EbayBrowseClient` +
// `parseEbayListing` + `resolveListingToPrinting` to emit a stream
// of `RawPriceObservation` records (Layer 2, `observation_kind =
// 'active_listing'`).
//
// Pipeline per query:
//
//   for each page from `client.searchItemSummaries(...)`:
//     for each itemSummary:
//       parsed = parseEbayListing(itemSummary.title)
//       joined = await resolveListingToPrinting(parsed, catalogReader)
//       if joined.confidence < THRESHOLD or joined.printingId is null: skip
//       gradeTier = parsed.grading.gradeTier
//                 ?? conditionToTier(parsed.condition)
//                 ?? 'RAW_UNKNOWN'
//       emit RawPriceObservation { ...native price, ...market }
//
// The adapter exposes `streamObservationsForQuery({ query, marketplace,
// maxListings })` returning an async iterable so the runner can apply
// upstream-bound limits without buffering full pages in memory.

import { PRICING_EBAY_BROWSE_SOURCE, type EbayBrowseClientLike } from './client.js';
import { EBAY_MARKETPLACE_TO_BINDERLY } from './types.js';
import { type AdapterContext, type AdapterLogger } from '../../interfaces/adapter.js';
import {
  conditionToTier,
  parseEbayListing,
  resolveListingToPrinting,
  type ParsedListing,
  type ParserCatalogReader,
} from '../../parsers/ebay-listing/index.js';

import type { EbayItemSummary, EbayMarketplace } from './types.js';
import type { PriceObservationGradeTier, RawPriceObservation } from '../../types.js';

/**
 * Confidence floor below which a `(parsed, joined)` listing is
 * dropped before write. See task spec § "Listing → printing join"
 * for the rationale.
 */
export const PRICING_EBAY_BROWSE_MIN_CONFIDENCE = 0.5;

/** Default per-page limit for streamed queries. */
export const PRICING_EBAY_BROWSE_DEFAULT_PAGE_SIZE = 50;

/**
 * Maximum number of pages we'll page through for a single query
 * before stopping. eBay caps total results at 10_000 anyway; the
 * floor here is a safety net against misconfigured queries that
 * return millions of irrelevant rows. 20 pages × 50 = 1_000
 * listings per query is plenty for "current price for this card".
 */
export const PRICING_EBAY_BROWSE_DEFAULT_MAX_PAGES = 20;

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

export interface EbayBrowseAdapterConfig {
  /**
   * Live client (`EbayBrowseClient`) or mock
   * (`MockEbayBrowseClient`). Anything matching `EbayBrowseClientLike`.
   */
  readonly client: EbayBrowseClientLike;
  /**
   * Catalog reader for the joiner. Production wires a Drizzle-backed
   * implementation; tests pass an in-memory shim.
   */
  readonly catalogReader: ParserCatalogReader;
  /** Optional shared adapter context (logger, env). */
  readonly context?: AdapterContext;
  /** Confidence floor; defaults to `PRICING_EBAY_BROWSE_MIN_CONFIDENCE`. */
  readonly minConfidence?: number;
  /** Clock injection — defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export interface StreamObservationsOptions {
  readonly query: string;
  readonly marketplace: EbayMarketplace;
  /** Per-page limit (max 200, capped by eBay). */
  readonly pageSize?: number;
  /** Hard cap on total listings yielded for this query. */
  readonly maxListings?: number;
  /** Hard cap on pages fetched for this query. */
  readonly maxPages?: number;
}

/**
 * Pipeline counters surfaced for the per-query shard of the
 * runner's report. The adapter does not own the report itself —
 * the runner does — but it surfaces the deltas it observed during
 * a single `streamObservationsForQuery` invocation.
 */
export interface StreamObservationsStats {
  /** Total `itemSummaries` seen from the upstream. */
  listingsFetched: number;
  /** Listings that produced a `ParsedListing`. */
  listingsParsed: number;
  /** Dropped because `parsedListing.isLot === true`. */
  droppedLot: number;
  /** Dropped because confidence < threshold (after join). */
  droppedLowConfidence: number;
  /** Dropped because `printingId` could not be resolved. */
  droppedUnresolved: number;
  /** Pages of upstream results consumed. */
  pagesFetched: number;
}

export interface StreamObservationsResult {
  readonly observations: RawPriceObservation[];
  readonly stats: StreamObservationsStats;
}

export class EbayBrowseAdapter {
  readonly source = PRICING_EBAY_BROWSE_SOURCE;

  private readonly client: EbayBrowseClientLike;
  private readonly catalogReader: ParserCatalogReader;
  private readonly logger: AdapterLogger;
  private readonly minConfidence: number;
  private readonly now: () => Date;

  constructor(config: EbayBrowseAdapterConfig) {
    if (!config.client) {
      throw new Error('EbayBrowseAdapter: `client` is required');
    }
    if (!config.catalogReader) {
      throw new Error('EbayBrowseAdapter: `catalogReader` is required');
    }
    this.client = config.client;
    this.catalogReader = config.catalogReader;
    this.logger = config.context?.logger ?? NOOP_LOGGER;
    this.minConfidence = config.minConfidence ?? PRICING_EBAY_BROWSE_MIN_CONFIDENCE;
    this.now = config.now ?? ((): Date => new Date());
  }

  /**
   * Fetch + parse + join + emit `RawPriceObservation`s for a single
   * search query. Pages through results until `maxListings` /
   * `maxPages` is reached or the upstream returns an empty page.
   */
  async streamObservationsForQuery(
    options: StreamObservationsOptions,
  ): Promise<StreamObservationsResult> {
    const pageSize = options.pageSize ?? PRICING_EBAY_BROWSE_DEFAULT_PAGE_SIZE;
    const maxPages = options.maxPages ?? PRICING_EBAY_BROWSE_DEFAULT_MAX_PAGES;
    const maxListings = options.maxListings ?? Number.POSITIVE_INFINITY;

    const stats: StreamObservationsStats = {
      listingsFetched: 0,
      listingsParsed: 0,
      droppedLot: 0,
      droppedLowConfidence: 0,
      droppedUnresolved: 0,
      pagesFetched: 0,
    };
    const observations: RawPriceObservation[] = [];
    const marketplaceMeta = EBAY_MARKETPLACE_TO_BINDERLY[options.marketplace];

    let offset = 0;
    while (stats.pagesFetched < maxPages && stats.listingsFetched < maxListings) {
      const page = await this.client.searchItemSummaries({
        query: options.query,
        marketplace: options.marketplace,
        limit: pageSize,
        offset,
      });
      stats.pagesFetched += 1;
      const items: ReadonlyArray<EbayItemSummary> = page.itemSummaries;
      if (items.length === 0) break;
      stats.listingsFetched += items.length;

      for (const item of items) {
        if (
          observations.length +
            (stats.droppedLot + stats.droppedLowConfidence + stats.droppedUnresolved) >=
          maxListings
        ) {
          break;
        }
        const observation = await this.processItem(
          item,
          options.marketplace,
          marketplaceMeta,
          stats,
        );
        if (observation !== null) observations.push(observation);
      }

      // Paginate: stop when we got fewer than a full page (upstream
      // is exhausted) or when the upstream's `total` says we're done.
      if (items.length < pageSize) break;
      offset += pageSize;
    }

    this.logger.info(
      {
        source: this.source,
        marketplace: options.marketplace,
        query: options.query,
        ...stats,
        observations: observations.length,
      },
      'ebay-browse.adapter.query.done',
    );
    return { observations, stats };
  }

  private async processItem(
    item: EbayItemSummary,
    marketplace: EbayMarketplace,
    marketplaceMeta: { market: string; currency: string },
    stats: StreamObservationsStats,
  ): Promise<RawPriceObservation | null> {
    let parsed: ParsedListing;
    try {
      parsed = parseEbayListing(item.title);
      stats.listingsParsed += 1;
    } catch (cause) {
      // The parser is best-effort; this branch is defensive — it
      // should never fire for any string title. If it does, log + skip.
      this.logger.warn(
        { source: this.source, itemId: item.itemId, err: errToObj(cause) },
        'ebay-browse.parser.threw',
      );
      stats.droppedUnresolved += 1;
      return null;
    }

    if (parsed.isLot) {
      stats.droppedLot += 1;
      return null;
    }

    const joined = await resolveListingToPrinting(parsed, this.catalogReader);
    if (joined.printingId === null) {
      stats.droppedUnresolved += 1;
      return null;
    }
    if (joined.confidence < this.minConfidence) {
      stats.droppedLowConfidence += 1;
      return null;
    }

    const gradeTier: PriceObservationGradeTier =
      parsed.grading.gradeTier ??
      (parsed.condition === null ? 'RAW_UNKNOWN' : conditionToTier(parsed.condition));

    const observedAt = this.now();
    const observedDate = isoDateUtc(observedAt);

    const observedPrice = normalizeNumeric(item.price.value);
    const shippingValue = item.shippingOptions?.[0]?.shippingCost?.value;
    const shipping = shippingValue !== undefined ? normalizeNumeric(shippingValue) : null;

    const rawMetadata: Record<string, unknown> = {
      title: item.title,
    };
    if (item.itemWebUrl !== undefined) rawMetadata['itemWebUrl'] = item.itemWebUrl;
    if (item.seller?.username !== undefined) rawMetadata['sellerUsername'] = item.seller.username;
    if (item.itemCreationDate !== undefined)
      rawMetadata['itemCreationDate'] = item.itemCreationDate;
    if (item.condition !== undefined) rawMetadata['condition'] = item.condition;
    if (item.image?.imageUrl !== undefined) rawMetadata['imageUrl'] = item.image.imageUrl;
    if (item.itemLocation?.country !== undefined)
      rawMetadata['country'] = item.itemLocation.country;
    if (item.buyingOptions !== undefined) rawMetadata['buyingOptions'] = [...item.buyingOptions];
    rawMetadata['marketplace'] = marketplace;
    rawMetadata['parserConfidence'] = joined.confidence;

    return {
      source: PRICING_EBAY_BROWSE_SOURCE,
      sourceListingId: item.itemId,
      printingId: joined.printingId,
      observationKind: 'active_listing',
      market: marketplaceMeta.market,
      gradeTier,
      observedPrice,
      observedCurrency: item.price.currency,
      shipping,
      parseConfidence: round2(joined.confidence).toFixed(2),
      observedAt,
      observedDate,
      rawMetadata,
    };
  }
}

/**
 * Convert a `numeric(12,2)` string from upstream to the canonical
 * shape the schema regex expects (`/^-?\d+(\.\d{1,2})?$/`). eBay
 * returns prices like `'12.34'` or `'12'` — we normalise to two
 * decimals when possible. Bad input throws.
 */
export function normalizeNumeric(value: string): string {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/u.test(trimmed)) {
    throw new Error(`EbayBrowseAdapter.normalizeNumeric: invalid numeric ${JSON.stringify(value)}`);
  }
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`EbayBrowseAdapter.normalizeNumeric: non-finite ${JSON.stringify(value)}`);
  }
  return n.toFixed(2);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoDateUtc(d: Date): string {
  // `toISOString()` always returns UTC; slice the date prefix.
  return d.toISOString().slice(0, 10);
}

function errToObj(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}
