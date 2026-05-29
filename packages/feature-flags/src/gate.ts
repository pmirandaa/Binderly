// The pure gating decision core.
//
// Turns a resolved entitlement (`{ tier }`) + a paid feature (or a
// count-limited resource + current count) into a `GateResult` that the
// web/mobile glue render as either "let the action through" or "show the
// upgrade prompt with this reason".
//
// Built entirely on `@binderly/entitlements`' pure helpers
// (`canUseFeature`, `withinFreeLimit`) so the gate verdict is identical to
// the server's authoritative enforcement — these run on the same inputs.
//
// ── Fail-closed is the *caller's* job, not this module's ─────────────────
// This core is a pure function of its inputs. "Unknown / loading / error →
// treat as free" is enforced in the platform glue (the hooks coerce a
// missing/degraded read to `{ tier: 'free' }` before calling in here), so
// the decision logic itself stays a total, side-effect-free function. Pass
// `{ tier: 'free' }` and you get the free verdict; there is no third state.

import {
  canUseFeature,
  withinFreeLimit,
  FREE_LIMITS,
  type CountLimitedResource,
  type PaidFeature,
  type Tier,
} from '@binderly/entitlements';

/**
 * The minimal entitlement shape the gate core reads. Tier is the only
 * authoritative input (there is no per-feature SKU — the single `'pro'`
 * entitlement unlocks everything, see `@binderly/entitlements`). The
 * `EntitlementsDto` returned by `GET /v1/me/entitlements` is assignable to
 * this, so callers can pass the DTO straight through.
 */
export interface GateEntitlement {
  readonly tier: Tier;
}

/** Why a blocked gate is closed. */
export type GateBlockReason = 'requires_pro' | 'free_limit_reached';

/** The action is permitted at the user's current tier. */
export interface GateAllowed {
  readonly allowed: true;
}

/**
 * The action is blocked. `feature` is the pro capability the upgrade
 * unlocks (for a limit gate it's the matching `unlimited_*` feature), and
 * `limit` carries the free-tier numeric allowance for
 * `free_limit_reached` so the prompt can say "Free plan allows N".
 */
export interface GateBlocked {
  readonly allowed: false;
  readonly reason: GateBlockReason;
  readonly feature: PaidFeature;
  readonly limit?: number;
}

export type GateResult = GateAllowed | GateBlocked;

const ALLOWED: GateAllowed = { allowed: true };

/**
 * Map a count-limited resource to the pro feature that lifts its cap. Used
 * so a blocked limit gate names a real `PaidFeature` in its `feature`
 * field (keeps the upgrade-prompt copy + analytics consistent with on/off
 * gates).
 */
export function resourceToFeature(resource: CountLimitedResource): PaidFeature {
  switch (resource) {
    case 'customCollections':
      return 'unlimited_custom_collections';
    case 'shareables':
      return 'unlimited_shareables';
    default:
      return assertNever(resource);
  }
}

/**
 * Evaluate an on/off pro gate. `{ allowed: true }` iff the tier may use the
 * feature (today: `tier === 'pro'` for every feature). Otherwise blocked
 * with `reason: 'requires_pro'`.
 */
export function evaluateGate(entitlement: GateEntitlement, feature: PaidFeature): GateResult {
  if (canUseFeature(entitlement.tier, feature)) return ALLOWED;
  return { allowed: false, reason: 'requires_pro', feature };
}

/**
 * Evaluate a count-aware gate: "may this user create one more of
 * `resource`, given they already have `currentCount`?"
 *
 *   - Pro → always allowed (unbounded).
 *   - Free below the limit → allowed (e.g. 2/3 custom collections).
 *   - Free at/over the limit → blocked with `reason: 'free_limit_reached'`,
 *     `limit: FREE_LIMITS[resource]`, and the matching `unlimited_*`
 *     feature.
 *
 * Defensive count handling lives in `withinFreeLimit` (negative/NaN → 0).
 */
export function evaluateLimitGate(
  entitlement: GateEntitlement,
  resource: CountLimitedResource,
  currentCount: number,
): GateResult {
  if (withinFreeLimit(entitlement.tier, resource, currentCount)) return ALLOWED;
  return {
    allowed: false,
    reason: 'free_limit_reached',
    feature: resourceToFeature(resource),
    limit: FREE_LIMITS[resource],
  };
}

/**
 * Narrowing helper for consumers that prefer a boolean at the call site
 * (e.g. `disabled={!isAllowed(result)}`).
 */
export function isAllowed(result: GateResult): result is GateAllowed {
  return result.allowed;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled CountLimitedResource: ${String(value)}`);
}
