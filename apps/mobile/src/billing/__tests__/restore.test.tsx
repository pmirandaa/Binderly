// Tests for restorePurchases + useRestorePurchases.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ENTITLEMENTS_QUERY_KEY,
  isRestoreError,
  isRestoreSuccess,
  resetBillingForTesting,
  restorePurchases,
  setBillingAdapterForTesting,
  useEntitlementsQuery,
  useRestorePurchases,
} from '../index.js';
import {
  createMockAdapter,
  makeCustomerInfo,
  makeEntitlement,
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

describe('restorePurchases', () => {
  it('returns success with tier=pro when restored entitlement is active', async () => {
    mockAdapter.setCustomerInfo(
      makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
    );
    const result = await restorePurchases(queryClient);
    expect(isRestoreSuccess(result)).toBe(true);
    if (result.kind === 'success') {
      expect(result.tier).toBe('pro');
    }
  });

  it('returns success with tier=free when nothing to restore', async () => {
    const result = await restorePurchases(queryClient);
    expect(isRestoreSuccess(result)).toBe(true);
    if (result.kind === 'success') {
      expect(result.tier).toBe('free');
    }
  });

  it('returns error with a typed message on rejection', async () => {
    mockAdapter.setRestoreError(new Error('rc-network'));
    const result = await restorePurchases();
    expect(isRestoreError(result)).toBe(true);
    if (result.kind === 'error') {
      expect(result.message).toBe('rc-network');
    }
  });

  it('handles non-Error throws', async () => {
    mockAdapter.setRestoreError({ message: 'plain object' });
    const result = await restorePurchases();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toBe('plain object');
  });

  it('seeds the entitlements cache when a queryClient is passed', async () => {
    mockAdapter.setCustomerInfo(
      makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
    );
    await restorePurchases(queryClient);
    const cached = queryClient.getQueryData(ENTITLEMENTS_QUERY_KEY) as {
      tier: string;
    };
    expect(cached.tier).toBe('pro');
  });

  it('does NOT seed the cache when queryClient is omitted', async () => {
    mockAdapter.setCustomerInfo(
      makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
    );
    await restorePurchases();
    expect(queryClient.getQueryData(ENTITLEMENTS_QUERY_KEY)).toBeUndefined();
  });
});

describe('useRestorePurchases', () => {
  it('flips useEntitlementsQuery to pro on a successful restore', async () => {
    const { result } = renderHook(
      () => ({ restore: useRestorePurchases(), entitlements: useEntitlementsQuery() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.entitlements.isSuccess).toBe(true));
    expect(result.current.entitlements.data?.tier).toBe('free');

    mockAdapter.setCustomerInfo(
      makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
    );
    await act(async () => {
      const r = await result.current.restore();
      expect(r.kind).toBe('success');
    });
    await waitFor(() =>
      expect(result.current.entitlements.data?.tier).toBe('pro'),
    );
  });
});
