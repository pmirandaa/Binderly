// `apps/mobile/src/grading/surface` — public barrel.
//
// Exports the surface sub-grade service contract + factory.
//
// Pattern mirrors T-GR-CORNERS: each sub-grade exports a
// `create<Subgrade>Service` factory and a `default<Subgrade>Service`
// singleton with a `not_implemented` default impl.
//
// Raking-light seam: `SurfaceRequest.rakingLightUri` is optional (#FU-31).

// ── Types ────────────────────────────────────────────────────────────
export type {
  ConfidenceBand,
  SurfaceRequest,
  SurfaceResult,
  SurfaceService,
  SurfaceServiceError,
  SurfaceServiceErrorReason,
  SurfaceShotBand,
} from './types.js';
export { isSurfaceError } from './types.js';

// ── Service ──────────────────────────────────────────────────────────
export {
  createSurfaceService,
  defaultSurfaceService,
} from './surface-service.js';
