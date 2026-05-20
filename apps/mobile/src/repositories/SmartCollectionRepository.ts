// SmartCollectionRepository — typed facade over the `smart_collection`
// local SQLite table.
//
// Smart collections merge `custom_collection (kind='smart')` and
// `smart_collection_rule` from the server schema into a single flat
// local table. The expression (DSL AST) is stored as a JSON string.
//
// `updateEvaluationCache` is called by the offline evaluation engine
// after running the DSL locally to cache the result count and timestamp.
// T-OF-QUEUE calls `markSynced` after the server confirms changes.

import { getDb } from '../db/index.js';

import type {
  CreateSmartCollectionInput,
  LocalWriteEvent,
  SmartCollection,
  UpdateSmartCollectionInput,
} from './types.js';

type Observer = (event: LocalWriteEvent<SmartCollection>) => void;

interface RawRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  expression: string;
  last_evaluated_at: string | null;
  cached_count: number | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  sync_status: string;
}

function rowToEntity(row: RawRow): SmartCollection {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    expression: row.expression,
    lastEvaluatedAt: row.last_evaluated_at,
    cachedCount: row.cached_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    syncStatus: row.sync_status as SmartCollection['syncStatus'],
  };
}

class SmartCollectionRepositoryImpl {
  private readonly observers = new Set<Observer>();

  private emit(event: LocalWriteEvent<SmartCollection>): void {
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

  async findAll(userId: string): Promise<SmartCollection[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM smart_collection WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(rowToEntity);
  }

  async findById(id: string): Promise<SmartCollection | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM smart_collection WHERE id = ?`,
      [id],
    );
    return row !== null ? rowToEntity(row) : null;
  }

  async findPending(): Promise<SmartCollection[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM smart_collection WHERE sync_status != 'synced' ORDER BY updated_at ASC`,
    );
    return rows.map(rowToEntity);
  }

  async create(input: CreateSmartCollectionInput): Promise<SmartCollection> {
    const db = await getDb();
    const syncStatus = input.syncStatus ?? 'pending_create';

    await db.runAsync(
      `INSERT INTO smart_collection (
        id, user_id, name, slug, description, expression,
        last_evaluated_at, cached_count,
        created_at, updated_at, synced_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.name,
        input.slug,
        input.description ?? null,
        input.expression,
        null,
        null,
        input.createdAt,
        input.updatedAt,
        null,
        syncStatus,
      ],
    );

    const entity = (await this.findById(input.id))!;
    this.emit({
      type: 'created',
      table: 'smart_collection',
      payload: entity,
      timestamp: input.updatedAt,
    });
    return entity;
  }

  async update(id: string, patch: UpdateSmartCollectionInput): Promise<SmartCollection | null> {
    const db = await getDb();
    const existing = await this.findById(id);
    if (existing === null) return null;

    await db.runAsync(
      `UPDATE smart_collection SET
        name        = COALESCE(?, name),
        slug        = COALESCE(?, slug),
        description = ?,
        expression  = COALESCE(?, expression),
        updated_at  = ?,
        sync_status = 'pending_update'
      WHERE id = ?`,
      [
        patch.name ?? null,
        patch.slug ?? null,
        'description' in patch ? (patch.description ?? null) : existing.description,
        patch.expression ?? null,
        patch.updatedAt,
        id,
      ],
    );

    const entity = (await this.findById(id))!;
    this.emit({
      type: 'updated',
      table: 'smart_collection',
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

    if (existing.syncStatus === 'pending_create') {
      await db.runAsync(`DELETE FROM smart_collection WHERE id = ?`, [id]);
      this.emit({
        type: 'deleted',
        table: 'smart_collection',
        payload: { ...existing, syncStatus: 'pending_delete' as const },
        timestamp: now,
      });
      return;
    }

    await db.runAsync(
      `UPDATE smart_collection SET sync_status = 'pending_delete', updated_at = ? WHERE id = ?`,
      [now, id],
    );

    const entity = (await this.findById(id))!;
    this.emit({
      type: 'deleted',
      table: 'smart_collection',
      payload: entity,
      timestamp: now,
    });
  }

  async markSynced(id: string, syncedAt: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE smart_collection SET sync_status = 'synced', synced_at = ? WHERE id = ?`,
      [syncedAt, id],
    );
  }

  async updateEvaluationCache(
    id: string,
    cachedCount: number,
    evaluatedAt: string,
  ): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE smart_collection SET last_evaluated_at = ?, cached_count = ? WHERE id = ?`,
      [evaluatedAt, cachedCount, id],
    );
  }
}

export const smartCollectionRepo = new SmartCollectionRepositoryImpl();
export type { SmartCollectionRepositoryImpl };
