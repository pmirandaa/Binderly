// event-emitter.ts — `onConflictResolved(observer)` UX seam.
//
// The resolver fires `emit(event)` after every resolution (regardless
// of outcome). The screen layer subscribes via
// `conflictEvents.onConflictResolved(observer)` and decides whether
// the resolution warrants a user-visible toast (typically only
// `server_won` does — `local_won` is invisible to the user since the
// local edit "stuck"; `server_won_deleted` may be worth a toast
// depending on UX preferences; `transient_error` is silent).
//
// The same shape mirrors `syncQueueRepo.onDeadLetter`: returns an
// unsubscribe handle, observers are stored in a `Set` so duplicate
// subscriptions are idempotent, and emission to all observers is
// synchronous.

import type { ConflictResolvedEvent } from './types.js';

export type ConflictResolvedObserver = (event: ConflictResolvedEvent) => void;

export interface ConflictEventEmitter {
  onConflictResolved(observer: ConflictResolvedObserver): () => void;
  /** Internal — invoked by the resolver. Tests may also use this to
   *  simulate emissions without going through the resolver pipeline. */
  emit(event: ConflictResolvedEvent): void;
  /** For testing: remove all subscribed observers. */
  reset(): void;
  /** For testing / debugging: current observer count. */
  observerCount(): number;
}

class ConflictEventEmitterImpl implements ConflictEventEmitter {
  private readonly observers = new Set<ConflictResolvedObserver>();

  onConflictResolved(observer: ConflictResolvedObserver): () => void {
    this.observers.add(observer);
    return (): void => {
      this.observers.delete(observer);
    };
  }

  emit(event: ConflictResolvedEvent): void {
    // Iterate over a snapshot so an observer that unsubscribes itself
    // mid-emit doesn't perturb the loop.
    const snapshot = Array.from(this.observers);
    for (const observer of snapshot) {
      observer(event);
    }
  }

  reset(): void {
    this.observers.clear();
  }

  observerCount(): number {
    return this.observers.size;
  }
}

export const conflictEvents: ConflictEventEmitter = new ConflictEventEmitterImpl();

/** Factory for isolated emitter instances (used in tests + by
 *  `startConflictResolver` when callers want their own channel). */
export function createConflictEventEmitter(): ConflictEventEmitter {
  return new ConflictEventEmitterImpl();
}
