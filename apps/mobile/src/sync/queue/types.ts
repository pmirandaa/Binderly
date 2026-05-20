// Types for the T-OF-QUEUE mutation queue + replay engine.

export type QueueStatus = 'pending' | 'failed';

export type QueueOpType = 'created' | 'updated' | 'deleted';

export type QueueTableName =
  | 'user_collection_item'
  | 'custom_collection'
  | 'custom_collection_item'
  | 'smart_collection';

export interface SyncQueueRow {
  id: string;
  tableName: QueueTableName;
  opType: QueueOpType;
  payloadJson: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  status: QueueStatus;
}

/** State of the replay engine. */
export type QueueEngineState = 'idle' | 'replaying' | 'paused';

/** Emitted when a queue row exhausts all retry attempts. */
export interface DeadLetterEvent {
  row: SyncQueueRow;
  finalError: string;
}

// Backoff constants
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 3_600_000;
export const MAX_ATTEMPTS = 10;

/** Compute next_attempt_at for a given attempt number (0-indexed, pre-increment). */
export function computeNextAttemptAt(attempts: number, now: Date = new Date()): string {
  const delayMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts), BACKOFF_CAP_MS);
  return new Date(now.getTime() + delayMs).toISOString();
}
