// Types for the T-OF-CONFLICTS LWW conflict-resolution module.
//
// The resolver consumes `DeadLetterEvent`s from T-OF-QUEUE's
// `syncQueueRepo.onDeadLetter(...)` subscription, decides per
// last-write-wins (LWW) on `updated_at`, persists the outcome to
// `sync_conflict_log`, and emits a `ConflictResolvedEvent` for the
// UX layer (subscribed later by T-M-CONFLICT-UX).

import type { QueueOpType, QueueTableName } from '../queue/types.js';

/**
 * The four terminal states of a resolution attempt:
 *
 *  - `local_won`           — local row is strictly newer than the
 *                            server's; we re-enqueue the original
 *                            mutation so the queue can retry it.
 *  - `server_won`          — server row is newer or tied; we overwrite
 *                            the local row with server state and emit
 *                            a UX notification.
 *  - `server_won_deleted`  — server returned 404 for an `updated` /
 *                            `deleted` op; the server-side row is
 *                            already gone, so we drop the local row
 *                            (or mark it synced as a tombstone) and
 *                            discard the dead-letter.
 *  - `transient_error`     — the server fetch itself failed with a
 *                            5xx / network error; we leave the
 *                            dead-letter row in place and log the
 *                            error so the next connectivity-restored
 *                            tick can retry.
 */
export type ConflictResolution =
  | 'local_won'
  | 'server_won'
  | 'server_won_deleted'
  | 'transient_error';

/**
 * One row in `sync_conflict_log`. Persisted by the resolver after
 * every decision. Field names mirror the SQL column names in
 * snake_case → camelCase exactly (see `apps/mobile/src/db/schema.ts`
 * `CREATE_SYNC_CONFLICT_LOG_TABLE`).
 */
export interface ConflictLogEntry {
  /** Client-generated UUID (we use a uuid v4 stub, not a server id). */
  id: string;
  tableName: QueueTableName;
  entityId: string;
  opType: QueueOpType;
  resolution: ConflictResolution;
  /** The queue row's `payload_json` at the time of attempted write. */
  localPayloadJson: string;
  /** The fetched server state as JSON; `null` on 404 / transient error. */
  serverPayloadJson: string | null;
  localUpdatedAt: string | null;
  serverUpdatedAt: string | null;
  /** `null` on success; the error string on transient_error. */
  errorDetail: string | null;
  createdAt: string;
}

/**
 * Emitted on the `conflictEvents.onConflictResolved` channel after
 * every resolution. UX seam consumed later by T-M-CONFLICT-UX (the
 * screen layer subscribes and renders a toast/banner when the
 * server-side state overrode a local edit). Subscribers are stateless
 * — they receive the full log entry and decide whether to surface it.
 */
export interface ConflictResolvedEvent {
  entry: ConflictLogEntry;
}

/**
 * Result of fetching the server state for a conflicting entity. The
 * resolver decides what to do based on this:
 *
 *  - `found`   — server has the entity; payload + updatedAt are non-null.
 *                `updatedAt` may still be `null` for entity types that
 *                don't expose one (e.g. `custom_collection_item`).
 *  - `not_found` — server returned 404; entity does not exist server-side.
 *  - `transient_error` — non-404 failure (5xx, network); resolver should
 *                back off without applying any local change.
 */
export type ServerFetchResult =
  | {
      kind: 'found';
      payload: unknown;
      updatedAt: string | null;
    }
  | { kind: 'not_found' }
  | { kind: 'transient_error'; error: string };

/**
 * Resolver dependency: how to fetch the current server state for a
 * given dead-letter event. Production wiring (in `start.ts`) builds a
 * default fetcher from the `@binderly/api-client` `CollectionResource`;
 * tests inject mocks.
 */
export interface ServerFetcher {
  fetch(event: import('../queue/types.js').DeadLetterEvent): Promise<ServerFetchResult>;
}
