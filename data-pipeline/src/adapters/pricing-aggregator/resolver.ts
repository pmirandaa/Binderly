// Catalog resolution helpers for the pricing aggregator runner.
//
// Each `AggregatorQuote` has one of two resolution paths:
//
//   1. Cardmarket-style (`kind: 'cardmarket_quote'`): the
//      aggregator already attributes the quote to a specific
//      printing via its variant key. We do a direct
//      `findPrintingByVariantKey` lookup.
//
//   2. eBay-sold-listing-style (`kind: 'ebay_sold_listing'`): the
//      aggregator forwards the listing title verbatim. We
//      `parseEbayListing` then `resolveListingToPrinting` against
//      the catalog reader (the existing
//      `T-DL-EBAY-LISTING-PARSER` joiner).
//
// Lots (`isLot=true` per the parser) are dropped — they are by
// definition not single-card price observations.

import {
  parseEbayListing,
  resolveListingToPrinting,
  type ParsedListing,
  type ParserCatalogReader,
} from '../../parsers/ebay-listing/index.js';

import type { AggregatorQuote } from './types.js';

/**
 * Catalog row shape the resolver consumes for variant-key
 * lookups. Mirrors the relevant columns of `printing` so the
 * resolver remains DB-shape-agnostic and testable in-memory.
 */
export interface PricingCatalogPrinting {
  readonly id: string;
  readonly cardId: string;
  readonly variantKey: string;
}

/**
 * Reader extension the runner uses for catalog joins. Composes
 * the existing `ParserCatalogReader` (used by
 * `resolveListingToPrinting`) with one extra method for direct
 * variant-key lookups (Cardmarket pre-attributed quotes).
 *
 * Production wires a Drizzle-backed implementation
 * (`DrizzlePricingAggregatorCatalogReader` in `repo.ts`); tests
 * use a hand-rolled in-memory implementation.
 */
export interface PricingAggregatorCatalogReader extends ParserCatalogReader {
  findPrintingByVariantKey(variantKey: string): Promise<PricingCatalogPrinting | null>;
}

// ============================================================
// Resolution result types
// ============================================================

export type ResolveQuoteOutcome =
  | {
      readonly status: 'resolved';
      readonly printingId: string;
      /**
       * For eBay-sold-listing quotes: the joiner's
       * confidence score (0..1). Null for Cardmarket quotes —
       * those are pre-attributed by the aggregator and don't
       * carry a parser confidence at all (we encode "no parse
       * stage" as null per the schema, distinct from "parsed
       * with low confidence").
       */
      readonly parseConfidence: number | null;
      /**
       * The parsed listing for eBay-sold quotes (used for the
       * `raw_metadata` debug surface). Undefined for
       * Cardmarket quotes.
       */
      readonly parsed?: ParsedListing;
    }
  | {
      readonly status: 'missing_printing';
      readonly variantKey: string;
    }
  | {
      readonly status: 'unresolved_listing';
      readonly listingTitle: string;
      readonly parsed: ParsedListing;
    }
  | {
      readonly status: 'lot_dropped';
      readonly listingTitle: string;
      readonly parsed: ParsedListing;
    };

/**
 * Resolve a single quote to a `printing.id` plus any extra
 * metadata the runner needs (parser confidence, parsed shape).
 * Pure-ish: depends on the reader for catalog data but otherwise
 * deterministic.
 */
export async function resolveQuote(
  quote: AggregatorQuote,
  reader: PricingAggregatorCatalogReader,
): Promise<ResolveQuoteOutcome> {
  if (quote.kind === 'cardmarket_quote') {
    const row = await reader.findPrintingByVariantKey(quote.printingVariantKey);
    if (row === null) {
      return { status: 'missing_printing', variantKey: quote.printingVariantKey };
    }
    return {
      status: 'resolved',
      printingId: row.id,
      parseConfidence: null,
    };
  }
  // ebay_sold_listing
  const parsed = parseEbayListing(quote.listingTitle);
  if (parsed.isLot) {
    return { status: 'lot_dropped', listingTitle: quote.listingTitle, parsed };
  }
  const join = await resolveListingToPrinting(parsed, reader);
  if (join.printingId === null) {
    return { status: 'unresolved_listing', listingTitle: quote.listingTitle, parsed };
  }
  return {
    status: 'resolved',
    printingId: join.printingId,
    parseConfidence: join.confidence,
    parsed,
  };
}
