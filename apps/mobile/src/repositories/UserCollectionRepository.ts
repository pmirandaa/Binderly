// UserCollectionRepository — typed facade over the `user_collection_item`
// local SQLite table.
//
// All reads return camelCase row objects. All writes:
//  1. Set `sync_status` to the appropriate `pending_*` value.
//  2. Emit a `LocalWriteEvent` to all registered observers.
//
// T-OF-QUEUE subscribes via `onLocalWrite()` to enqueue mutations for
// eventual server sync. After the server confirms a write, T-OF-QUEUE
// calls `markSynced(id, syncedAt)` to flip `sync_status` back to
// `'synced'`.
//
// The `upsert` method also writes a `printing_lite` row as a side-effect
// so that the card thumbnail is available offline even if the server
// catalog hasn't been refreshed. Callers that don't have printing metadata
// (e.g. importing from the server sync path) can pass `null` for
// `printingLite` to skip this side-effect.

import { getDb } from '../db/index.js';

import type {
  LocalWriteEvent,
  PrintingLite,
  UpdateUserCollectionItemInput,
  UpsertPrintingLiteInput,
  UpsertUserCollectionItemInput,
  UserCollectionItem,
} from './types.js';

type Observer = (event: LocalWriteEvent<UserCollectionItem>) => void;

// Raw DB row shape (snake_case, as SQLite returns it)
interface RawRow {
  id: string;
  user_id: string;
  printing_id: string;
  quantity: number;
  condition: string;
  grade_company: string | null;
  grade: string | null;
  acquired_at: string | null;
  acquired_price: string | null;
  acquired_currency: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  sync_status: string;
}

function rowToEntity(row: RawRow): UserCollectionItem {
  return {
    id: row.id,
    userId: row.user_id,
    printingId: row.printing_id,
    quantity: row.quantity,
    condition: row.condition,
    gradeCompany: row.grade_company,
    grade: row.grade,
    acquiredAt: row.acquired_at,
    acquiredPrice: row.acquired_price,
    acquiredCurrency: row.acquired_currency,
    notes: row.notes,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    syncStatus: row.sync_status as UserCollectionItem['syncStatus'],
  };
}

class UserCollectionRepositoryImpl {
  private readonly observers = new Set<Observer>();

  private emit(event: LocalWriteEvent<UserCollectionItem>): void {
    for (const observer of this.observers) {
      observer(event);
    }
  }

  onLocalWrite(observer: Observer): () => void {
    this.observers.add(observer);
    return (): void => {
      this.observers.delete(observer);
    };
  }

  async findAll(userId: string): Promise<UserCollectionItem[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM user_collection_item WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(rowToEntity);
  }

  async findById(id: string): Promise<UserCollectionItem | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM user_collection_item WHERE id = ?`,
      [id],
    );
    return row !== null ? rowToEntity(row) : null;
  }

  async findByPrintingId(userId: string, printingId: string): Promise<UserCollectionItem[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM user_collection_item WHERE user_id = ? AND printing_id = ?`,
      [userId, printingId],
    );
    return rows.map(rowToEntity);
  }

  async findPending(): Promise<UserCollectionItem[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM user_collection_item WHERE sync_status != 'synced' ORDER BY updated_at ASC`,
    );
    return rows.map(rowToEntity);
  }

  async upsert(
    input: UpsertUserCollectionItemInput,
    printingLite?: UpsertPrintingLiteInput | null,
  ): Promise<UserCollectionItem> {
    const db = await getDb();
    const now = input.updatedAt;
    const syncStatus = input.syncStatus ?? 'pending_create';

    await db.runAsync(
      `INSERT OR REPLACE INTO user_collection_item (
        id, user_id, printing_id, quantity, condition,
        grade_company, grade, acquired_at, acquired_price,
        acquired_currency, notes, source, created_at, updated_at,
        synced_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.printingId,
        input.quantity ?? 1,
        input.condition ?? 'NEAR_MINT',
        input.gradeCompany ?? null,
        input.grade ?? null,
        input.acquiredAt ?? null,
        input.acquiredPrice ?? null,
        input.acquiredCurrency ?? null,
        input.notes ?? null,
        input.source ?? 'manual',
        input.createdAt,
        now,
        null,
        syncStatus,
      ],
    );

    if (printingLite != null) {
      await this.upsertPrintingLite(db, printingLite);
    }

    const entity = (await this.findById(input.id))!;

    this.emit({
      type: 'created',
      table: 'user_collection_item',
      payload: entity,
      timestamp: now,
    });

    return entity;
  }

  async update(
    id: string,
    patch: UpdateUserCollectionItemInput,
  ): Promise<UserCollectionItem | null> {
    const db = await getDb();
    const existing = await this.findById(id);
    if (existing === null) return null;

    await db.runAsync(
      `UPDATE user_collection_item SET
        quantity          = COALESCE(?, quantity),
        condition         = COALESCE(?, condition),
        grade_company     = ?,
        grade             = ?,
        acquired_at       = ?,
        acquired_price    = ?,
        acquired_currency = ?,
        notes             = ?,
        updated_at        = ?,
        sync_status       = 'pending_update'
      WHERE id = ?`,
      [
        patch.quantity ?? null,
        patch.condition ?? null,
        'gradeCompany' in patch ? (patch.gradeCompany ?? null) : existing.gradeCompany,
        'grade' in patch ? (patch.grade ?? null) : existing.grade,
        'acquiredAt' in patch ? (patch.acquiredAt ?? null) : existing.acquiredAt,
        'acquiredPrice' in patch ? (patch.acquiredPrice ?? null) : existing.acquiredPrice,
        'acquiredCurrency' in patch
          ? (patch.acquiredCurrency ?? null)
          : existing.acquiredCurrency,
        'notes' in patch ? (patch.notes ?? null) : existing.notes,
        patch.updatedAt,
        id,
      ],
    );

    const entity = (await this.findById(id))!;
    this.emit({
      type: 'updated',
      table: 'user_collection_item',
      payload: entity,
      timestamp: patch.updatedAt,
    });
    return entity;
  }

  async remove(id: string): Promise<void> {
    const db = await getDb();
    const existing = await this.findById(id);
    if (existing === null) return;

    const now = new Date().toISOString();

    // For local-only rows (pending_create) just delete immediately.
    if (existing.syncStatus === 'pending_create') {
      await db.runAsync(`DELETE FROM user_collection_item WHERE id = ?`, [id]);
      this.emit({
        type: 'deleted',
        table: 'user_collection_item',
        payload: { ...existing, syncStatus: 'pending_delete' },
        timestamp: now,
      });
      return;
    }

    // For synced or pending_update rows, mark for deletion so T-OF-QUEUE
    // can send the DELETE to the server before purging locally.
    await db.runAsync(
      `UPDATE user_collection_item SET sync_status = 'pending_delete', updated_at = ? WHERE id = ?`,
      [now, id],
    );

    const entity = (await this.findById(id))!;
    this.emit({
      type: 'deleted',
      table: 'user_collection_item',
      payload: entity,
      timestamp: now,
    });
  }

  async markSynced(id: string, syncedAt: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE user_collection_item SET sync_status = 'synced', synced_at = ? WHERE id = ?`,
      [syncedAt, id],
    );
  }

  async findAllPrintingLite(): Promise<PrintingLite[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: string;
      variant_key: string;
      card_name: string;
      set_name: string;
      set_code: string;
      image_small_url: string | null;
      last_seen_at: string;
    }>(`SELECT * FROM printing_lite ORDER BY last_seen_at DESC`);
    return rows.map((r) => ({
      id: r.id,
      variantKey: r.variant_key,
      cardName: r.card_name,
      setName: r.set_name,
      setCode: r.set_code,
      imageSmallUrl: r.image_small_url,
      lastSeenAt: r.last_seen_at,
    }));
  }

  private async upsertPrintingLite(
    db: Awaited<ReturnType<typeof getDb>>,
    input: UpsertPrintingLiteInput,
  ): Promise<void> {
    await db.runAsync(
      `INSERT OR REPLACE INTO printing_lite (
        id, variant_key, card_name, set_name, set_code, image_small_url, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.variantKey,
        input.cardName,
        input.setName,
        input.setCode,
        input.imageSmallUrl ?? null,
        input.lastSeenAt,
      ],
    );
  }
}

export const userCollectionRepo = new UserCollectionRepositoryImpl();
export type { UserCollectionRepositoryImpl };
