// Mobile entitlement read for gating.
//
// Per `rules/10-paywall-billing.md`, **mobile reads RevenueCat directly**
// (the device SDK is the source of truth on-device), so gating reads the
// tier from the billing module's `useEntitlementsQuery()` (RC
// `getCustomerInfo`) rather than the `GET /v1/me/entitlements` HTTP
// endpoint web uses. The verdict is identical — both resolve the same
// `'free' | 'pro'` tier — but mobile avoids a redundant network hop and
// stays correct offline (RC caches the customer info).
//
// Fail-closed: while the RC read is pending or errored, `tier` resolves to
// `'free'` so a gate never over-grants during a flash.

import type { Tier } from '@binderly/entitlements';

import { useEntitlementsQuery } from '../../billing/index.js';

/** Resolved entitlement state the gating hooks feed into `@binderly/feature-flags`. */
export interface EntitlementState {
  readonly tier: Tier;
  /**
   * `true` while the RC read is still resolving. Consumers render the gated
   * skeleton — never the unlocked content — until this clears.
   */
  readonly isLoading: boolean;
}

/**
 * Resolve the current user's entitlement state for gating. Fail-closed:
 * a missing/in-flight/errored read resolves to free.
 */
export function useEntitlement(): EntitlementState {
  const query = useEntitlementsQuery();
  const tier: Tier = query.data?.tier ?? 'free';
  return { tier, isLoading: query.isPending };
}
