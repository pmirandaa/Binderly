// resolver.ts — Last-Write-Wins conflict resolver for dead-lettered
// mutations.
//
// Lifecycle of one dead-letter event:
//
//   1. Identify the entity from `event.row.tableName` + `payload_json`.
//   2. Fetch fresh server state via the injected `ServerFetcher`.
//      - 404 with op='created'              → local_won, re-enqueue.
//      - 404 with op='updated' | 'deleted'  → server_won_deleted, purge local.
//      - transient_error                    → log transient_error, leave dead-letter row.
//      - found                              → LWW timestamp compare.
//   3. LWW comparison (only when server returned `found`):
//      - Local newer (strictly)             → local_won, re-enqueue.
//      - Local older OR tied OR no updatedAt
//                                           → server_won, overwrite local.
//   4. Persist a `sync_conflict_log` row.
//   5. On success (any outcome except `transient_error`), delete the
//      dead-letter queue row.
//   6. Emit `ConflictResolvedEvent` on the event emitter (the UX layer
//      filters on resolution type and decides whether to surface a
//      toast).
//
// Idempotency: the resolver tolerates being called twice on the same
// dead-letter event. The second call:
//   - finds the queue row already deleted → bails out at step 5 with
//     no-op writes (the conflict log already has an entry; we add a
//     fresh idempotent re-resolution entry for audit).
//   - or finds the same server state and same local state → applies
//     the same INSERT OR REPLACE which is a no-op (same row data).
//
// Crash-safety: every resolution wraps writes (apply + log + queue
// delete + re-enqueue) inside `db.withTransactionAsync(...)`. A crash
// mid-resolution leaves the dead-letter row in place and no log entry;
// the next tick redoes the work cleanly.


import {
  applyServerWins,
  applyServerWonDeleted,
} from './local-writer.js';
import { syncConflictLogRepo } from './log-repository.js';
import { canonicalEntityId, parseEntityRef } from './server-fetcher.js';
import { getDb } from '../../db/index.js';
import { syncQueueRepo } from '../queue/SyncQueueRepository.js';

import type {
  ConflictEventEmitter,
} from './event-emitter.js';
import type {
  ConflictLogEntry,
  ConflictResolution,
  ServerFetcher,
} from './types.js';
import type { DeadLetterEvent, QueueTableName } from '../queue/types.js';

/**
 * Inject-able dependencies. The `now` and `idGenerator` hooks make the
 * resolver deterministic in tests.
 */
export interface ConflictResolverDeps {
  serverFetcher: ServerFetcher;
  /** Optional emitter; defaults to the singleton from event-emitter.ts. */
  events?: ConflictEventEmitter;
  /** Returns the current time. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Returns a fresh conflict-log id. Defaults to a uuid-ish stamp. */
  idGenerator?: () => string;
}

let _counter = 0;
function defaultIdGenerator(): string {
  _counter += 1;
  // Not a real UUID v4 — sufficient for client-side uniqueness inside
  // a single install. Format: "cl-<unix-ms>-<counter>-<rand>".
  const rand = Math.random().toString(36).slice(2, 10);
  return `cl-${Date.now()}-${_counter}-${rand}`;
}

export class ConflictResolver {
  private readonly serverFetcher: ServerFetcher;
  private readonly events: ConflictEventEmitter | null;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(deps: ConflictResolverDeps) {
    this.serverFetcher = deps.serverFetcher;
    this.events = deps.events ?? null;
    this.now = deps.now ?? ((): Date => new Date());
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
  }

  /**
   * Resolve a single dead-letter event. Returns the persisted
   * `ConflictLogEntry` for the caller's bookkeeping.
   */
  async resolve(event: DeadLetterEvent): Promise<ConflictLogEntry> {
    const ref = parseEntityRef(event);
    const fetchResult = await this.serverFetcher.fetch(event);

    if (fetchResult.kind === 'transient_error') {
      // Don't apply any local change; don't delete the dead-letter row.
      // Persist the transient error in the log so debugging is possible.
      const entry: ConflictLogEntry = {
        id: this.idGenerator(),
        tableName: event.row.tableName,
        entityId: canonicalEntityId(event),
        opType: event.row.opType,
        resolution: 'transient_error',
        localPayloadJson: event.row.payloadJson,
        serverPayloadJson: null,
        localUpdatedAt: this.readLocalUpdatedAt(event),
        serverUpdatedAt: null,
        errorDetail: fetchResult.error,
        createdAt: this.now().toISOString(),
      };
      await syncConflictLogRepo.append(entry);
      this.emit(entry);
      return entry;
    }

    if (fetchResult.kind === 'not_found') {
      return this.resolveServerNotFound(event, ref);
    }

    // fetchResult.kind === 'found'
    return this.resolveServerFound(event, ref, fetchResult.payload, fetchResult.updatedAt);
  }

  private async resolveServerNotFound(
    event: DeadLetterEvent,
    _ref: ReturnType<typeof parseEntityRef>,
  ): Promise<ConflictLogEntry> {
    const localUpdatedAt = this.readLocalUpdatedAt(event);

    if (event.row.opType === 'created') {
      // Local create + server doesn't have it → local wins by definition.
      // Re-enqueue the original payload so the queue can retry the POST.
      return this.applyLocalWon(event, null, localUpdatedAt, null);
    }

    // updated | deleted: server says the entity is gone; local change
    // is moot — purge the local row to converge.
    return this.applyServerWonDeleted(event, localUpdatedAt);
  }

  private async resolveServerFound(
    event: DeadLetterEvent,
    _ref: ReturnType<typeof parseEntityRef>,
    serverPayload: unknown,
    serverUpdatedAt: string | null,
  ): Promise<ConflictLogEntry> {
    const localUpdatedAt = this.readLocalUpdatedAt(event);

    const localWins = compareLocalNewer(localUpdatedAt, serverUpdatedAt);

    if (localWins) {
      return this.applyLocalWon(event, serverPayload, localUpdatedAt, serverUpdatedAt);
    }
    return this.applyServerWon(event, serverPayload, localUpdatedAt, serverUpdatedAt);
  }

  // ---- Outcome handlers (each wrapped in a transaction) ----

  private async applyLocalWon(
    event: DeadLetterEvent,
    serverPayload: unknown,
    localUpdatedAt: string | null,
    serverUpdatedAt: string | null,
  ): Promise<ConflictLogEntry> {
    const entry: ConflictLogEntry = {
      id: this.idGenerator(),
      tableName: event.row.tableName,
      entityId: canonicalEntityId(event),
      opType: event.row.opType,
      resolution: 'local_won',
      localPayloadJson: event.row.payloadJson,
      serverPayloadJson: serverPayload !== null ? JSON.stringify(serverPayload) : null,
      localUpdatedAt,
      serverUpdatedAt,
      errorDetail: null,
      createdAt: this.now().toISOString(),
    };

    const db = await getDb();
    await db.withTransactionAsync(async () => {
      // Re-enqueue: fresh id, same table + op + payload. Goes back to
      // the head of the queue with `next_attempt_at = now`.
      const newQueueId = `${event.row.id}:requeue:${this.idGenerator()}`;
      await syncQueueRepo.enqueue(
        newQueueId,
        event.row.tableName,
        event.row.opType,
        event.row.payloadJson,
        this.now(),
      );
      // Delete the dead-letter row (the failed copy).
      await syncQueueRepo.markDone(event.row.id);
      await syncConflictLogRepo.append(entry);
    });

    this.emit(entry);
    return entry;
  }

  private async applyServerWon(
    event: DeadLetterEvent,
    serverPayload: unknown,
    localUpdatedAt: string | null,
    serverUpdatedAt: string | null,
  ): Promise<ConflictLogEntry> {
    const entry: ConflictLogEntry = {
      id: this.idGenerator(),
      tableName: event.row.tableName,
      entityId: canonicalEntityId(event),
      opType: event.row.opType,
      resolution: 'server_won',
      localPayloadJson: event.row.payloadJson,
      serverPayloadJson: JSON.stringify(serverPayload),
      localUpdatedAt,
      serverUpdatedAt,
      errorDetail: null,
      createdAt: this.now().toISOString(),
    };

    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await applyServerWins(event.row.tableName, serverPayload);
      await syncQueueRepo.markDone(event.row.id);
      await syncConflictLogRepo.append(entry);
    });

    this.emit(entry);
    return entry;
  }

  private async applyServerWonDeleted(
    event: DeadLetterEvent,
    localUpdatedAt: string | null,
  ): Promise<ConflictLogEntry> {
    const entry: ConflictLogEntry = {
      id: this.idGenerator(),
      tableName: event.row.tableName,
      entityId: canonicalEntityId(event),
      opType: event.row.opType,
      resolution: 'server_won_deleted',
      localPayloadJson: event.row.payloadJson,
      serverPayloadJson: null,
      localUpdatedAt,
      serverUpdatedAt: null,
      errorDetail: null,
      createdAt: this.now().toISOString(),
    };

    const ref = parseEntityRef(event);

    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await applyServerWonDeleted(
        event.row.tableName,
        ref.primaryId,
        ref.printingId,
      );
      await syncQueueRepo.markDone(event.row.id);
      await syncConflictLogRepo.append(entry);
    });

    this.emit(entry);
    return entry;
  }

  // ---- Helpers ----

  private readLocalUpdatedAt(event: DeadLetterEvent): string | null {
    const payload = JSON.parse(event.row.payloadJson) as Record<string, unknown>;
    const raw = payload.updatedAt;
    return typeof raw === 'string' ? raw : null;
  }

  private emit(entry: ConflictLogEntry): void {
    if (this.events === null) return;
    this.events.emit({ entry });
  }
}

/**
 * Pure LWW comparator. Local-wins iff local.updatedAt is strictly
 * greater than server.updatedAt. Any missing timestamp on either side
 * means "we can't compare" → server wins (the conservative posture
 * per the task brief — the server successfully wrote its row, ours
 * was only queued).
 *
 * Comparison is on the ISO-8601 string: since the strings are
 * lexicographically ordered when both are in UTC, `>` does the right
 * thing without parsing to Date. We do a Date-fallback comparison
 * defensively in case one side is in a non-UTC zone — both should be
 * UTC by convention (`*.toISOString()` always emits `Z`).
 */
export function compareLocalNewer(
  localUpdatedAt: string | null,
  serverUpdatedAt: string | null,
): boolean {
  if (localUpdatedAt === null || serverUpdatedAt === null) return false;
  // Parse both as Date first. Any un-parseable string → server wins
  // (conservative: we cannot make a defensible LWW call on garbage
  // input). Same posture as the null-input branch above.
  const localMs = Date.parse(localUpdatedAt);
  const serverMs = Date.parse(serverUpdatedAt);
  if (Number.isNaN(localMs) || Number.isNaN(serverMs)) return false;
  return localMs > serverMs;
}

/**
 * Convenience type re-export so callers can import the resolution
 * union from this module without reaching into `types.ts`.
 */
export type { ConflictResolution, QueueTableName };
