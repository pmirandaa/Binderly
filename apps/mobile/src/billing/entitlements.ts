// Entitlement queries.
//
// - `useEntitlementsQuery()`: TanStack Query wrapper over
//   `Purchases.getCustomerInfo()`. Returns the derived
//   `{ activeEntitlements, tier, customerInfo }` snapshot.
//
// - `usePaidFeature(feature)`: convenience hook. `true` iff
//   `tier === 'pro'`. Today every paid feature is gated by the
//   single `'pro'` entitlement (per `PROJECT.md § 16` — there is
//   no per-feature SKU). If we ever split that out (e.g. an
//   "ml-grading-only" entitlement, a "team-shareables" entitlement)
//   the per-feature mapping is the surface that changes; consumers
//   don't.
//
// - `mapCustomerInfoToSnapshot(...)`: pure function — split out so
//   the test suite can assert tier-derivation without spinning up
//   TanStack Query. The "expired entitlements are ignored" semantic
//   leans entirely on RC's `entitlements.active` map (RC only ever
//   includes currently-active entitlements there) plus a defensive
//   check on `isActive` + `expirationDate`.
//
// **Entitlement id contract:** the `'pro'` string is exported from
// `./types.ts` as `PRO_ENTITLEMENT_ID`. T-PB-PADDLE's webhook
// must grant this exact identifier; T-PB-ENTITLEMENTS will read
// it across web + mobile. Don't change the literal without
// updating the parallel workers.

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getBillingAdapter } from './init.js';
import {
  PRO_ENTITLEMENT_ID,
  type CustomerInfo,
  type EntitlementsSnapshot,
  type PaidFeature,
  type PurchasesEntitlementInfo,
  type Tier,
} from './types.js';

// ============================================================
// TanStack Query key
// ============================================================

/**
 * The single TanStack Query key for the entitlements snapshot.
 * Exported so `purchase.ts` can `setQueryData(...)` to
 * optimistically refresh after a successful purchase.
 */
export const ENTITLEMENTS_QUERY_KEY = ['binderly', 'billing', 'entitlements'] as const;

/**
 * Stable, reasonable defaults. RC caches `getCustomerInfo()`
 * server-side already, so we don't need to refetch aggressively.
 * Five minutes mirrors the offerings cache and is short enough
 * that an externally-granted entitlement (e.g. via the RC
 * dashboard) propagates in a reasonable window.
 */
const ENTITLEMENTS_STALE_MS = 5 * 60 * 1000;

// ============================================================
// useEntitlementsQuery
// ============================================================

export function useEntitlementsQuery(): UseQueryResult<EntitlementsSnapshot, Error> {
  return useQuery<EntitlementsSnapshot, Error>({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    queryFn: async (): Promise<EntitlementsSnapshot> => {
      const adapterRef = getBillingAdapter();
      const customerInfo = await adapterRef.getCustomerInfo();
      return mapCustomerInfoToSnapshot(
        customerInfo,
        /* fromConfiguredAdapter */ adapterRef.isConfigured,
      );
    },
    staleTime: ENTITLEMENTS_STALE_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

// ============================================================
// usePaidFeature
// ============================================================

/**
 * Returns `true` iff the user has the `pro` entitlement.
 *
 * Today every value in `PaidFeature` maps to the same `'pro'`
 * entitlement (see `PROJECT.md § 16` — there is no per-feature
 * SKU). Accepting the feature name in the signature anyway:
 *
 *   1. Makes call sites self-documenting:
 *        `usePaidFeature('unlimited_custom_collections')`
 *      vs. an opaque `useIsPro()` that the next reader has to
 *      cross-reference.
 *
 *   2. Lets us split entitlements later (e.g. a separate ML-only
 *      entitlement for grading) without changing every caller.
 *
 * The hook reads from the same TanStack Query the
 * `useEntitlementsQuery()` hook reads, so call sites don't
 * trigger a second network round-trip; the cache is shared.
 *
 * The `feature` argument is intentionally *consumed* by the
 * future entitlement-mapping. We read it via `Object.is` to
 * satisfy `noUnusedParameters` without changing the rule shape.
 */
export function usePaidFeature(feature: PaidFeature): boolean {
  // Future-proofing: when the feature surface splits across
  // multiple entitlements, this is where we look up which RC
  // entitlement key gates `feature` and check that specific one.
  // For v1, every feature gates on `'pro'`.
  void feature;
  const query = useEntitlementsQuery();
  return query.data?.tier === 'pro';
}

/**
 * Imperative cousin of `useEntitlementsQuery()` for screens that
 * need to invalidate the entitlements cache (e.g. after pulling
 * to refresh in settings). Returns a function the screen calls
 * with no arguments.
 */
export function useInvalidateEntitlements(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await client.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
  }, [client]);
}

// ============================================================
// Pure mapping helper
// ============================================================

/**
 * Pure: derive `{ activeEntitlements, tier }` from a
 * `CustomerInfo` blob. Exported so the test suite can pin the
 * derivation without TanStack Query in scope.
 *
 * "Active" is the union of (a) RC's `entitlements.active` map
 * (RC strips expired ones server-side) and (b) a defensive client
 * check on `isActive: true` + `expirationDate` not-in-the-past.
 * The defensive check covers clock-skew + grandfathered
 * lifetime grants (where `expirationDate === null`).
 */
export function mapCustomerInfoToSnapshot(
  customerInfo: CustomerInfo,
  fromConfiguredAdapter: boolean,
): EntitlementsSnapshot {
  const filtered = filterActive(customerInfo.entitlements.active);
  const tier: Tier = filtered[PRO_ENTITLEMENT_ID] !== undefined ? 'pro' : 'free';
  return {
    activeEntitlements: filtered,
    tier,
    customerInfo: fromConfiguredAdapter ? customerInfo : null,
  };
}

function filterActive(
  active: Readonly<Record<string, PurchasesEntitlementInfo>>,
): Readonly<Record<string, PurchasesEntitlementInfo>> {
  const out: Record<string, PurchasesEntitlementInfo> = {};
  const nowMs = Date.now();
  for (const [key, info] of Object.entries(active)) {
    if (info.isActive !== true) continue;
    if (info.expirationDateMillis !== null && info.expirationDateMillis < nowMs) {
      // Past the expiration date — ignore even though RC put it in
      // the active map. Mirrors RC's own client semantic.
      continue;
    }
    out[key] = info;
  }
  return out;
}
