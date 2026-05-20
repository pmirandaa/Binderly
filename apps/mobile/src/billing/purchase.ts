// Purchase flow.
//
// `purchasePackage(pkg, queryClient?)`:
//
//   1. Calls the adapter's `purchasePackage(pkg)`.
//   2. Maps RC's native rejection shape to `PurchaseResult`:
//      cancelled / payment_pending / payment_invalid /
//      network_error / error. The discriminated union (defined in
//      `./types.ts`) is what feature screens consume — no naked
//      `Error` throws into the UI layer.
//   3. On `success`, optimistically writes the updated entitlements
//      snapshot into TanStack Query so the rest of the app sees
//      the new tier immediately. No server round-trip required —
//      RC has already validated the receipt.
//
// We accept the `QueryClient` as an explicit argument (rather
// than ripping `useQueryClient()` open here) so callers can call
// `purchasePackage(...)` from anywhere — a button handler, a
// service worker, a useEffect — without dragging a hook in. The
// `usePurchasePackage()` wrapper exposes the hook-shaped variant
// for the common case.

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { ENTITLEMENTS_QUERY_KEY, mapCustomerInfoToSnapshot } from './entitlements.js';
import { getBillingAdapter } from './init.js';

import type {
  CustomerInfo,
  PurchaseResult,
  PurchasesPackage,
} from './types.js';

// ============================================================
// Public API
// ============================================================

/**
 * Initiate a purchase. Always resolves with a `PurchaseResult` —
 * never throws into the UI layer. Cancellation is a normal
 * outcome, not an error.
 */
export async function purchasePackage(
  pkg: PurchasesPackage,
  queryClient?: QueryClient,
): Promise<PurchaseResult> {
  const adapter = getBillingAdapter();
  try {
    const result = await adapter.purchasePackage(pkg);
    if (queryClient !== undefined) {
      writeOptimisticEntitlements(queryClient, result.customerInfo, adapter.isConfigured);
    }
    return {
      kind: 'success',
      entitlementId: pickEntitlementId(result.customerInfo),
      productIdentifier: result.productIdentifier,
      customerInfo: result.customerInfo,
    };
  } catch (cause) {
    return mapRevenueCatErrorToResult(cause);
  }
}

/**
 * Hook-flavoured variant of {@link purchasePackage}. Wires the
 * TanStack `QueryClient` automatically so screens don't need to
 * pass it in.
 */
export function usePurchasePackage(): (pkg: PurchasesPackage) => Promise<PurchaseResult> {
  const queryClient = useQueryClient();
  return useCallback(
    (pkg: PurchasesPackage) => purchasePackage(pkg, queryClient),
    [queryClient],
  );
}

// ============================================================
// Optimistic cache update
// ============================================================

/**
 * Write a fresh entitlements snapshot into TanStack Query so any
 * `useEntitlementsQuery()` consumer flips to `pro` immediately.
 * `useOfferings()` cache is intentionally NOT invalidated — the
 * available offerings don't change after a purchase.
 *
 * Exported so tests can assert the cache shape directly.
 */
export function writeOptimisticEntitlements(
  queryClient: QueryClient,
  customerInfo: CustomerInfo,
  fromConfiguredAdapter: boolean,
): void {
  queryClient.setQueryData(
    ENTITLEMENTS_QUERY_KEY,
    mapCustomerInfoToSnapshot(customerInfo, fromConfiguredAdapter),
  );
}

// ============================================================
// Error mapping
// ============================================================

/**
 * Inspect a thrown RC error and map it to a `PurchaseResult`
 * variant. RC's native error shape (per the docs) provides:
 *
 *   - `code`: a `PURCHASES_ERROR_CODE` string ("0", "1", "10", …)
 *   - `userCancelled`: boolean (deprecated but still present)
 *   - `message`: human-readable message
 *
 * We match `userCancelled === true` first (Android sometimes
 * reports cancellations without setting the cancel code, per RC
 * forum threads), then fall back to the `code` switch.
 *
 * Exported for tests; production callers route through
 * `purchasePackage(...)`.
 */
export function mapRevenueCatErrorToResult(cause: unknown): PurchaseResult {
  const message = describeError(cause);
  const errorRecord =
    typeof cause === 'object' && cause !== null ? (cause as Record<string, unknown>) : {};
  if (errorRecord['userCancelled'] === true) {
    return { kind: 'cancelled' };
  }
  const code = errorRecord['code'];
  switch (code) {
    case '1':
    case 1:
      return { kind: 'cancelled' };
    case '10':
    case 10:
    case '35':
    case 35:
      return { kind: 'network_error', message };
    case '20':
    case 20:
      return { kind: 'payment_pending', message };
    case '4':
    case 4:
    case '7':
    case 7:
    case '8':
    case 8:
      return { kind: 'payment_invalid', message };
    default:
      return { kind: 'error', message };
  }
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  if (typeof cause === 'object' && cause !== null) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Purchase failed for an unknown reason.';
}

function pickEntitlementId(customerInfo: CustomerInfo): string {
  // RC marks the entitlement(s) the purchase granted in
  // `entitlements.active`. The post-purchase snapshot usually
  // contains exactly one new entitlement — `'pro'` in our
  // configuration. We pick the first active one as a fallback,
  // because the strict expected value (`'pro'`) is more useful as
  // the *common case* than as a hard-required string.
  const active = customerInfo.entitlements.active;
  const keys = Object.keys(active);
  if (keys.length === 0) {
    return '';
  }
  if (active['pro'] !== undefined) return 'pro';
  return keys[0] ?? '';
}
