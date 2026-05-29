// Entitlements DTO — the wire shape of `GET /v1/me/entitlements`.
//
// This is the canonical *read* answer to "is the current user free or
// pro, and what can they do?" served by the entitlements edge function,
// which reads RevenueCat (the source of truth) via the
// `@binderly/entitlements` RC read client.
//
// The feature vocabulary mirrors `@binderly/entitlements`'s canonical
// `PaidFeature` union (PROJECT.md § 16). We re-declare the enum here
// (rather than importing the package) so `@binderly/api-contracts`
// stays at the bottom of the dependency graph — every consumer already
// depends on contracts, and contracts must not gain a dependency on a
// downstream package. Both lists are pinned against the same PROJECT.md
// § 16 literal in their respective tests (`entitlements.test.ts` here +
// `model.test.ts` in the package), so they can't silently drift.

import { z } from 'zod';

import { subscriptionTierSchema } from './auth.js';
import { isoDateTimeSchema } from './common.js';

// ============================================================
// Tier — reuse the subscription tier enum (free | pro)
// ============================================================

/**
 * Entitlement tier. Identical vocabulary to `subscriptionTierSchema`
 * (`'free' | 'pro'`) — re-exported under an entitlements-flavoured
 * alias so this module reads self-contained at gate sites.
 */
export const entitlementTierSchema = subscriptionTierSchema;
export type EntitlementTier = z.infer<typeof entitlementTierSchema>;

// ============================================================
// Paid features — mirror of @binderly/entitlements PaidFeature
// ============================================================

/**
 * The pro-only capability surface from PROJECT.md § 16. Mirror of the
 * canonical `PaidFeature` union in `@binderly/entitlements/model.ts`.
 * Keep in lockstep — both are pinned against the § 16 matrix in tests.
 */
export const PAID_FEATURES = [
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
export const paidFeatureSchema = z.enum(PAID_FEATURES);
export type PaidFeature = z.infer<typeof paidFeatureSchema>;

// ============================================================
// Source — where the entitlement read came from
// ============================================================

/**
 * Provenance of the entitlement read:
 *   - `revenuecat` — authoritative read from RC (the source of truth).
 *   - `fallback`   — RC was unreachable / unconfigured / errored and the
 *     service degraded to free tier (fail-closed). Clients may surface a
 *     subtle "couldn't confirm subscription" affordance but must NOT
 *     unlock paid features on a fallback.
 */
export const ENTITLEMENT_SOURCES = ['revenuecat', 'fallback'] as const;
export const entitlementSourceSchema = z.enum(ENTITLEMENT_SOURCES);
export type EntitlementSource = z.infer<typeof entitlementSourceSchema>;

// ============================================================
// Entitlements — read DTO
// ============================================================

/**
 * Read-side wire shape for `GET /v1/me/entitlements`.
 *
 * - `tier` — the resolved tier; `'free'` on any fallback.
 * - `activeFeatures` — the paid features unlocked at this tier. Empty
 *   for free; the full `PAID_FEATURES` list for pro. (There is no
 *   per-feature SKU — this is derived from `tier` server-side, but it's
 *   on the wire so clients gate without re-deriving the mapping.)
 * - `source` — `revenuecat` (authoritative) or `fallback` (degraded).
 * - `checkedAt` — ISO-8601 timestamp the read was resolved; lets clients
 *   cache + show "as of" without trusting their own clock.
 */
export const entitlementsDto = z
  .object({
    tier: entitlementTierSchema,
    activeFeatures: z.array(paidFeatureSchema),
    source: entitlementSourceSchema,
    checkedAt: isoDateTimeSchema,
  })
  .strict();
export type EntitlementsDto = z.infer<typeof entitlementsDto>;
