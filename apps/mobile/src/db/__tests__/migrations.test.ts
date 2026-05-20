// Migration tests.
//
// These tests exercise the schema creation + migration runner against the
// sql.js-backed in-memory SQLite fake wired up in `test-utils/setup.ts`.
// They verify:
//   - All tables and indexes are created correctly after `runMigrations`.
//   - The `_meta.schema_version` key is written.
//   - Re-running migrations is a no-op (idempotent).
//   - Every expected column exists in every table.

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTesting } from '../../db/index.js';
import { runMigrations } from '../../db/migrations/index.js';
import { CURRENT_SCHEMA_VERSION } from '../../db/schema.js';

async function getTestDb(): Promise<SQLiteDatabase> {
  return openDatabaseAsync('binderly.db') as unknown as SQLiteDatabase;
}

async function tableExists(db: SQLiteDatabase, tableName: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName],
  );
  return (row?.cnt ?? 0) > 0;
}

async function columnExists(
  db: SQLiteDatabase,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${tableName})`,
  );
  return rows.some((r) => r.name === columnName);
}

async function indexExists(db: SQLiteDatabase, indexName: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='index' AND name=?`,
    [indexName],
  );
  return (row?.cnt ?? 0) > 0;
}

describe('runMigrations', () => {
  beforeEach(async () => {
    await resetDbForTesting();
  });

  afterEach(async () => {
    await resetDbForTesting();
  });

  it('creates the _meta table', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await tableExists(db, '_meta')).toBe(true);
  });

  it('writes the schema_version to _meta', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM _meta WHERE key = 'schema_version'`,
    );
    expect(row).not.toBeNull();
    expect(parseInt(row!.value, 10)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('creates user_collection_item table', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await tableExists(db, 'user_collection_item')).toBe(true);
  });

  it('user_collection_item has expected columns', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    const expected = [
      'id', 'user_id', 'printing_id', 'quantity', 'condition',
      'grade_company', 'grade', 'acquired_at', 'acquired_price',
      'acquired_currency', 'notes', 'source', 'created_at', 'updated_at',
      'synced_at', 'sync_status',
    ];
    for (const col of expected) {
      expect(await columnExists(db, 'user_collection_item', col)).toBe(true);
    }
  });

  it('creates custom_collection table', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await tableExists(db, 'custom_collection')).toBe(true);
  });

  it('custom_collection has expected columns', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    const expected = [
      'id', 'user_id', 'name', 'slug', 'description',
      'cover_url', 'created_at', 'updated_at', 'synced_at', 'sync_status',
    ];
    for (const col of expected) {
      expect(await columnExists(db, 'custom_collection', col)).toBe(true);
    }
  });

  it('creates custom_collection_item table', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await tableExists(db, 'custom_collection_item')).toBe(true);
  });

  it('custom_collection_item has expected columns', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    const expected = ['custom_collection_id', 'printing_id', 'added_at'];
    for (const col of expected) {
      expect(await columnExists(db, 'custom_collection_item', col)).toBe(true);
    }
  });

  it('creates smart_collection table', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await tableExists(db, 'smart_collection')).toBe(true);
  });

  it('smart_collection has expected columns', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    const expected = [
      'id', 'user_id', 'name', 'slug', 'description', 'expression',
      'last_evaluated_at', 'cached_count', 'created_at', 'updated_at',
      'synced_at', 'sync_status',
    ];
    for (const col of expected) {
      expect(await columnExists(db, 'smart_collection', col)).toBe(true);
    }
  });

  it('creates printing_lite table', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await tableExists(db, 'printing_lite')).toBe(true);
  });

  it('printing_lite has expected columns', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    const expected = [
      'id', 'variant_key', 'card_name', 'set_name', 'set_code',
      'image_small_url', 'last_seen_at',
    ];
    for (const col of expected) {
      expect(await columnExists(db, 'printing_lite', col)).toBe(true);
    }
  });

  it('creates user_collection_item indexes', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await indexExists(db, 'uci_user_id_idx')).toBe(true);
    expect(await indexExists(db, 'uci_user_id_printing_id_idx')).toBe(true);
    expect(await indexExists(db, 'uci_sync_status_idx')).toBe(true);
  });

  it('creates custom_collection indexes', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await indexExists(db, 'cc_user_id_idx')).toBe(true);
    expect(await indexExists(db, 'cc_user_id_slug_idx')).toBe(true);
    expect(await indexExists(db, 'cc_sync_status_idx')).toBe(true);
  });

  it('creates smart_collection indexes', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    expect(await indexExists(db, 'sc_user_id_idx')).toBe(true);
    expect(await indexExists(db, 'sc_sync_status_idx')).toBe(true);
  });

  it('is idempotent — running migrations twice does not throw', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    await expect(runMigrations(db)).resolves.not.toThrow();
  });

  it('idempotent run does not change the schema_version', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    await runMigrations(db);
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM _meta WHERE key = 'schema_version'`,
    );
    expect(parseInt(row!.value, 10)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('tables are present after second migration call', async () => {
    const db = await getTestDb();
    await runMigrations(db);
    await runMigrations(db);
    expect(await tableExists(db, 'user_collection_item')).toBe(true);
    expect(await tableExists(db, 'custom_collection')).toBe(true);
    expect(await tableExists(db, 'smart_collection')).toBe(true);
  });
});
