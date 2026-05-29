// `@binderly/feature-flags` — public barrel.
//
// The framework-agnostic free/pro gating decision core. Web
// (`apps/web/lib/gating/`) and mobile (`apps/mobile/src/lib/gating/`) wrap
// these pure functions with their own TanStack-Query-backed hooks +
// `<Gate>` / `<UpgradePrompt>` components. Sibling tasks (T-SH-THEMES,
// T-GR-COMMUNITY-FLYWHEEL) consume the platform hooks to gate themselves;
// this package is the shared, dependency-light decision layer underneath.
//
// Import everything from this entry point. The canonical `Tier`,
// `PaidFeature`, `CountLimitedResource`, `FREE_LIMITS`, etc. continue to
// come from `@binderly/entitlements` — this package re-exports the gating
// verdict types only.

export {
  evaluateGate,
  evaluateLimitGate,
  isAllowed,
  resourceToFeature,
  type GateAllowed,
  type GateBlocked,
  type GateBlockReason,
  type GateEntitlement,
  type GateResult,
} from './gate.js';
