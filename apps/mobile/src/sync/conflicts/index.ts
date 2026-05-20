// Public barrel for the sync/conflicts module.
//
// Two entry points:
//   - `startConflictResolver(...)` — production wiring (app-shell call).
//   - `ConflictResolver` class       — test + custom-wiring use.
//
// Everything else is re-exported so callers can subscribe to the event
// emitter, query the conflict log, or directly invoke the resolver in
// tests without reaching into sub-modules.

export {
  conflictEvents,
  createConflictEventEmitter,
  type ConflictEventEmitter,
  type ConflictResolvedObserver,
} from './event-emitter.js';

export {
  syncConflictLogRepo,
  type SyncConflictLogRepositoryImpl,
} from './log-repository.js';

export {
  applyServerWins,
  applyServerWonDeleted,
} from './local-writer.js';

export {
  ConflictResolver,
  compareLocalNewer,
  type ConflictResolverDeps,
} from './resolver.js';

export {
  canonicalEntityId,
  makeDefaultServerFetcher,
  parseEntityRef,
} from './server-fetcher.js';

export {
  drainPendingDeadLetters,
  startConflictResolver,
  type StartConflictResolverOptions,
} from './start.js';

export type {
  ConflictLogEntry,
  ConflictResolution,
  ConflictResolvedEvent,
  ServerFetchResult,
  ServerFetcher,
} from './types.js';
