// SyncConflictLogRepository — typed CRUD facade over `sync_conflict_log`.
//
// Append-only audit table. The resolver writes one row per dead-letter
// event resolved (including transient_error rows so we have a trail).
// No `update` / `delete` operations on the public surface; the log is
// retained for the lifetime of the install (sizes are tiny — under
// realistic offline-edit volumes the table tops out in the hundreds).

import { getDb } from '../../db/index.js';

import type {
  ConflictLogEntry,
  ConflictResolution,
} from './types.js';
import type { QueueOpType, QueueTableName } from '../queue/types.js';

interface RawRow {
  id: string;
  table_name: string;
  entity_id: string;
  op_type: string;
  resolution: string;
  local_payload_json: string;
  server_payload_json: string | null;
  local_updated_at: string | null;
  server_updated_at: string | null;
  error_detail: string | null;
  created_at: string;
}

function rowToEntry(row: RawRow): ConflictLogEntry {
  return {
    id: row.id,
    tableName: row.table_name as QueueTableName,
    entityId: row.entity_id,
    opType: row.op_type as QueueOpType,
    resolution: row.resolution as ConflictResolution,
    localPayloadJson: row.local_payload_json,
    serverPayloadJson: row.server_payload_json,
    localUpdatedAt: row.local_updated_at,
    serverUpdatedAt: row.server_updated_at,
    errorDetail: row.error_detail,
    createdAt: row.created_at,
  };
}

class SyncConflictLogRepositoryImpl {
  async append(entry: ConflictLogEntry): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_conflict_log (
        id, table_name, entity_id, op_type, resolution,
        local_payload_json, server_payload_json,
        local_updated_at, server_updated_at,
        error_detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.tableName,
        entry.entityId,
        entry.opType,
        entry.resolution,
        entry.localPayloadJson,
        entry.serverPayloadJson,
        entry.localUpdatedAt,
        entry.serverUpdatedAt,
        entry.errorDetail,
        entry.createdAt,
      ],
    );
  }

  async findAll(): Promise<ConflictLogEntry[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM sync_conflict_log ORDER BY created_at ASC, id ASC`,
    );
    return rows.map(rowToEntry);
  }

  async findById(id: string): Promise<ConflictLogEntry | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM sync_conflict_log WHERE id = ?`,
      [id],
    );
    return row !== null ? rowToEntry(row) : null;
  }

  async findByEntity(
    tableName: QueueTableName,
    entityId: string,
  ): Promise<ConflictLogEntry[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM sync_conflict_log
       WHERE table_name = ? AND entity_id = ?
       ORDER BY created_at ASC, id ASC`,
      [tableName, entityId],
    );
    return rows.map(rowToEntry);
  }

  async count(): Promise<number> {
    const db = await getDb();
    const result = await db.getFirstAsync<{ n: number | bigint }>(
      `SELECT COUNT(*) as n FROM sync_conflict_log`,
    );
    if (result === null) return 0;
    return typeof result.n === 'bigint' ? Number(result.n) : result.n;
  }
}

export const syncConflictLogRepo = new SyncConflictLogRepositoryImpl();
export type { SyncConflictLogRepositoryImpl };
