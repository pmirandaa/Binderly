// `ConflictLogRepo` — narrow persistence boundary over the
// `data_conflict` table for the resolver.
//
// The resolver
// (`data-pipeline/src/resolver/resolver.ts`) emits in-memory
// `DataConflict` records when a validation source disagrees with the
// primary on a field beyond the configured tolerance. The seed
// reporter has historically only counted those conflicts. This module
// adds the persistence path: tests inject `InMemoryConflictLogRepo`,
// production wires `DrizzleConflictLogRepo` from
// `data-pipeline/scripts/seed.ts`.
//
// Idempotency contract: implementations MUST treat
// `(entityKind, entityCanonicalKey, fieldName)` as the conflict
// target. Re-running `upsertMany` with the same triple bumps
// `dispute_count` and refreshes `last_seen_at` / `sources` /
// `keptValue` / `resolution` instead of inserting a duplicate row.
// The Drizzle production impl issues the canonical
// `onConflictDoUpdate` recipe documented in the task file
// (`tasks/01-data-layer/T-DL-DATA-CONFLICT-TABLE.md` § Approach >
// `ConflictLogRepo` interface).
//
// `dataConflictFromResolverConflict()` adapts the resolver's
// in-memory `DataConflict` to the persisted `RawDataConflict`
// shape. Two emission flavors map cleanly:
//
//   1. The standard "primary won" conflict: a validation source
//      disagreed; the resolver kept the primary's value. We map
//      `chosenSource` → `resolution: 'kept_<chosenSource>'` and
//      `chosenValue` → `keptValue`.
//   2. The `__presence` conflict (resolver.ts ~line 297 + ~line
//      591): a non-primary source emitted a record the primary
//      did not. `chosenValue` is `null` and `chosenSource` is the
//      string `'primary'`; we map this to `resolution:
//      'unresolved'` so the audit verb reflects "no value won, the
//      conflict still stands".

import { sql } from 'drizzle-orm';

import { dataConflictTable, type DbClient } from '@binderly/db';

import type { DataConflict } from '../types.js';

// ============================================================
// Public types
// ============================================================

/**
 * Pre-persistence shape of a row destined for `data_conflict`.
 * Pure data; no DB-side defaults are baked in here. The repo's
 * Drizzle impl translates these to `NewDataConflictRow`s and lets
 * Postgres fill `id` / `created_at` / `updated_at`.
 */
export interface RawDataConflict {
  /** The kind of entity the conflict pertains to. */
  readonly entityKind: 'set' | 'card' | 'printing';
  /**
   * The canonical key of the entity the conflict was raised on.
   * Intentionally not a foreign key (sources may flag conflicts
   * before the entity exists in the catalog).
   */
  readonly entityCanonicalKey: string;
  /**
   * The field whose values the sources disagreed on. Examples:
   * `'name'`, `'hp'`, `'rarityRaw'`, `'__presence'`.
   */
  readonly fieldName: string;
  /** Per-source value map; mirrors the resolver's in-memory shape. */
  readonly sources: Record<string, unknown>;
  /** The value the resolver kept (typically the primary's). */
  readonly keptValue: unknown;
  /**
   * Audit verb describing how the conflict was resolved. Standard
   * cases: `kept_<sourceName>` (primary won) or `'unresolved'`
   * (no value won, e.g. the `__presence` flavor). The future
   * manual-override workflow will additionally write
   * `'manual_override'` rows.
   */
  readonly resolution: string;
  /** The instant the conflict was observed (UTC). */
  readonly lastSeenAt: Date;
}

/**
 * The persistence boundary. Tests inject
 * `InMemoryConflictLogRepo`; production wires
 * `DrizzleConflictLogRepo` (or the no-op repo when conflict
 * logging isn't desired). Implementations MUST upsert on
 * `(entityKind, entityCanonicalKey, fieldName)`.
 */
export interface ConflictLogRepo {
  /**
   * Upsert a batch of conflicts. Returns the number of input rows
   * processed (so callers can run-report account). Empty inputs
   * are a no-op (return 0).
   */
  upsertMany(rows: ReadonlyArray<RawDataConflict>): Promise<number>;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Adapt a resolver-emitted in-memory `DataConflict` to the
 * persisted `RawDataConflict` shape. Pure; no I/O.
 *
 * The `now` argument lets tests pin the timestamp deterministically.
 * Production callers can omit it for `new Date()`.
 */
export function dataConflictFromResolverConflict(
  c: DataConflict,
  now: () => Date = () => new Date(),
): RawDataConflict {
  // The `__presence` conflict shape (resolver.ts ~line 297 + ~line
  // 591) carries `chosenValue: null` and `chosenSource: 'primary'`
  // — it means "a non-primary source emitted a record the primary
  // did not"; nobody won, so the audit verb is `'unresolved'`.
  const isPresence = c.field === '__presence';
  const resolution = isPresence ? 'unresolved' : `kept_${c.chosenSource}`;
  return {
    entityKind: c.entity,
    entityCanonicalKey: c.entityKey,
    fieldName: c.field,
    sources: { ...c.sources },
    keptValue: c.chosenValue,
    resolution,
    lastSeenAt: now(),
  };
}

// ============================================================
// In-memory implementation (tests + dry-run)
// ============================================================

/**
 * `Map`-backed `ConflictLogRepo`. Keys on the canonical
 * `(entityKind|entityCanonicalKey|fieldName)` triple — same
 * posture as `InMemoryPriceAggregateRepo`. Re-running
 * `upsertMany` against the same triple bumps `disputeCount`
 * and refreshes the other columns to the latest values.
 *
 * Test-only helpers:
 *   - `size()` — number of distinct conflicts persisted.
 *   - `list()` — sorted list of stored rows for assertion ergonomics.
 */
export interface InMemoryConflictRow extends RawDataConflict {
  readonly disputeCount: number;
}

export class InMemoryConflictLogRepo implements ConflictLogRepo {
  readonly rows = new Map<string, InMemoryConflictRow>();

  async upsertMany(rows: ReadonlyArray<RawDataConflict>): Promise<number> {
    if (rows.length === 0) return 0;
    for (const row of rows) {
      const key = makeKey(row);
      const existing = this.rows.get(key);
      if (existing) {
        this.rows.set(key, {
          ...row,
          disputeCount: existing.disputeCount + 1,
        });
      } else {
        this.rows.set(key, { ...row, disputeCount: 1 });
      }
    }
    return rows.length;
  }

  size(): number {
    return this.rows.size;
  }

  list(): ReadonlyArray<InMemoryConflictRow> {
    return [...this.rows.values()].sort((a, b) => {
      if (a.entityKind !== b.entityKind) return a.entityKind.localeCompare(b.entityKind);
      if (a.entityCanonicalKey !== b.entityCanonicalKey)
        return a.entityCanonicalKey.localeCompare(b.entityCanonicalKey);
      return a.fieldName.localeCompare(b.fieldName);
    });
  }
}

// ============================================================
// Drizzle implementation (production)
// ============================================================

/**
 * `DrizzleConflictLogRepo` — production impl over the
 * `data_conflict` table. Mirrors the
 * `InMemoryPriceAggregateRepo` ↔ Drizzle pricing-rollup repo
 * pattern: a single `INSERT … ON CONFLICT (entity_kind,
 * entity_canonical_key, field_name) DO UPDATE` round trip per
 * batch.
 *
 * The `dispute_count` increment uses
 * `data_conflict.dispute_count + 1` (the existing row's value)
 * rather than `excluded.dispute_count` so re-runs always step by
 * one regardless of the input row's value. This means callers
 * always pass `dispute_count = 1` (the schema default) and the DB
 * does the bookkeeping; we don't expose a `disputeCount` field on
 * `RawDataConflict` to keep the input shape minimal.
 */
export class DrizzleConflictLogRepo implements ConflictLogRepo {
  constructor(private readonly db: DbClient) {}

  async upsertMany(rows: ReadonlyArray<RawDataConflict>): Promise<number> {
    if (rows.length === 0) return 0;
    const values = rows.map((r) => ({
      entityKind: r.entityKind,
      entityCanonicalKey: r.entityCanonicalKey,
      fieldName: r.fieldName,
      sources: r.sources,
      keptValue: r.keptValue,
      resolution: r.resolution,
      lastSeenAt: r.lastSeenAt,
    }));
    await this.db
      .insert(dataConflictTable)
      .values(values)
      .onConflictDoUpdate({
        target: [
          dataConflictTable.entityKind,
          dataConflictTable.entityCanonicalKey,
          dataConflictTable.fieldName,
        ],
        set: {
          sources: sql`excluded.sources`,
          keptValue: sql`excluded.kept_value`,
          resolution: sql`excluded.resolution`,
          lastSeenAt: sql`excluded.last_seen_at`,
          disputeCount: sql`${dataConflictTable.disputeCount} + 1`,
          updatedAt: sql`now()`,
        },
      });
    return rows.length;
  }
}

// ============================================================
// Internals
// ============================================================

function makeKey(row: RawDataConflict): string {
  return `${row.entityKind}|${row.entityCanonicalKey}|${row.fieldName}`;
}
