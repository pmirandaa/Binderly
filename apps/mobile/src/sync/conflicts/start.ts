// start.ts — subscribe the conflict resolver to the dead-letter
// channel. Mirror of T-OF-QUEUE's `startSync(collection)` shape.
//
// Usage:
//
//   import { startConflictResolver } from './sync/conflicts';
//   const stopResolver = startConflictResolver({
//     apiClient: apiClient.collection,
//   });
//   // on logout / cleanup:
//   stopResolver();
//
// The app shell composes both `startSync(collection)` and
// `startConflictResolver({ apiClient: collection })` at boot. Both
// return a stop handle; the app calls both on logout.
//
// Error handling: the resolver's `resolve()` swallows nothing — if it
// throws, the dead-letter observer logs the error and continues. We
// never want one botched resolution to silently disable the entire
// pipeline. Errors here typically indicate a programmer bug (e.g. an
// unhandled table_name in the local writer), not a runtime condition.

import type { CollectionResource } from '@binderly/api-client';

import {
  conflictEvents as defaultEvents,
} from './event-emitter.js';
import { ConflictResolver } from './resolver.js';
import { makeDefaultServerFetcher } from './server-fetcher.js';
import { syncQueueRepo } from '../queue/SyncQueueRepository.js';

import type {
  ConflictEventEmitter,
  ConflictResolvedObserver,
} from './event-emitter.js';
import type { ConflictLogEntry, ServerFetcher } from './types.js';

export interface StartConflictResolverOptions {
  /** Required: the `@binderly/api-client` collection resource. */
  apiClient: CollectionResource;
  /** Optional: override the default per-table fetcher (handy in tests). */
  serverFetcher?: ServerFetcher;
  /** Optional: override the singleton event emitter. */
  events?: ConflictEventEmitter;
  /**
   * Optional one-shot observer subscribed for the lifetime of the
   * resolver. Convenience for callers that want the resolver wiring
   * AND a single subscription in one call.
   */
  onResolved?: ConflictResolvedObserver;
  /**
   * Optional error handler called when `resolve()` throws an unexpected
   * error. Defaults to a `console.warn`. Tests can pass a `vi.fn()` to
   * assert the error is reported once.
   */
  onError?: (err: unknown, queueRowId: string) => void;
}

function defaultErrorHandler(err: unknown, queueRowId: string): void {
  const msg = err instanceof Error ? err.message : String(err);
   
  console.warn(
    `[conflicts] resolver failed on queue row ${queueRowId}: ${msg}`,
  );
}

/**
 * Wire the conflict resolver to the sync queue's dead-letter channel.
 * Returns a stop function that unsubscribes both the dead-letter
 * observer and the optional `onResolved` observer.
 *
 * The implementation is intentionally tiny: subscribe → resolve →
 * tolerate errors. All real logic lives in `ConflictResolver`.
 */
export function startConflictResolver(
  options: StartConflictResolverOptions,
): () => void {
  const events = options.events ?? defaultEvents;
  const fetcher = options.serverFetcher ?? makeDefaultServerFetcher(options.apiClient);
  const resolver = new ConflictResolver({ serverFetcher: fetcher, events });
  const onError = options.onError ?? defaultErrorHandler;

  const unsubResolved =
    options.onResolved !== undefined
      ? events.onConflictResolved(options.onResolved)
      : (): void => undefined;

  const unsubDeadLetter = syncQueueRepo.onDeadLetter((event) => {
    void resolver.resolve(event).catch((err) => {
      onError(err, event.row.id);
    });
  });

  return (): void => {
    unsubDeadLetter();
    unsubResolved();
  };
}

/**
 * Convenience helper for callers that want to drain pending dead-letter
 * rows that arrived BEFORE the resolver subscribed (e.g. an app that
 * crashed mid-resolution and is restarting). Walks every queue row
 * with status='failed' and resolves it. Safe to call alongside
 * `startConflictResolver`.
 */
export async function drainPendingDeadLetters(
  options: StartConflictResolverOptions,
): Promise<ConflictLogEntry[]> {
  const events = options.events ?? defaultEvents;
  const fetcher = options.serverFetcher ?? makeDefaultServerFetcher(options.apiClient);
  const resolver = new ConflictResolver({ serverFetcher: fetcher, events });
  const all = await syncQueueRepo.findAll();
  const failed = all.filter((row) => row.status === 'failed');
  const entries: ConflictLogEntry[] = [];
  for (const row of failed) {
    try {
      const entry = await resolver.resolve({ row, finalError: row.lastError ?? '' });
      entries.push(entry);
    } catch (err) {
      const onError = options.onError ?? defaultErrorHandler;
      onError(err, row.id);
    }
  }
  return entries;
}
