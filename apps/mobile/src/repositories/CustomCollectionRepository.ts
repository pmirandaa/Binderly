// CustomCollectionRepository — typed facade over `custom_collection` and
// `custom_collection_item` local SQLite tables.
//
// Manual collections only — smart collections live in SmartCollectionRepository.
// This mirrors server's `custom_collection (kind='manual')`.

import { getDb } from '../db/index.js';

import type {
  CreateCustomCollectionInput,
  CustomCollection,
  CustomCollectionItem,
  LocalWriteEvent,
  UpdateCustomCollectionInput,
} from './types.js';

type Observer = (event: LocalWriteEvent<CustomCollection | CustomCollectionItem>) => void;

interface RawCollectionRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  sync_status: string;
}

interface RawItemRow {
  custom_collection_id: string;
  printing_id: string;
  added_at: string;
}

function rowToCollection(row: RawCollectionRow): CustomCollection {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    coverUrl: row.cover_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    syncStatus: row.sync_status as CustomCollection['syncStatus'],
  };
}

function rowToItem(row: RawItemRow): CustomCollectionItem {
  return {
    customCollectionId: row.custom_collection_id,
    printingId: row.printing_id,
    addedAt: row.added_at,
  };
}

class CustomCollectionRepositoryImpl {
  private readonly observers = new Set<Observer>();

  private emit(event: LocalWriteEvent<CustomCollection | CustomCollectionItem>): void {
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

  // ---- Collection reads ----

  async findAll(userId: string): Promise<CustomCollection[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawCollectionRow>(
      `SELECT * FROM custom_collection WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(rowToCollection);
  }

  async findById(id: string): Promise<CustomCollection | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawCollectionRow>(
      `SELECT * FROM custom_collection WHERE id = ?`,
      [id],
    );
    return row !== null ? rowToCollection(row) : null;
  }

  async findBySlug(userId: string, slug: string): Promise<CustomCollection | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawCollectionRow>(
      `SELECT * FROM custom_collection WHERE user_id = ? AND slug = ?`,
      [userId, slug],
    );
    return row !== null ? rowToCollection(row) : null;
  }

  async findPending(): Promise<CustomCollection[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawCollectionRow>(
      `SELECT * FROM custom_collection WHERE sync_status != 'synced' ORDER BY updated_at ASC`,
    );
    return rows.map(rowToCollection);
  }

  // ---- Collection writes ----

  async create(input: CreateCustomCollectionInput): Promise<CustomCollection> {
    const db = await getDb();
    const syncStatus = input.syncStatus ?? 'pending_create';

    await db.runAsync(
      `INSERT INTO custom_collection (
        id, user_id, name, slug, description, cover_url,
        created_at, updated_at, synced_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.name,
        input.slug,
        input.description ?? null,
        input.coverUrl ?? null,
        input.createdAt,
        input.updatedAt,
        null,
        syncStatus,
      ],
    );

    const entity = (await this.findById(input.id))!;
    this.emit({
      type: 'created',
      table: 'custom_collection',
      payload: entity,
      timestamp: input.updatedAt,
    });
    return entity;
  }

  async update(id: string, patch: UpdateCustomCollectionInput): Promise<CustomCollection | null> {
    const db = await getDb();
    const existing = await this.findById(id);
    if (existing === null) return null;

    await db.runAsync(
      `UPDATE custom_collection SET
        name        = COALESCE(?, name),
        slug        = COALESCE(?, slug),
        description = ?,
        cover_url   = ?,
        updated_at  = ?,
        sync_status = 'pending_update'
      WHERE id = ?`,
      [
        patch.name ?? null,
        patch.slug ?? null,
        'description' in patch ? (patch.description ?? null) : existing.description,
        'coverUrl' in patch ? (patch.coverUrl ?? null) : existing.coverUrl,
        patch.updatedAt,
        id,
      ],
    );

    const entity = (await this.findById(id))!;
    this.emit({
      type: 'updated',
      table: 'custom_collection',
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
      await db.runAsync(`DELETE FROM custom_collection WHERE id = ?`, [id]);
      this.emit({
        type: 'deleted',
        table: 'custom_collection',
        payload: { ...existing, syncStatus: 'pending_delete' as const },
        timestamp: now,
      });
      return;
    }

    await db.runAsync(
      `UPDATE custom_collection SET sync_status = 'pending_delete', updated_at = ? WHERE id = ?`,
      [now, id],
    );

    const entity = (await this.findById(id))!;
    this.emit({
      type: 'deleted',
      table: 'custom_collection',
      payload: entity,
      timestamp: now,
    });
  }

  async markSynced(id: string, syncedAt: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE custom_collection SET sync_status = 'synced', synced_at = ? WHERE id = ?`,
      [syncedAt, id],
    );
  }

  // ---- Item reads ----

  async getItems(collectionId: string): Promise<CustomCollectionItem[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawItemRow>(
      `SELECT * FROM custom_collection_item WHERE custom_collection_id = ? ORDER BY added_at DESC`,
      [collectionId],
    );
    return rows.map(rowToItem);
  }

  // ---- Item writes ----

  async addItem(collectionId: string, printingId: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db.runAsync(
      `INSERT OR IGNORE INTO custom_collection_item
        (custom_collection_id, printing_id, added_at)
       VALUES (?, ?, ?)`,
      [collectionId, printingId, now],
    );

    const item = await db.getFirstAsync<RawItemRow>(
      `SELECT * FROM custom_collection_item WHERE custom_collection_id = ? AND printing_id = ?`,
      [collectionId, printingId],
    );

    if (item !== null) {
      this.emit({
        type: 'created',
        table: 'custom_collection_item',
        payload: rowToItem(item),
        timestamp: now,
      });
    }
  }

  async removeItem(collectionId: string, printingId: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    const existing = await db.getFirstAsync<RawItemRow>(
      `SELECT * FROM custom_collection_item WHERE custom_collection_id = ? AND printing_id = ?`,
      [collectionId, printingId],
    );

    if (existing === null) return;

    await db.runAsync(
      `DELETE FROM custom_collection_item WHERE custom_collection_id = ? AND printing_id = ?`,
      [collectionId, printingId],
    );

    this.emit({
      type: 'deleted',
      table: 'custom_collection_item',
      payload: rowToItem(existing),
      timestamp: now,
    });
  }
}

export const customCollectionRepo = new CustomCollectionRepositoryImpl();
export type { CustomCollectionRepositoryImpl };
