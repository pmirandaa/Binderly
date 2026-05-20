// Restore Purchases.
//
// `restorePurchases(queryClient?)`: calls the adapter's
// `restorePurchases()` and surfaces a typed `RestoreResult`. On
// success, optimistically updates the entitlements cache so a
// just-restored user sees their `pro` tier immediately.
//
// **iOS App Store compliance.** Apple requires every IAP-shipping
// app to expose a visible "Restore Purchases" affordance (see
// App Store Review Guideline 3.1.1). The mobile settings screen
// will call into `useRestorePurchases()` when that surface lands
// in a later T-PB-* task; the function ships here so the
// downstream UI work is a thin wrapper.

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { mapCustomerInfoToSnapshot } from './entitlements.js';
import { getBillingAdapter } from './init.js';
import { writeOptimisticEntitlements } from './purchase.js';

import type { RestoreResult } from './types.js';

export async function restorePurchases(queryClient?: QueryClient): Promise<RestoreResult> {
  const adapter = getBillingAdapter();
  try {
    const customerInfo = await adapter.restorePurchases();
    const snapshot = mapCustomerInfoToSnapshot(customerInfo, adapter.isConfigured);
    if (queryClient !== undefined) {
      writeOptimisticEntitlements(queryClient, customerInfo, adapter.isConfigured);
    }
    return { kind: 'success', tier: snapshot.tier, customerInfo };
  } catch (cause) {
    return { kind: 'error', message: describeError(cause) };
  }
}

export function useRestorePurchases(): () => Promise<RestoreResult> {
  const queryClient = useQueryClient();
  return useCallback(() => restorePurchases(queryClient), [queryClient]);
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  if (typeof cause === 'object' && cause !== null) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Restore purchases failed for an unknown reason.';
}
