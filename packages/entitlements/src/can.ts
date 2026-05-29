// Pure feature-gate helpers — no I/O, no async. These are what
// T-PB-GATING calls at every gate site on web + mobile, and what the
// edge function uses to build the `activeFeatures` list. Keeping them
// pure means the same logic runs identically on the server (authoritative
// enforcement) and the client (optimistic UX gating).

import { FREE_LIMITS, type CountLimitedResource, type PaidFeature, type Tier } from './model.js';

/**
 * Can a user on `tier` use `feature`?
 *
 * Every member of `PaidFeature` is pro-only by definition (there is no
 * per-feature SKU — the single `'pro'` entitlement unlocks them all),
 * so this is `tier === 'pro'` for every feature. The `feature` argument
 * is part of the signature anyway so:
 *
 *   1. Call sites are self-documenting:
 *      `canUseFeature(tier, 'unlimited_custom_collections')`.
 *   2. If we ever split entitlements (e.g. an ML-grading-only SKU), the
 *      per-feature mapping lives *here* and callers don't change.
 *
 * The exhaustive `switch` makes the "every feature is pro-gated"
 * invariant explicit: adding a new `PaidFeature` without a case is a
 * compile error (`never` exhaustiveness), forcing a deliberate decision
 * about its tier.
 */
export function canUseFeature(tier: Tier, feature: PaidFeature): boolean {
  switch (feature) {
    case 'stack_scanner':
    case 'grading_prediction':
    case 'unlimited_custom_collections':
    case 'save_smart_collections':
    case 'unlimited_shareables':
    case 'shareable_themes':
    case 'pricing_history':
    case 'export_data':
    case 'cloud_ai_scan':
      return tier === 'pro';
    default:
      return assertNever(feature);
  }
}

/**
 * Is the user allowed to create *one more* of a count-limited resource?
 *
 * Encodes the count-based gates from PROJECT.md § 16:
 *   - Free: `currentCount < FREE_LIMITS[resource]` → may create another.
 *     (e.g. 2/3 custom collections → `true`; 3/3 → `false`.)
 *   - Pro: always `true` (unbounded).
 *
 * `currentCount` is the number the user already has. A negative count
 * is treated as `0` defensively (a miscount upstream shouldn't grant
 * extra headroom or, worse, deny a legitimate create).
 */
export function withinFreeLimit(
  tier: Tier,
  resource: CountLimitedResource,
  currentCount: number,
): boolean {
  if (tier === 'pro') return true;
  const limit = FREE_LIMITS[resource];
  const normalized = Number.isFinite(currentCount) && currentCount > 0 ? currentCount : 0;
  return normalized < limit;
}

/**
 * Exhaustiveness guard. Unreachable at runtime when the `switch` above
 * covers every `PaidFeature`; if a new member is added without a case,
 * TS flags the call site at compile time.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled PaidFeature: ${String(value)}`);
}
