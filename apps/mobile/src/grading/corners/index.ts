// `apps/mobile/src/grading/corners` — public barrel.
//
// Exports the corners sub-grade service contract + factory.
//
// Future sibling tasks T-GR-EDGES and T-GR-SURFACE follow the same pattern:
// each exports a `create<Subgrade>Service` factory and a `default<Subgrade>Service`
// singleton with a `not_implemented` default impl.

// ── Types ────────────────────────────────────────────────────────────
export type {
  ConfidenceBand,
  CornerLabel,
  CornersRequest,
  CornersResult,
  CornersService,
  CornersServiceError,
  CornersServiceErrorReason,
  CornersSubgrade,
} from './types.js';
export { isCornersError, NUM_CORNERS } from './types.js';

// ── Service ──────────────────────────────────────────────────────────
export {
  createCornersService,
  defaultCornersService,
} from './corners-service.js';
