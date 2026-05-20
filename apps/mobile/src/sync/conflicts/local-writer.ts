// local-writer.ts — direct-to-SQLite writes for server-wins overwrites
// and server-won-deleted purges.
//
// Why bypass the typed repository facades?
//
// The 3 repositories (UserCollectionRepository, CustomCollectionRepository,
// SmartCollectionRepository) emit `LocalWriteEvent` on every write,
// which T-OF-QUEUE listens for and enqueues. If the resolver called
// them, the act of overwriting the local row with server state would
// itself be enqueued as a *new* mutation, which would dead-letter
// again, in an infinite loop.
//
// The resolver therefore writes through `getDb()` directly with INSERT
// OR REPLACE / DELETE statements. The next read from the repository
// layer sees the updated rows; the `LocalWriteEvent` channel stays
// silent (correct — server state is, by definition, already-synced).
//
// Field mappings exactly match the schema in
// `apps/mobile/src/db/schema.ts` and the repository row shapes. The
// server payload arrives as a DTO from `@binderly/api-contracts` whose
// field names are the camelCase wire names — we adapt them to the
// snake_case SQLite columns inline.

import { getDb } from '../../db/index.js';

import type { QueueTableName } from '../queue/types.js';

interface CollectionItemServerPayload {
  id: string;
  userId: string;
  printingId: string;
  quantity: number;
  condition: string;
  gradeCompany: string | null;
  grade: string | null;
  acquiredAt: string | null;
  acquiredPrice: string | null;
  acquiredCurrency: string | null;
  notes: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface CustomCollectionServerPayload {
  id: string;
  userId: string;
  kind: string;
  name: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomCollectionItemServerPayload {
  customCollectionId: string;
  printingId: string;
  addedAt: string;
}

interface SmartCollectionServerPayload extends CustomCollectionServerPayload {
  /** Optional — when the resolver also fetched the rule. */
  expression?: unknown;
}

/**
 * Apply a server-wins overwrite for one entity. The caller must
 * already have verified that the server state is strictly newer (or
 * tied) — this writer does no LWW logic, it just executes the write.
 *
 * Wrapped in a SQLite transaction so a half-apply on crash is
 * impossible. The transaction also folds in the sync_conflict_log
 * write the caller does separately (the resolver opens the
 * transaction at the higher level — `applyServerWins` re-uses the
 * existing transaction context implicitly because expo-sqlite's
 * `runAsync` runs inside the surrounding `withTransactionAsync`).
 */
export async function applyServerWins(
  tableName: QueueTableName,
  serverPayload: unknown,
): Promise<void> {
  const db = await getDb();

  switch (tableName) {
    case 'user_collection_item': {
      const p = serverPayload as CollectionItemServerPayload;
      await db.runAsync(
        `INSERT OR REPLACE INTO user_collection_item (
          id, user_id, printing_id, quantity, condition,
          grade_company, grade, acquired_at, acquired_price,
          acquired_currency, notes, source, created_at, updated_at,
          synced_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [
          p.id,
          p.userId,
          p.printingId,
          p.quantity,
          p.condition,
          p.gradeCompany,
          p.grade !== null ? String(p.grade) : null,
          p.acquiredAt,
          p.acquiredPrice !== null ? String(p.acquiredPrice) : null,
          p.acquiredCurrency,
          p.notes,
          p.source,
          p.createdAt,
          p.updatedAt,
          p.updatedAt,
        ],
      );
      return;
    }

    case 'custom_collection': {
      const p = serverPayload as CustomCollectionServerPayload;
      await db.runAsync(
        `INSERT OR REPLACE INTO custom_collection (
          id, user_id, name, slug, description, cover_url,
          created_at, updated_at, synced_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [
          p.id,
          p.userId,
          p.name,
          p.slug,
          p.description,
          p.coverUrl,
          p.createdAt,
          p.updatedAt,
          p.updatedAt,
        ],
      );
      return;
    }

    case 'smart_collection': {
      const p = serverPayload as SmartCollectionServerPayload;
      // Smart collections carry their DSL expression separately; if the
      // server didn't include one (resolver only fetched the parent),
      // preserve whatever expression is already locally cached. The
      // expression is non-null on the schema; if there's no existing
      // row, default to an empty `all` expression as a placeholder
      // until the rule fetcher catches up.
      const existing = await db.getFirstAsync<{ expression: string }>(
        `SELECT expression FROM smart_collection WHERE id = ?`,
        [p.id],
      );
      const existingExpression = existing?.expression ?? null;
      const expressionString =
        p.expression !== undefined
          ? JSON.stringify(p.expression)
          : existingExpression ?? JSON.stringify({ type: 'all' });
      await db.runAsync(
        `INSERT OR REPLACE INTO smart_collection (
          id, user_id, name, slug, description, expression,
          last_evaluated_at, cached_count,
          created_at, updated_at, synced_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'synced')`,
        [
          p.id,
          p.userId,
          p.name,
          p.slug,
          p.description,
          expressionString,
          p.createdAt,
          p.updatedAt,
          p.updatedAt,
        ],
      );
      return;
    }

    case 'custom_collection_item': {
      const p = serverPayload as CustomCollectionItemServerPayload;
      // Membership rows have no sync_status — INSERT OR REPLACE
      // (same as the repo's addItem path) is the correct upsert.
      await db.runAsync(
        `INSERT OR REPLACE INTO custom_collection_item
          (custom_collection_id, printing_id, added_at)
         VALUES (?, ?, ?)`,
        [p.customCollectionId, p.printingId, p.addedAt],
      );
      return;
    }
  }
}

/**
 * Apply a server-wins-deleted purge. Used when the server returned
 * 404 for an `updated` or `deleted` op (the server-side row is already
 * gone; the local-pending edit / delete is moot).
 *
 * For the 3 entity tables we hard-delete the local row. For
 * `custom_collection_item` we also hard-delete the membership row.
 * For `user_collection_item`, this also lets any cascade rules and
 * `printing_lite` references update naturally on next refresh.
 */
export async function applyServerWonDeleted(
  tableName: QueueTableName,
  entityId: string,
  /** Only used for `custom_collection_item`. */
  printingId: string | null = null,
): Promise<void> {
  const db = await getDb();

  switch (tableName) {
    case 'user_collection_item':
      await db.runAsync(`DELETE FROM user_collection_item WHERE id = ?`, [entityId]);
      return;
    case 'custom_collection':
      await db.runAsync(`DELETE FROM custom_collection WHERE id = ?`, [entityId]);
      return;
    case 'smart_collection':
      await db.runAsync(`DELETE FROM smart_collection WHERE id = ?`, [entityId]);
      return;
    case 'custom_collection_item':
      if (printingId !== null) {
        await db.runAsync(
          `DELETE FROM custom_collection_item
           WHERE custom_collection_id = ? AND printing_id = ?`,
          [entityId, printingId],
        );
      }
      return;
  }
}
