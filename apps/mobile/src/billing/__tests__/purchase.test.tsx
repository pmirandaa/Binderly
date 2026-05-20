// Tests for the purchase flow: success/cancel/error mapping +
// optimistic cache update.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ENTITLEMENTS_QUERY_KEY,
  isPurchaseCancelled,
  isPurchaseNetworkError,
  isPurchasePaymentInvalid,
  isPurchasePending,
  isPurchaseSuccess,
  isPurchaseUnknownError,
  mapRevenueCatErrorToResult,
  purchasePackage,
  resetBillingForTesting,
  setBillingAdapterForTesting,
  useEntitlementsQuery,
  usePurchasePackage,
  writeOptimisticEntitlements,
} from '../index.js';
import {
  createMockAdapter,
  makeCustomerInfo,
  makeEntitlement,
  makePackage,
  type MockPurchasesAdapter,
} from './_fixtures.js';

let mockAdapter: MockPurchasesAdapter;
let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetBillingForTesting();
  mockAdapter = createMockAdapter();
  setBillingAdapterForTesting(mockAdapter);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  resetBillingForTesting();
  queryClient.clear();
});

// ============================================================
// mapRevenueCatErrorToResult — pure
// ============================================================

describe('mapRevenueCatErrorToResult', () => {
  it('maps userCancelled=true to cancelled', () => {
    const result = mapRevenueCatErrorToResult({
      userCancelled: true,
      code: '0',
      message: 'cancelled',
    });
    expect(isPurchaseCancelled(result)).toBe(true);
  });

  it('maps code "1" (PURCHASE_CANCELLED_ERROR) to cancelled', () => {
    const result = mapRevenueCatErrorToResult({ code: '1', message: 'cancel' });
    expect(isPurchaseCancelled(result)).toBe(true);
  });

  it('maps numeric code 1 to cancelled', () => {
    const result = mapRevenueCatErrorToResult({ code: 1, message: 'cancel' });
    expect(isPurchaseCancelled(result)).toBe(true);
  });

  it('maps code "10" (NETWORK_ERROR) to network_error', () => {
    const result = mapRevenueCatErrorToResult({ code: '10', message: 'no internet' });
    expect(result.kind).toBe('network_error');
    expect(isPurchaseNetworkError(result)).toBe(true);
    if (result.kind === 'network_error') {
      expect(result.message).toBe('no internet');
    }
  });

  it('maps code "35" (OFFLINE_CONNECTION_ERROR) to network_error', () => {
    const result = mapRevenueCatErrorToResult({ code: '35', message: 'offline' });
    expect(result.kind).toBe('network_error');
  });

  it('maps code "20" (PAYMENT_PENDING_ERROR) to payment_pending', () => {
    const result = mapRevenueCatErrorToResult({ code: '20', message: 'pending' });
    expect(isPurchasePending(result)).toBe(true);
    if (result.kind === 'payment_pending') {
      expect(result.message).toBe('pending');
    }
  });

  it('maps codes "4" / "7" / "8" to payment_invalid', () => {
    for (const code of ['4', '7', '8']) {
      const result = mapRevenueCatErrorToResult({ code, message: `code-${code}` });
      expect(result.kind).toBe('payment_invalid');
      expect(isPurchasePaymentInvalid(result)).toBe(true);
    }
  });

  it('maps unknown codes to "error" with the message preserved', () => {
    const result = mapRevenueCatErrorToResult({ code: '999', message: 'mystery' });
    expect(result.kind).toBe('error');
    expect(isPurchaseUnknownError(result)).toBe(true);
    if (result.kind === 'error') {
      expect(result.message).toBe('mystery');
    }
  });

  it('handles thrown Error instances', () => {
    const result = mapRevenueCatErrorToResult(new Error('boom'));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toBe('boom');
  });

  it('handles thrown strings', () => {
    const result = mapRevenueCatErrorToResult('string-error');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toBe('string-error');
  });

  it('handles null gracefully', () => {
    const result = mapRevenueCatErrorToResult(null);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/unknown reason/);
  });
});

// ============================================================
// purchasePackage — happy path
// ============================================================

describe('purchasePackage', () => {
  it('returns success with the pro entitlement when granted', async () => {
    const info = makeCustomerInfo({
      active: [makeEntitlement({ identifier: 'pro' })],
    });
    mockAdapter.setPurchaseSuccess({
      customerInfo: info,
      productIdentifier: 'binderly_pro_monthly',
    });
    const pkg = makePackage();
    const result = await purchasePackage(pkg, queryClient);
    expect(isPurchaseSuccess(result)).toBe(true);
    if (result.kind === 'success') {
      expect(result.entitlementId).toBe('pro');
      expect(result.productIdentifier).toBe('binderly_pro_monthly');
      expect(result.customerInfo).toBe(info);
    }
  });

  it('falls back to the first active entitlement when "pro" not present', async () => {
    mockAdapter.setPurchaseSuccess({
      customerInfo: makeCustomerInfo({
        active: [makeEntitlement({ identifier: 'beta' })],
      }),
      productIdentifier: 'binderly_beta',
    });
    const result = await purchasePackage(makePackage(), queryClient);
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.entitlementId).toBe('beta');
  });

  it('returns empty entitlementId when nothing is active (degenerate)', async () => {
    mockAdapter.setPurchaseSuccess({
      customerInfo: makeCustomerInfo(),
      productIdentifier: 'p',
    });
    const result = await purchasePackage(makePackage(), queryClient);
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.entitlementId).toBe('');
  });

  it('maps a user-cancelled rejection to cancelled', async () => {
    mockAdapter.setPurchaseError({ userCancelled: true, code: '1', message: 'cancel' });
    const result = await purchasePackage(makePackage());
    expect(isPurchaseCancelled(result)).toBe(true);
  });

  it('maps a network rejection to network_error', async () => {
    mockAdapter.setPurchaseError({ code: '10', message: 'no internet' });
    const result = await purchasePackage(makePackage());
    expect(result.kind).toBe('network_error');
  });

  it('maps a payment_pending rejection', async () => {
    mockAdapter.setPurchaseError({ code: '20', message: 'pending' });
    const result = await purchasePackage(makePackage());
    expect(result.kind).toBe('payment_pending');
  });

  it('maps a payment_invalid rejection', async () => {
    mockAdapter.setPurchaseError({ code: '4', message: 'invalid' });
    const result = await purchasePackage(makePackage());
    expect(result.kind).toBe('payment_invalid');
  });

  it('does NOT touch the cache on a non-success result', async () => {
    queryClient.setQueryData(ENTITLEMENTS_QUERY_KEY, { tier: 'free' });
    mockAdapter.setPurchaseError({ code: '1', message: 'cancel' });
    await purchasePackage(makePackage(), queryClient);
    expect(queryClient.getQueryData(ENTITLEMENTS_QUERY_KEY)).toEqual({ tier: 'free' });
  });
});

// ============================================================
// Optimistic cache update
// ============================================================

describe('writeOptimisticEntitlements', () => {
  it('seeds the entitlements cache with a tier=pro snapshot', () => {
    const info = makeCustomerInfo({
      active: [makeEntitlement({ identifier: 'pro' })],
    });
    writeOptimisticEntitlements(queryClient, info, true);
    const cached = queryClient.getQueryData(ENTITLEMENTS_QUERY_KEY) as {
      tier: string;
    };
    expect(cached.tier).toBe('pro');
  });

  it('seeds tier=free for a CustomerInfo with no active entitlements', () => {
    writeOptimisticEntitlements(queryClient, makeCustomerInfo(), true);
    const cached = queryClient.getQueryData(ENTITLEMENTS_QUERY_KEY) as {
      tier: string;
    };
    expect(cached.tier).toBe('free');
  });
});

// ============================================================
// usePurchasePackage — hook
// ============================================================

describe('usePurchasePackage', () => {
  it('updates useEntitlementsQuery synchronously after a successful purchase', async () => {
    const { result } = renderHook(
      () => ({ purchase: usePurchasePackage(), entitlements: useEntitlementsQuery() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.entitlements.isSuccess).toBe(true));
    expect(result.current.entitlements.data?.tier).toBe('free');

    mockAdapter.setPurchaseSuccess({
      customerInfo: makeCustomerInfo({
        active: [makeEntitlement({ identifier: 'pro' })],
      }),
      productIdentifier: 'binderly_pro_monthly',
    });
    await act(async () => {
      await result.current.purchase(makePackage());
    });
    await waitFor(() =>
      expect(result.current.entitlements.data?.tier).toBe('pro'),
    );
  });
});
