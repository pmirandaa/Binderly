// migration-v3.test.ts — v3 migration applies cleanly + idempotently.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTesting } from '../../../db/connection.js';
import { getDb } from '../../../db/index.js';
import { CURRENT_SCHEMA_VERSION } from '../../../db/schema.js';
import { __resetSqliteDbs } from '../../../test-utils/setup.js';

beforeEach(async () => {
  await resetDbForTesting();
  __resetSqliteDbs();
});
afterEach(async () => {
  await resetDbForTesting();
  __resetSqliteDbs();
});

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is bumped to 3 for T-OF-CONFLICTS', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });
});

describe('migration v3 — sync_conflict_log creation', () => {
  it('creates the sync_conflict_log table on a fresh DB', async () => {
    const db = await getDb();
    const rows = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_conflict_log'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('records schema_version = 3 in _meta', async () => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM _meta WHERE key = 'schema_version'`,
    );
    expect(row?.value).toBe('3');
  });

  it('keeps v1 + v2 tables intact alongside v3', async () => {
    const db = await getDb();
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const names = tables.map((t) => t.name);
    // v1 tables
    expect(names).toContain('user_collection_item');
    expect(names).toContain('custom_collection');
    expect(names).toContain('custom_collection_item');
    expect(names).toContain('smart_collection');
    expect(names).toContain('printing_lite');
    // v2 tables
    expect(names).toContain('sync_queue');
    // v3 tables
    expect(names).toContain('sync_conflict_log');
  });

  it('sync_conflict_log has the documented columns', async () => {
    const db = await getDb();
    const cols = await db.getAllAsync<{ name: string; type: string }>(
      `PRAGMA table_info(sync_conflict_log)`,
    );
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'created_at',
        'entity_id',
        'error_detail',
        'id',
        'local_payload_json',
        'local_updated_at',
        'op_type',
        'resolution',
        'server_payload_json',
        'server_updated_at',
        'table_name',
      ].sort(),
    );
  });

  it('creates the (table_name, entity_id) lookup index', async () => {
    const db = await getDb();
    const idx = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'scl_table_entity_idx'`,
    );
    expect(idx).toHaveLength(1);
  });

  it('creates the created_at index for chronological queries', async () => {
    const db = await getDb();
    const idx = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'scl_created_at_idx'`,
    );
    expect(idx).toHaveLength(1);
  });

  it('is idempotent on re-open: second getDb does not re-run migrations or error', async () => {
    const db1 = await getDb();
    await db1.runAsync(
      `INSERT INTO sync_conflict_log
        (id, table_name, entity_id, op_type, resolution, local_payload_json, created_at)
       VALUES ('cl-1', 'user_collection_item', 'uci-1', 'updated', 'server_won', '{}', ?)`,
      [new Date().toISOString()],
    );
    // resetDbForTesting clears the connection singleton; opening
    // again should re-init (same in-memory db) without dropping rows.
    await resetDbForTesting();
    const db2 = await getDb();
    const rows = await db2.getAllAsync<{ id: string }>(`SELECT id FROM sync_conflict_log`);
    expect(rows.map((r) => r.id)).toContain('cl-1');
  });
});
