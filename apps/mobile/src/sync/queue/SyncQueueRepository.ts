// SyncQueueRepository — CRUD facade over the `sync_queue` SQLite table.
//
// Responsibilities:
//  - enqueue: insert a new pending row.
//  - popNext: fetch the oldest pending row whose next_attempt_at <= now.
//  - markDone: delete a successfully-replayed row.
//  - markAttempted: increment attempts + backoff after a transient failure.
//  - markFailed: set status='failed'; fire onDeadLetter observers.
//  - onDeadLetter: subscribe to dead-letter events (for T-OF-CONFLICTS).
//  - countPending: returns the number of 'pending' rows ready to replay.

import {
  MAX_ATTEMPTS,
  computeNextAttemptAt,
  type DeadLetterEvent,
  type QueueOpType,
  type QueueStatus,
  type QueueTableName,
  type SyncQueueRow,
} from './types.js';
import { getDb } from '../../db/index.js';

interface RawRow {
  id: string;
  table_name: string;
  op_type: string;
  payload_json: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  status: string;
}

function rowToEntity(row: RawRow): SyncQueueRow {
  return {
    id: row.id,
    tableName: row.table_name as QueueTableName,
    opType: row.op_type as QueueOpType,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    status: row.status as QueueStatus,
  };
}

type DeadLetterObserver = (event: DeadLetterEvent) => void;

class SyncQueueRepositoryImpl {
  private readonly deadLetterObservers = new Set<DeadLetterObserver>();

  /** Subscribe to dead-letter events (rows that hit MAX_ATTEMPTS). */
  onDeadLetter(observer: DeadLetterObserver): () => void {
    this.deadLetterObservers.add(observer);
    return (): void => {
      this.deadLetterObservers.delete(observer);
    };
  }

  private emitDeadLetter(event: DeadLetterEvent): void {
    for (const obs of this.deadLetterObservers) {
      obs(event);
    }
  }

  /** Insert a new pending mutation row. */
  async enqueue(
    id: string,
    tableName: QueueTableName,
    opType: QueueOpType,
    payloadJson: string,
    now: Date = new Date(),
  ): Promise<SyncQueueRow> {
    const db = await getDb();
    const createdAt = now.toISOString();

    await db.runAsync(
      `INSERT OR IGNORE INTO sync_queue
         (id, table_name, op_type, payload_json, created_at, attempts, last_error, next_attempt_at, status)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?, 'pending')`,
      [id, tableName, opType, payloadJson, createdAt, createdAt],
    );

    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM sync_queue WHERE id = ?`,
      [id],
    );
    return rowToEntity(row!);
  }

  /** Return the oldest pending row whose next_attempt_at <= now, or null. */
  async popNext(now: Date = new Date()): Promise<SyncQueueRow | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM sync_queue
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY created_at ASC
       LIMIT 1`,
      [now.toISOString()],
    );
    return row !== null ? rowToEntity(row) : null;
  }

  /** Delete a successfully-replayed row. */
  async markDone(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
  }

  /**
   * Increment attempts + compute backoff after a transient error.
   * If attempts reaches MAX_ATTEMPTS, delegates to markFailed instead.
   */
  async markAttempted(id: string, error: string, now: Date = new Date()): Promise<void> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM sync_queue WHERE id = ?`,
      [id],
    );
    if (row === null) return;

    const newAttempts = row.attempts + 1;
    const truncatedError = error.slice(0, 500);

    if (newAttempts >= MAX_ATTEMPTS) {
      await this.markFailed(id, truncatedError);
      return;
    }

    const nextAttemptAt = computeNextAttemptAt(newAttempts, now);

    await db.runAsync(
      `UPDATE sync_queue
       SET attempts = ?, last_error = ?, next_attempt_at = ?
       WHERE id = ?`,
      [newAttempts, truncatedError, nextAttemptAt, id],
    );
  }

  /** Mark a row as permanently failed and emit dead-letter event. */
  async markFailed(id: string, error: string): Promise<void> {
    const db = await getDb();
    const truncatedError = error.slice(0, 500);

    const existingRow = await db.getFirstAsync<RawRow>(
      `SELECT * FROM sync_queue WHERE id = ?`,
      [id],
    );
    if (existingRow === null) return;

    const newAttempts = existingRow.attempts + 1;

    await db.runAsync(
      `UPDATE sync_queue
       SET status = 'failed', attempts = ?, last_error = ?
       WHERE id = ?`,
      [newAttempts, truncatedError, id],
    );

    const updatedRow = await db.getFirstAsync<RawRow>(
      `SELECT * FROM sync_queue WHERE id = ?`,
      [id],
    );
    if (updatedRow !== null) {
      this.emitDeadLetter({ row: rowToEntity(updatedRow), finalError: truncatedError });
    }
  }

  /** Count rows ready to replay right now (status='pending', next_attempt_at <= now). */
  async countPending(now: Date = new Date()): Promise<number> {
    const db = await getDb();
    const result = await db.getFirstAsync<{ n: number | bigint }>(
      `SELECT COUNT(*) as n FROM sync_queue
       WHERE status = 'pending' AND next_attempt_at <= ?`,
      [now.toISOString()],
    );
    if (result === null) return 0;
    return typeof result.n === 'bigint' ? Number(result.n) : result.n;
  }

  /** Return all rows (for testing / debugging). */
  async findAll(): Promise<SyncQueueRow[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM sync_queue ORDER BY created_at ASC`,
    );
    return rows.map(rowToEntity);
  }

  /** Return a single row by id (for testing). */
  async findById(id: string): Promise<SyncQueueRow | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM sync_queue WHERE id = ?`,
      [id],
    );
    return row !== null ? rowToEntity(row) : null;
  }
}

export const syncQueueRepo = new SyncQueueRepositoryImpl();
export type { SyncQueueRepositoryImpl };
