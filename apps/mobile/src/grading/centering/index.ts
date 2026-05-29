// `apps/mobile/src/grading/centering` — public barrel.
//
// Exports the session-store seam (the router-param hand-off that replaced
// the removed `__getLastEmittedSession` ref from `grading/capture`), the
// centering service contract + factory, the `useCentering` hook, and the
// `CenteringScreen`.
//
// Future sibling tasks (T-GR-CORNERS, T-GR-EDGES, T-GR-SURFACE) import
// `getSession` from here to retrieve the same session by id.

// ── Types ────────────────────────────────────────────────────────────
export type {
  CenteringGradeHint,
  CenteringMargins,
  CenteringRequest,
  CenteringResult,
  CenteringService,
  CenteringServiceError,
  CenteringServiceErrorReason,
  SessionStore,
} from './types.js';
export { isCenteringError } from './types.js';

// ── Session store ────────────────────────────────────────────────────
export {
  clearSession,
  getSession,
  moduleSessionStore,
  sessionStoreSize,
  storeSession,
} from './session-store.js';

// ── Service ──────────────────────────────────────────────────────────
export {
  createCenteringService,
  defaultCenteringService,
} from './centering-service.js';

// ── Hook ─────────────────────────────────────────────────────────────
export { useCentering } from './use-centering.js';
export type { CenteringStatus, UseCenteringOptions, UseCenteringState } from './use-centering.js';

// ── Screen ───────────────────────────────────────────────────────────
export { CenteringScreen } from './screens/CenteringScreen.js';
export type { CenteringScreenProps } from './screens/CenteringScreen.js';
