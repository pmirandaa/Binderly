// Migration v3 — sync_conflict_log.
//
// Adds the append-only audit table used by the T-OF-CONFLICTS LWW
// resolver. One row per dead-letter event resolved, with both the local
// and server payloads frozen at decision time for future undo UX.
//
// Idempotency:
//   - The CREATE TABLE statement uses IF NOT EXISTS so it is safe on
//     both fresh installs (where v3 follows v1 + v2 in the same
//     transaction) and on devices that already ran v3 (where the
//     migration runner's schema_version guard would normally skip
//     this anyway — but defence in depth is cheap).
//   - Indexes also use IF NOT EXISTS for the same reason.

import {
  CREATE_SYNC_CONFLICT_LOG_INDEXES,
  CREATE_SYNC_CONFLICT_LOG_TABLE,
} from '../schema.js';

import type { SQLiteDatabase } from 'expo-sqlite';

export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_SYNC_CONFLICT_LOG_TABLE);
  await db.execAsync(CREATE_SYNC_CONFLICT_LOG_INDEXES);
}
