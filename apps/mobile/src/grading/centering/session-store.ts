// Session store — the router-param hand-off seam (replaced the removed
// `__getLastEmittedSession` module-scoped ref; see #FU-32 closure below).
//
// A module-scoped `Map<string, GradingCaptureSession>` keyed by session id.
// Written by the capture screen on completion; read by any downstream
// grading screen via `?sessionId=<id>` router params.
//
// # Why a Map, not AsyncStorage?
//
// Sessions are ephemeral (single app-open).  Persisting to AsyncStorage
// adds unnecessary complexity in v1.  The Map is reset on process restart,
// which is acceptable because the capture flow itself would also be reset.
//
// # Future sibling tasks
//
// T-GR-CORNERS, T-GR-EDGES, T-GR-SURFACE all use the same `sessionId`
// convention — they import `getSession` from this module via the centering
// barrel (`apps/mobile/src/grading/centering/index.ts`).  One session id
// is shared across all four grading screens for the same card capture.
//
// # #FU-32 closure
//
// This module is the real router-param hand-off that replaced the
// module-scoped `__getLastEmittedSession` / `__setLastEmittedSession` ref
// that T-GR-CAPTURE-UX shipped tagged `@deprecated`.  Those exports have
// now been removed entirely (T-ROUTING-CLEANUP / #FU-32): the capture
// screen calls `storeSession(emitted)` and routes with `?sessionId=<id>`;
// every downstream grading screen retrieves the session via `getSession`.

import type { SessionStore } from './types.js';
import type { GradingCaptureSession } from '../capture/types.js';


/** Module-scoped session registry. */
const _sessions = new Map<string, GradingCaptureSession>();

/**
 * Store a completed capture session so downstream grading screens can
 * retrieve it via `getSession(session.id)`.
 *
 * Calling `storeSession` with a session whose id is already in the store
 * overwrites the previous entry (safe for re-entry scenarios).
 */
export function storeSession(session: GradingCaptureSession): void {
  _sessions.set(session.id, session);
}

/**
 * Retrieve a session by id.  Returns `undefined` if the id is not in the
 * store (the session was never emitted or has already been cleared).
 */
export function getSession(sessionId: string): GradingCaptureSession | undefined {
  return _sessions.get(sessionId);
}

/**
 * Remove a session from the store.  Called by the centering screen on
 * unmount to free memory.  A no-op if the id is not found.
 */
export function clearSession(sessionId: string): void {
  _sessions.delete(sessionId);
}

/** Number of sessions currently held in the store. */
export function sessionStoreSize(): number {
  return _sessions.size;
}

/**
 * Clear ALL sessions.  Used in tests to reset module state between test
 * cases.  Not exported from the public barrel — internal use only.
 *
 * @internal
 */
export function __resetSessionStore(): void {
  _sessions.clear();
}

/**
 * A {@link SessionStore} implementation backed by the module-scoped Map.
 * Useful for dependency-injection in tests that want to swap the store.
 */
export const moduleSessionStore: SessionStore = {
  store: storeSession,
  get: getSession,
  clear: clearSession,
  size: sessionStoreSize,
};
