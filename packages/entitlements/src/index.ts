// `@binderly/entitlements` — public barrel.
//
// External consumers (the `/v1/me/entitlements` edge function, web's
// gating layer, mobile's gating layer — all wired by T-PB-GATING) MUST
// import from this entry point. Deep imports like
// `@binderly/entitlements/can` are not exposed in the package.json
// `exports` map.
//
// Three layers:
//   - model.ts            canonical tiers, paid-feature surface, limits,
//                         the `'pro'` entitlement id (data + types only)
//   - can.ts              pure feature-gate helpers (no I/O)
//   - revenuecat-client   the resilient, fail-closed RC REST read client

export {
  ALL_PAID_FEATURES,
  FREE_LIMITS,
  PRO_ENTITLEMENT_ID,
  type CountLimitedResource,
  type EntitlementSource,
  type PaidFeature,
  type ProEntitlementId,
  type Tier,
} from './model.js';

export { canUseFeature, withinFreeLimit } from './can.js';

export {
  featuresForTier,
  isProEntitlementActive,
  readEntitlement,
  REVENUECAT_API_BASE_URL,
  type EntitlementReadResult,
  type ReadEntitlementOptions,
  type RevenueCatFetch,
  type RevenueCatFetchResponse,
} from './revenuecat-client.js';
