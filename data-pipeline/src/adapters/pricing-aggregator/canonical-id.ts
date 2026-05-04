// Synthesise a stable `(source, source_listing_id)` upsert key for
// every `AggregatorQuote` we resolve.
//
// The pricing schema's `UNIQUE (source, source_listing_id)` carries
// Postgres's default NULLS DISTINCT — `NULL` listing ids do NOT
// dedup. The aggregator adapter therefore never writes a NULL; we
// synthesise a deterministic id per quote so re-running the runner
// against the same fixtures (or the same vendor day) is idempotent.
//
// Synthesis rules (mirrors the elaborated task spec):
//
//   - `ebay_sold_listing` with vendor-supplied `listingId`:
//       `${vendor}:ebay:${listingId}`
//   - `ebay_sold_listing` without vendor `listingId` (rare;
//     aggregator-curated):
//       `${vendor}:ebay-syn:${printingId}:${gradeTier}:${observedDate}:${pricePennies}`
//     where `pricePennies` is `Math.round(price * 100)` so two
//     same-day same-printing same-grade observations at distinct
//     prices do not collapse onto one row.
//   - `cardmarket_quote`:
//       `${vendor}:cm:${printingId}:${gradeTier}:${market}:${currency}:${observedDate}`
//
// All synthesis is pure: same inputs → same string. No clocks, no
// side effects.

import type { AggregatorQuote } from './types.js';

export interface SynthesizeContext {
  /** Catalog `printing.id` UUID resolved at runtime. */
  readonly printingId: string;
}

/**
 * Build the canonical `source_listing_id` for a resolved quote.
 *
 * Throws if a quote shape leaks into this function with no path
 * defined — the type system already prevents that, but we keep
 * the runtime guard for defensive parity with adapter conventions
 * elsewhere in the package.
 */
export function synthesizeSourceListingId(quote: AggregatorQuote, ctx: SynthesizeContext): string {
  const vendor = quote.vendor.trim().toLowerCase();
  if (!vendor) {
    throw new Error('synthesizeSourceListingId: quote.vendor is empty');
  }
  if (!ctx.printingId) {
    throw new Error('synthesizeSourceListingId: ctx.printingId is empty');
  }

  if (quote.kind === 'cardmarket_quote') {
    return [
      vendor,
      'cm',
      ctx.printingId,
      quote.gradeTier,
      quote.market,
      quote.currency,
      quote.observedDate,
    ].join(':');
  }

  // ebay_sold_listing
  const listingId = quote.listingId?.trim();
  if (listingId && listingId.length > 0) {
    return [vendor, 'ebay', listingId].join(':');
  }
  // Synthetic fallback — collapses dupes within the same day at the
  // same price; new sales of the same day at a different price get
  // distinct ids.
  const pricePennies = priceToPennies(quote.price);
  return [
    vendor,
    'ebay-syn',
    ctx.printingId,
    quote.gradeTier,
    quote.observedDate,
    String(pricePennies),
  ].join(':');
}

/**
 * Convert a `numeric(12,2)`-style price string (e.g. `'12.34'`) to
 * an integer-pennies count. We avoid `Number(value) * 100` to
 * sidestep float-rounding surprises — the schema's price column is
 * `numeric(12,2)`, so two decimal places is the contract.
 */
export function priceToPennies(price: string): number {
  if (!/^\d+(\.\d+)?$/u.test(price)) {
    throw new Error(`priceToPennies: invalid price string ${JSON.stringify(price)}`);
  }
  const [whole, fraction = ''] = price.split('.');
  const wholeN = Number.parseInt(whole ?? '0', 10);
  if (!Number.isFinite(wholeN)) {
    throw new Error(`priceToPennies: whole part is not finite (${price})`);
  }
  // Pad / truncate fraction to two digits.
  const padded = (fraction + '00').slice(0, 2);
  const fractionN = Number.parseInt(padded || '0', 10);
  if (!Number.isFinite(fractionN)) {
    throw new Error(`priceToPennies: fraction part is not finite (${price})`);
  }
  return wholeN * 100 + fractionN;
}
