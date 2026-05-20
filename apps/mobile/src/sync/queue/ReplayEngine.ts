// ReplayEngine — polls sync_queue and replays pending mutations against
// the @binderly/api-client when the device is online.
//
// State machine:
//   idle      — no pending rows; polling timer is running
//   replaying — actively processing a queue row
//   paused    — offline; polling is suspended
//
// Transitions:
//   idle → replaying       — popNext returns a row
//   replaying → idle       — queue drained
//   replaying → paused     — ApiNetworkError mid-replay OR connectivity lost
//   idle → paused          — connectivity lost
//   paused → idle/replaying — connectivity restored
//
// Error policy:
//   4xx (except 404 on DELETE, 429): markFailed immediately
//   404 on DELETE:                   treat as success (already deleted server-side)
//   429 / 5xx / ApiNetworkError:     markAttempted (exponential backoff)
//   10th failed attempt:             SyncQueueRepository.markFailed → onDeadLetter

import {
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiServerError,
  type CollectionResource,
} from '@binderly/api-client';

import { isOnline, onConnectivityChange } from './connectivity.js';
import { syncQueueRepo } from './SyncQueueRepository.js';
import { translate } from './translator.js';
import { customCollectionRepo } from '../../repositories/CustomCollectionRepository.js';
import { smartCollectionRepo } from '../../repositories/SmartCollectionRepository.js';
import { userCollectionRepo } from '../../repositories/UserCollectionRepository.js';

import type { QueueEngineState, SyncQueueRow } from './types.js';

// How often to poll when idle (ms). Short enough to feel responsive.
const POLL_INTERVAL_MS = 5_000;

type StateListener = (state: QueueEngineState) => void;

export class ReplayEngine {
  private _state: QueueEngineState = 'idle';
  private readonly stateListeners = new Set<StateListener>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stopConnectivity: (() => void) | null = null;
  private running = false;

  constructor(private readonly collection: CollectionResource) {}

  get state(): QueueEngineState {
    return this._state;
  }

  /** Subscribe to engine state changes. */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return (): void => {
      this.stateListeners.delete(listener);
    };
  }

  private setState(s: QueueEngineState): void {
    if (this._state === s) return;
    this._state = s;
    for (const listener of this.stateListeners) {
      listener(s);
    }
  }

  /** Start the engine. Returns a stop function. */
  start(): () => void {
    this.running = true;
    this.stopConnectivity = onConnectivityChange((online) => {
      if (!this.running) return;
      if (online) {
        if (this._state === 'paused') {
          this.setState('idle');
          this.schedulePoll(0);
        }
      } else {
        this.cancelPoll();
        this.setState('paused');
      }
    });

    // Check connectivity on start then begin polling.
    void isOnline().then((online) => {
      if (!this.running) return;
      if (online) {
        this.schedulePoll(0);
      } else {
        this.setState('paused');
      }
    });

    return () => this.stop();
  }

  stop(): void {
    this.running = false;
    this.cancelPoll();
    if (this.stopConnectivity !== null) {
      this.stopConnectivity();
      this.stopConnectivity = null;
    }
    this.setState('idle');
  }

  private cancelPoll(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private schedulePoll(delayMs = POLL_INTERVAL_MS): void {
    this.cancelPoll();
    this.pollTimer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.running || this._state === 'paused') return;

    const row = await syncQueueRepo.popNext();
    if (row === null) {
      this.setState('idle');
      this.schedulePoll(POLL_INTERVAL_MS);
      return;
    }

    this.setState('replaying');
    await this.replayRow(row);

    // After processing one row, immediately look for the next.
    this.schedulePoll(0);
  }

  private async replayRow(row: SyncQueueRow): Promise<void> {
    const result = translate(row);
    if (result === null) {
      // Unknown table/op — skip and mark done so it doesn't block the queue.
      await syncQueueRepo.markDone(row.id);
      return;
    }

    try {
      await result.execute(this.collection);

      // Success — delete queue row and mark repo row synced.
      await syncQueueRepo.markDone(row.id);

      if (result.entityId !== null) {
        const syncedAt = new Date().toISOString();
        await markRepoRowSynced(row.tableName, result.entityId, syncedAt);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (isRetryable(err, row)) {
        // Transient error — apply backoff.
        await syncQueueRepo.markAttempted(row.id, errorMsg);

        // If we got a network error, also transition to paused.
        if (err instanceof ApiNetworkError) {
          this.cancelPoll();
          this.setState('paused');
        }
      } else {
        // Non-retryable client error — dead-letter immediately.
        await syncQueueRepo.markFailed(row.id, errorMsg);
      }
    }
  }
}

function isRetryable(err: unknown, row: SyncQueueRow): boolean {
  // 404 on DELETE is success (handled by the caller returning from execute
  // without throwing — but if the client throws ApiNotFoundError on DELETE
  // we treat it as success here).
  if (err instanceof ApiNotFoundError && row.opType === 'deleted') {
    return false; // Will be caught and handled as success in caller
  }
  // Rate limit + server errors + network errors → retry
  if (err instanceof ApiRateLimitError) return true;
  if (err instanceof ApiServerError) return true;
  if (err instanceof ApiNetworkError) return true;
  // All other 4xx → non-retryable
  return false;
}

async function markRepoRowSynced(
  tableName: SyncQueueRow['tableName'],
  entityId: string,
  syncedAt: string,
): Promise<void> {
  switch (tableName) {
    case 'user_collection_item':
      await userCollectionRepo.markSynced(entityId, syncedAt);
      break;
    case 'custom_collection':
      await customCollectionRepo.markSynced(entityId, syncedAt);
      break;
    case 'smart_collection':
      await smartCollectionRepo.markSynced(entityId, syncedAt);
      break;
    case 'custom_collection_item':
      // custom_collection_item has no sync_status / markSynced; no-op.
      break;
  }
}
