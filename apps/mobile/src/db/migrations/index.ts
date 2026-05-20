// Migration runner for the local SQLite database.
//
// Contract:
//  - Reads the current schema version from `_meta.schema_version` (0 if
//    the table or key doesn't exist yet — i.e. fresh install).
//  - Applies every pending migration in order, wrapped in a single
//    exclusive transaction.
//  - Writes the new version back to `_meta` when done.
//  - Idempotent: safe to call on every app launch; already-applied
//    migrations are skipped.
//
// To add a migration:
//  1. Create `migrations/vN.ts` exporting `up(db)`.
//  2. Add an entry to the `MIGRATIONS` array below in order.
//  3. Bump `LATEST_SCHEMA_VERSION` to N.

import { CREATE_META_TABLE, CURRENT_SCHEMA_VERSION } from '../schema.js';
import { up as v1up } from './v1.js';
import { up as v2up } from './v2.js';

import type { SQLiteDatabase } from 'expo-sqlite';

interface Migration {
  version: number;
  up: (db: SQLiteDatabase) => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  { version: 1, up: v1up },
  { version: 2, up: v2up },
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  // Bootstrap: the _meta table may not exist on first run.
  await db.execAsync(CREATE_META_TABLE);

  const metaRow = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM _meta WHERE key = 'schema_version'`,
  );
  const currentVersion = metaRow !== null ? parseInt(metaRow.value, 10) : 0;

  if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  await db.withTransactionAsync(async () => {
    for (const migration of pending) {
      await migration.up(db);
    }
    await db.runAsync(
      `INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`,
      [String(CURRENT_SCHEMA_VERSION)],
    );
  });
}
