// `CatalogWriter` — narrow contract over the catalog tables that the
// seed-ingest job uses. Production wires the Drizzle-backed
// `DrizzleCatalogWriter`; tests substitute `InMemoryCatalogWriter`.
//
// We keep the contract narrow so the per-stage modules can be unit-
// tested without spinning up Postgres. Idempotency is the contract:
// callers expect `upsertSet({canonicalKey: 'en-swsh9', ...})` to be
// safe under repeated calls and to return the same `id` each time.

import { sql } from 'drizzle-orm';

import {
  cardTable,
  printingTable,
  setTable,
  type DbClient,
  type NewCard,
  type NewPrinting,
  type NewSet,
} from '@binderly/db';

// ============================================================
// Public types
// ============================================================

/**
 * Row identifiers returned by the writer. Always carries the DB
 * `id` UUID; callers chain `set.id → card.setId → printing.cardId`.
 */
export interface WrittenRow {
  readonly id: string;
}

/**
 * Image URLs the seed-ingest job writes back onto `printing` after
 * the image pipeline runs. All optional — the pipeline may have
 * skipped (no URL / excluded source) or errored, in which case the
 * existing column values are preserved.
 */
export interface PrintingImageUrls {
  readonly imageSmallUrl?: string | null;
  readonly imageLargeUrl?: string | null;
  readonly imageSourceUrl?: string | null;
}

export interface CatalogWriter {
  /** Upsert a set by `canonical_key`; return the row id. */
  upsertSet(input: NewSet): Promise<WrittenRow>;
  /** Upsert a card by `canonical_key`; return the row id. */
  upsertCard(input: NewCard): Promise<WrittenRow>;
  /** Upsert a printing by `variant_key`; return the row id. */
  upsertPrinting(input: NewPrinting): Promise<WrittenRow>;
  /**
   * Patch a printing's image URLs after the image pipeline runs.
   * No-op when every URL field is `undefined`. Resolves once the
   * write commits.
   */
  updatePrintingImages(variantKey: string, urls: PrintingImageUrls): Promise<void>;
}

// ============================================================
// Drizzle implementation
// ============================================================

/**
 * Drizzle-backed `CatalogWriter`. Uses `INSERT … ON CONFLICT (...)
 * DO UPDATE … RETURNING id` to produce the row id in a single round
 * trip per upsert. The conflict targets are the canonical-key UNIQUE
 * indices on each table (see `packages/db/src/schema/`).
 *
 * `updated_at` is bumped on every conflict path; `created_at`
 * preserves the original row's timestamp.
 */
export class DrizzleCatalogWriter implements CatalogWriter {
  constructor(private readonly db: DbClient) {}

  async upsertSet(input: NewSet): Promise<WrittenRow> {
    const rows = await this.db
      .insert(setTable)
      .values(input)
      .onConflictDoUpdate({
        target: setTable.canonicalKey,
        set: {
          code: input.code,
          language: input.language,
          name: input.name,
          series: input.series ?? null,
          releaseDate: input.releaseDate,
          printedTotal: input.printedTotal ?? null,
          total: input.total ?? null,
          logoUrl: input.logoUrl ?? null,
          symbolUrl: input.symbolUrl ?? null,
          masterSetRules: input.masterSetRules ?? {},
          sourceMetadata: input.sourceMetadata ?? {},
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: setTable.id });
    return requireId(rows, 'set', input.canonicalKey);
  }

  async upsertCard(input: NewCard): Promise<WrittenRow> {
    const rows = await this.db
      .insert(cardTable)
      .values(input)
      .onConflictDoUpdate({
        target: cardTable.canonicalKey,
        set: {
          setId: input.setId,
          language: input.language,
          number: input.number,
          name: input.name,
          nameLocalized: input.nameLocalized ?? null,
          type: input.type ?? null,
          subtype: input.subtype ?? null,
          hp: input.hp ?? null,
          illustrator: input.illustrator ?? null,
          flavorText: input.flavorText ?? null,
          attacks: input.attacks ?? null,
          weakness: input.weakness ?? null,
          resistance: input.resistance ?? null,
          retreatCost: input.retreatCost ?? null,
          rarity: input.rarity ?? null,
          sourceMetadata: input.sourceMetadata ?? {},
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: cardTable.id });
    return requireId(rows, 'card', input.canonicalKey);
  }

  async upsertPrinting(input: NewPrinting): Promise<WrittenRow> {
    const rows = await this.db
      .insert(printingTable)
      .values(input)
      .onConflictDoUpdate({
        target: printingTable.variantKey,
        set: {
          cardId: input.cardId,
          variantClass: input.variantClass,
          variantFlags: input.variantFlags ?? [],
          variantCode: input.variantCode,
          includeInMasterSet: input.includeInMasterSet,
          imageSmallUrl: input.imageSmallUrl ?? null,
          imageLargeUrl: input.imageLargeUrl ?? null,
          imageSourceUrl: input.imageSourceUrl ?? null,
          sourceMetadata: input.sourceMetadata ?? {},
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: printingTable.id });
    return requireId(rows, 'printing', input.variantKey);
  }

  async updatePrintingImages(variantKey: string, urls: PrintingImageUrls): Promise<void> {
    const patch: Partial<{
      imageSmallUrl: string | null;
      imageLargeUrl: string | null;
      imageSourceUrl: string | null;
      updatedAt: ReturnType<typeof sql>;
    }> = {};
    if (urls.imageSmallUrl !== undefined) patch.imageSmallUrl = urls.imageSmallUrl;
    if (urls.imageLargeUrl !== undefined) patch.imageLargeUrl = urls.imageLargeUrl;
    if (urls.imageSourceUrl !== undefined) patch.imageSourceUrl = urls.imageSourceUrl;
    if (Object.keys(patch).length === 0) return;
    patch.updatedAt = sql`now()`;
    await this.db
      .update(printingTable)
      .set(patch)
      .where(sql`${printingTable.variantKey} = ${variantKey}`);
  }
}

// ============================================================
// In-memory implementation (tests)
// ============================================================

/**
 * `InMemoryCatalogWriter` — `Map`-backed fake. Used by every unit
 * test in this folder; equally suitable for the future `--dry-run`
 * mode (the dry-run code path swaps this in).
 *
 * The writer assigns deterministic synthetic IDs (`set-0001`,
 * `card-0001`, `printing-0001`, …) so tests can assert structural
 * equality without UUID jitter.
 */
export class InMemoryCatalogWriter implements CatalogWriter {
  readonly sets: Map<string, NewSet & WrittenRow> = new Map();
  readonly cards: Map<string, NewCard & WrittenRow> = new Map();
  readonly printings: Map<string, NewPrinting & WrittenRow & PrintingImageUrls> = new Map();
  readonly upsertCounts = { set: 0, card: 0, printing: 0, imagePatch: 0 };
  private nextSetId = 0;
  private nextCardId = 0;
  private nextPrintingId = 0;

  async upsertSet(input: NewSet): Promise<WrittenRow> {
    this.upsertCounts.set += 1;
    const existing = this.sets.get(input.canonicalKey);
    const id = existing?.id ?? this.assignId('set');
    const row: NewSet & WrittenRow = { ...input, id };
    this.sets.set(input.canonicalKey, row);
    return { id };
  }

  async upsertCard(input: NewCard): Promise<WrittenRow> {
    this.upsertCounts.card += 1;
    const existing = this.cards.get(input.canonicalKey);
    const id = existing?.id ?? this.assignId('card');
    const row: NewCard & WrittenRow = { ...input, id };
    this.cards.set(input.canonicalKey, row);
    return { id };
  }

  async upsertPrinting(input: NewPrinting): Promise<WrittenRow> {
    this.upsertCounts.printing += 1;
    const existing = this.printings.get(input.variantKey);
    const id = existing?.id ?? this.assignId('printing');
    const row: NewPrinting & WrittenRow & PrintingImageUrls = {
      ...input,
      id,
      imageSmallUrl: existing?.imageSmallUrl ?? input.imageSmallUrl ?? null,
      imageLargeUrl: existing?.imageLargeUrl ?? input.imageLargeUrl ?? null,
      imageSourceUrl: existing?.imageSourceUrl ?? input.imageSourceUrl ?? null,
    };
    this.printings.set(input.variantKey, row);
    return { id };
  }

  async updatePrintingImages(variantKey: string, urls: PrintingImageUrls): Promise<void> {
    const existing = this.printings.get(variantKey);
    if (!existing) return;
    const patched: NewPrinting & WrittenRow & PrintingImageUrls = {
      ...existing,
      imageSmallUrl:
        urls.imageSmallUrl !== undefined ? urls.imageSmallUrl : (existing.imageSmallUrl ?? null),
      imageLargeUrl:
        urls.imageLargeUrl !== undefined ? urls.imageLargeUrl : (existing.imageLargeUrl ?? null),
      imageSourceUrl:
        urls.imageSourceUrl !== undefined ? urls.imageSourceUrl : (existing.imageSourceUrl ?? null),
    };
    this.printings.set(variantKey, patched);
    this.upsertCounts.imagePatch += 1;
  }

  private assignId(entity: 'set' | 'card' | 'printing'): string {
    if (entity === 'set') {
      this.nextSetId += 1;
      return `set-${this.nextSetId.toString(16).padStart(8, '0')}`;
    }
    if (entity === 'card') {
      this.nextCardId += 1;
      return `card-${this.nextCardId.toString(16).padStart(8, '0')}`;
    }
    this.nextPrintingId += 1;
    return `printing-${this.nextPrintingId.toString(16).padStart(8, '0')}`;
  }
}

// ============================================================
// Internals
// ============================================================

function requireId(
  rows: ReadonlyArray<{ id: string }>,
  entity: 'set' | 'card' | 'printing',
  key: string,
): WrittenRow {
  const row = rows[0];
  if (!row) {
    throw new Error(
      `db-upsert: insert into ${entity} returned no rows for canonical key ${JSON.stringify(key)}`,
    );
  }
  return { id: row.id };
}
