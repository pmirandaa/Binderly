// `apps/mobile/src/grading/edges` — public barrel.
//
// Exports the edges sub-grade service contract + factory.
//
// The parallel tasks T-GR-SURFACE follows the same pattern:
// each exports a `create<Subgrade>Service` factory and a `default<Subgrade>Service`
// singleton with a `not_implemented` default impl.

// ── Types ────────────────────────────────────────────────────────────
export type {
  ConfidenceBand,
  EdgeStripLabel,
  EdgesRequest,
  EdgesResult,
  EdgesService,
  EdgesServiceError,
  EdgesServiceErrorReason,
  EdgesSubgrade,
} from './types.js';
export { isEdgesError, NUM_STRIPS } from './types.js';

// ── Service ──────────────────────────────────────────────────────────
export {
  createEdgesService,
  defaultEdgesService,
} from './edges-service.js';
