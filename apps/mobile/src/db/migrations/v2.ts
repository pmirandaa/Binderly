// Migration v2 — sync queue + set_logo_url.
//
// Two changes:
//   1. ALTER TABLE printing_lite ADD COLUMN set_logo_url TEXT
//      (Q-016 Option 1 — denormalize set logo URL into the per-printing row;
//       acceptable cost at user-collection scale, ~hundreds of rows max).
//   2. CREATE TABLE sync_queue — the T-OF-QUEUE mutation buffer.
//
// Runs after v1. Safe on both upgrade paths:
//   - Existing install (v1 already ran): ALTER TABLE adds the column;
//     CREATE TABLE IF NOT EXISTS creates the queue.
//   - Fresh install (v1 runs first in the same transaction): printing_lite
//     is created without set_logo_url by v1, then this migration adds it.

import { CREATE_SYNC_QUEUE_INDEXES, CREATE_SYNC_QUEUE_TABLE } from '../schema.js';

import type { SQLiteDatabase } from 'expo-sqlite';

export async function up(db: SQLiteDatabase): Promise<void> {
  // Add set_logo_url to printing_lite. The migration runner guarantees this
  // runs exactly once (schema_version guard), but we check the PRAGMA as
  // extra insurance against column-already-exists errors in edge cases.
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(printing_lite)`);
  const hasSetLogoUrl = cols.some((c) => c.name === 'set_logo_url');
  if (!hasSetLogoUrl) {
    await db.execAsync(`ALTER TABLE printing_lite ADD COLUMN set_logo_url TEXT`);
  }

  await db.execAsync(CREATE_SYNC_QUEUE_TABLE);
  await db.execAsync(CREATE_SYNC_QUEUE_INDEXES);
}
