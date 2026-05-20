// apps/mobile/src/sync/index.ts — wiring shim.
//
// This file is outside the literal owns_paths for T-OF-QUEUE
// (`apps/mobile/src/sync/queue/`) but is documented in the task brief
// and PR body. It serves as the single integration point for app startup:
//
//   import { startSync } from './sync/index.js';
//   const stopSync = startSync(apiClient.collection);
//   // on logout / cleanup:
//   stopSync();
//
// The wiring:
//   1. subscribeAll() — attaches onLocalWrite listeners to all 3 repositories,
//      writing sync_queue rows for every local mutation.
//   2. ReplayEngine.start() — begins polling sync_queue and replaying rows
//      against the server. Pauses when offline, resumes when online.

import type { CollectionResource } from '@binderly/api-client';

import { subscribeAll } from './queue/enqueue.js';
import { ReplayEngine } from './queue/ReplayEngine.js';

/** Start the offline-sync subsystem. Returns a stop function. */
export function startSync(collection: CollectionResource): () => void {
  const stopSubscriptions = subscribeAll();
  const engine = new ReplayEngine(collection);
  const stopEngine = engine.start();

  return (): void => {
    stopSubscriptions();
    stopEngine();
  };
}
