// `PriceObservationRepo` — the single DB-write boundary the runner
// depends on. Mirrors the seed-ingest `CatalogWriter` posture from
// `data-pipeline/src/jobs/seed/db-upsert.ts`:
//
//   * The runner is unit-testable without spinning up Postgres
//     because it only depends on the interface.
//   * Production wires `DrizzlePriceObservationRepo` (drizzle +
//     `INSERT ... ON CONFLICT (...)
//     DO UPDATE SET ...`).
//   * Tests use `InMemoryPriceObservationRepo` (a `Map` keyed on
//     the `(source, source_listing_id)` pair the schema's UNIQUE
//     constraint enforces).
//
// Same module also ships `DrizzlePricingAggregatorCatalogReader`,
// the production implementation of the catalog reader the
// resolver consumes. Both production utilities live here together
// because they share the `DbClient` dependency.

import { sql } from 'drizzle-orm';

import {
  cardTable,
  printingTable,
  priceObservationTable,
  type DbClient,
  type NewPriceObservation,
} from '@binderly/db';

import type { PricingAggregatorCatalogReader, PricingCatalogPrinting } from './resolver.js';
import type { RawPriceObservation } from './types.js';
import type { ParserCatalogCard, ParserCatalogPrinting } from '../../parsers/ebay-listing/index.js';

// ============================================================
// Repo interface
// ============================================================

export interface PriceObservationRepo {
  /**
   * Upsert all rows in a single batch. Returns the number of
   * rows written (Postgres `RETURNING id` count for the drizzle
   * impl; `rows.length` for the in-memory shim). Implementations
   * MUST use `(source, source_listing_id)` as the conflict
   * target — that's the schema's documented UNIQUE constraint.
   */
  upsertMany(rows: ReadonlyArray<RawPriceObservation>): Promise<number>;
}

// ============================================================
// Drizzle implementation
// ============================================================

/**
 * Drizzle-backed `PriceObservationRepo`. Uses
 * `INSERT … VALUES (...) ON CONFLICT (source, source_listing_id)
 * DO UPDATE SET ...` per the schema's unique constraint.
 *
 * `excluded.*` is used in the SET clause so the upserted row
 * reflects the latest aggregator-emitted values; this matches
 * the schema's documented intent ("re-running with a different
 * source overwrites in place").
 */
export class DrizzlePriceObservationRepo implements PriceObservationRepo {
  constructor(private readonly db: DbClient) {}

  async upsertMany(rows: ReadonlyArray<RawPriceObservation>): Promise<number> {
    if (rows.length === 0) return 0;
    // Compile-time guard: the resolver hands us exactly the shape
    // drizzle expects. If a column is renamed underneath, this
    // line stops compiling.
    const values: NewPriceObservation[] = rows.map((r) => rawToNewPriceObservation(r));
    await this.db
      .insert(priceObservationTable)
      .values(values)
      .onConflictDoUpdate({
        target: [priceObservationTable.source, priceObservationTable.sourceListingId],
        set: {
          printingId: sql`excluded.printing_id`,
          gradeTier: sql`excluded.grade_tier`,
          market: sql`excluded.market`,
          observationKind: sql`excluded.observation_kind`,
          observedPrice: sql`excluded.observed_price`,
          observedCurrency: sql`excluded.observed_currency`,
          shipping: sql`excluded.shipping`,
          parseConfidence: sql`excluded.parse_confidence`,
          observedAt: sql`excluded.observed_at`,
          observedDate: sql`excluded.observed_date`,
          rawMetadata: sql`excluded.raw_metadata`,
          // Bump `ingested_at` to the current statement timestamp so
          // operators can tell when a row was last touched. Schema
          // default is `now()` for fresh inserts; for updates we
          // overwrite explicitly.
          ingestedAt: sql`now()`,
        },
      });
    return rows.length;
  }
}

/**
 * Map a `RawPriceObservation` to drizzle's `NewPriceObservation`.
 * Exported (rather than inlined) so the alignment is documented
 * in one place; the intentionally-narrow shape keeps the runner
 * decoupled from `@binderly/db`.
 */
export function rawToNewPriceObservation(row: RawPriceObservation): NewPriceObservation {
  return {
    printingId: row.printingId,
    gradeTier: row.gradeTier,
    market: row.market,
    source: row.source,
    sourceListingId: row.sourceListingId,
    observationKind: row.observationKind,
    observedPrice: row.observedPrice,
    observedCurrency: row.observedCurrency,
    shipping: row.shipping,
    parseConfidence: row.parseConfidence,
    observedAt: row.observedAt,
    observedDate: row.observedDate,
    rawMetadata: row.rawMetadata,
  };
}

// ============================================================
// Drizzle catalog reader
// ============================================================

/**
 * Production catalog reader. Exposes the three
 * `ParserCatalogReader` methods the listing parser's joiner
 * expects, plus the variant-key direct-lookup that Cardmarket
 * quotes need.
 *
 * Trigram / ILIKE name-fallback lookup is intentionally
 * straightforward — the aggregator's eBay-sold listings ride on
 * the listing-title parser's hint extraction, which is already
 * scoped to canonical-key lookups. The fallback path is rarely
 * exercised in practice.
 */
export class DrizzlePricingAggregatorCatalogReader implements PricingAggregatorCatalogReader {
  constructor(private readonly db: DbClient) {}

  async findCardByCanonicalKey(canonicalKey: string): Promise<ParserCatalogCard | null> {
    const rows = await this.db
      .select({
        id: cardTable.id,
        canonicalKey: cardTable.canonicalKey,
        setCanonicalKey: sql<string>`(SELECT s.canonical_key FROM "set" s WHERE s.id = ${cardTable.setId})`,
        name: cardTable.name,
      })
      .from(cardTable)
      .where(sql`${cardTable.canonicalKey} = ${canonicalKey}`)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      canonicalKey: row.canonicalKey,
      setCanonicalKey: row.setCanonicalKey,
      name: row.name,
    };
  }

  async findCardsByNameAndSetCode({
    nameLike,
    setCanonicalKey,
    limit = 5,
  }: {
    nameLike: string;
    setCanonicalKey: string | null;
    limit?: number;
  }): Promise<readonly ParserCatalogCard[]> {
    const pattern = `%${nameLike}%`;
    const rows = await this.db
      .select({
        id: cardTable.id,
        canonicalKey: cardTable.canonicalKey,
        setCanonicalKey: sql<string>`(SELECT s.canonical_key FROM "set" s WHERE s.id = ${cardTable.setId})`,
        name: cardTable.name,
      })
      .from(cardTable)
      .where(
        setCanonicalKey == null
          ? sql`${cardTable.name} ILIKE ${pattern}`
          : sql`${cardTable.name} ILIKE ${pattern}
                AND EXISTS (
                  SELECT 1 FROM "set" s
                  WHERE s.id = ${cardTable.setId}
                    AND s.canonical_key = ${setCanonicalKey}
                )`,
      )
      .limit(limit);
    return rows;
  }

  async findPrintingsByCardId(cardId: string): Promise<readonly ParserCatalogPrinting[]> {
    const rows = await this.db
      .select({
        id: printingTable.id,
        variantKey: printingTable.variantKey,
        cardId: printingTable.cardId,
        variantClass: printingTable.variantClass,
        variantFlags: printingTable.variantFlags,
      })
      .from(printingTable)
      .where(sql`${printingTable.cardId} = ${cardId}`);
    return rows.map((r) => ({
      id: r.id,
      variantKey: r.variantKey,
      cardId: r.cardId,
      variantClass: r.variantClass,
      variantFlags: (r.variantFlags ?? []) as readonly string[],
    }));
  }

  async findPrintingByVariantKey(variantKey: string): Promise<PricingCatalogPrinting | null> {
    const rows = await this.db
      .select({
        id: printingTable.id,
        cardId: printingTable.cardId,
        variantKey: printingTable.variantKey,
      })
      .from(printingTable)
      .where(sql`${printingTable.variantKey} = ${variantKey}`)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, cardId: row.cardId, variantKey: row.variantKey };
  }
}

// ============================================================
// In-memory implementation (tests)
// ============================================================

/**
 * `InMemoryPriceObservationRepo` — `Map`-backed fake. Keyed on the
 * `(source, source_listing_id)` pair the schema's UNIQUE
 * constraint enforces. Calling `upsertMany` twice with the same
 * key replaces the row in place.
 */
export class InMemoryPriceObservationRepo implements PriceObservationRepo {
  readonly rows = new Map<string, RawPriceObservation>();

  async upsertMany(rows: ReadonlyArray<RawPriceObservation>): Promise<number> {
    for (const row of rows) {
      const key = `${row.source}|${row.sourceListingId}`;
      this.rows.set(key, { ...row });
    }
    return rows.length;
  }

  size(): number {
    return this.rows.size;
  }

  list(): RawPriceObservation[] {
    return [...this.rows.values()].sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      return a.sourceListingId.localeCompare(b.sourceListingId);
    });
  }
}
