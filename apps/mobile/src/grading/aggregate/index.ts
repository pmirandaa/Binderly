// `apps/mobile/src/grading/aggregate` — public barrel.
//
// Exports the aggregate stage service contract + factory.
//
// Mirrors the T-GR-CORNERS / T-GR-EDGES / T-GR-SURFACE barrels exactly:
// `create<Stage>Service` factory + `default<Stage>Service` singleton with a
// `not_implemented` default impl.

// ── Types ────────────────────────────────────────────────────────────
export type {
  AggregateRequest,
  AggregateResult,
  AggregateService,
  AggregateServiceError,
  AggregateServiceErrorReason,
  ConfidenceBandLabel,
  SubGradeName,
} from './types.js';
export { isAggregateError, SUBGRADE_NAMES } from './types.js';

// ── Service ──────────────────────────────────────────────────────────
export {
  createAggregateService,
  defaultAggregateService,
} from './service.js';

// ── Errors (explicit-import callsites) ───────────────────────────────
export {
  isAggregateError as isAggregateServiceError,
} from './errors.js';
