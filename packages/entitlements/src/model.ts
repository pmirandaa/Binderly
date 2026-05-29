// Canonical entitlement model — the single definition of "what tiers
// exist and what paid features they unlock" for ALL of Binderly.
//
// This file is derived directly from `PROJECT.md § 16` (the Freemium
// plan matrix). It is intentionally pure data + types: no I/O, no
// runtime side effects, importable from web, mobile, the scanner, and
// the Supabase edge runtime alike.
//
// ── Source of truth ─────────────────────────────────────────────────
// RevenueCat is the unified entitlement *store* (Paddle webhooks feed
// it on web; the mobile SDK reads it directly). RC keys everything on a
// single entitlement identifier, `'pro'`. This package owns the
// canonical `PRO_ENTITLEMENT_ID` constant; both billing surfaces
// (`apps/mobile/src/billing/types.ts` and `apps/web/lib/paddle/plans.ts`)
// already use the literal `'pro'` and should eventually re-import it
// from here (that consolidation is T-PB-GATING's job, not this task's).
//
// ── PaidFeature reconciliation ──────────────────────────────────────
// The mobile billing module (T-PB-REVENUECAT) shipped an 8-entry
// `PaidFeature` union with slightly different names. The canonical list
// below is drawn from the spec matrix and *wins* per the task brief;
// the mapping from the mobile names is documented in the README. Every
// member of `PaidFeature` is pro-only by definition — there is no
// per-feature SKU; the single `'pro'` entitlement unlocks all of them
// (see `canUseFeature`).

/** Pricing tier derived from active RevenueCat entitlements. */
export type Tier = 'free' | 'pro';

/**
 * The RevenueCat entitlement identifier that unlocks every paid
 * feature. RC's "entitlement" abstraction is the cross-store,
 * cross-platform key we gate on (per `rules/10-paywall-billing.md`,
 * we use RC entitlement keys rather than product ids).
 *
 * **Contract:** T-PB-PADDLE's webhook grants this exact identifier and
 * T-PB-REVENUECAT's mobile SDK reads it. Do not change the literal
 * without updating both billing surfaces + the RC dashboard config.
 */
export const PRO_ENTITLEMENT_ID = 'pro' as const;
export type ProEntitlementId = typeof PRO_ENTITLEMENT_ID;

/**
 * The pro-only capabilities, taken verbatim from the PROJECT.md § 16
 * matrix (every row whose Free column is ❌ or count-limited). Adding a
 * member here is a strict-type widening, so downstream gate sites
 * (T-PB-GATING) get a compile error on an unknown feature rather than
 * silently granting it.
 *
 * Count-limited capabilities (`unlimited_custom_collections`,
 * `unlimited_shareables`) appear here as the *pro* unlock; the free
 * tier's numeric allowance is encoded separately in `FREE_LIMITS` and
 * checked via `withinFreeLimit`.
 */
export type PaidFeature =
  | 'stack_scanner'
  | 'grading_prediction'
  | 'unlimited_custom_collections'
  | 'save_smart_collections'
  | 'unlimited_shareables'
  | 'shareable_themes'
  | 'pricing_history'
  | 'export_data'
  | 'cloud_ai_scan';

/**
 * Every paid feature, enumerable at runtime. Order mirrors the
 * PROJECT.md § 16 matrix top-to-bottom. Consumers (e.g. the edge
 * function building `activeFeatures`) iterate this list.
 */
export const ALL_PAID_FEATURES: readonly PaidFeature[] = [
  'stack_scanner',
  'grading_prediction',
  'unlimited_custom_collections',
  'save_smart_collections',
  'unlimited_shareables',
  'shareable_themes',
  'pricing_history',
  'export_data',
  'cloud_ai_scan',
] as const;

/**
 * Resources whose free-tier allowance is count-based rather than a
 * hard on/off gate. These map to `FREE_LIMITS` keys and the
 * `withinFreeLimit` helper.
 */
export type CountLimitedResource = 'customCollections' | 'shareables';

/**
 * Free-tier numeric allowances (PROJECT.md § 16):
 *   - manual custom collections: 3 max
 *   - public shareables: 1
 *
 * Saved smart collections are 0 on free, but that's an on/off gate
 * (`save_smart_collections`), not a count, so it is not represented
 * here. Pro is unbounded for both resources.
 */
export const FREE_LIMITS: Readonly<Record<CountLimitedResource, number>> = {
  customCollections: 3,
  shareables: 1,
} as const;

/**
 * Source of a resolved entitlement read:
 *   - `'revenuecat'` — read came from RevenueCat (the source of truth).
 *   - `'fallback'`   — RC was unreachable, returned non-200, sent a
 *     malformed payload, or the secret key was unset; we degraded to
 *     free tier (fail-closed). Never crashes the caller.
 */
export type EntitlementSource = 'revenuecat' | 'fallback';
