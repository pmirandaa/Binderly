// Tests for `mapCustomerInfoToSnapshot`, `useEntitlementsQuery`,
// `usePaidFeature`, and the cache invalidator.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ENTITLEMENTS_QUERY_KEY,
  mapCustomerInfoToSnapshot,
  resetBillingForTesting,
  setBillingAdapterForTesting,
  useEntitlementsQuery,
  useInvalidateEntitlements,
  usePaidFeature,
  type PaidFeature,
} from '../index.js';
import { ALL_PAID_FEATURES } from '../types.js';
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

// ============================================================
// mapCustomerInfoToSnapshot — pure derivation
// ============================================================

describe('mapCustomerInfoToSnapshot', () => {
  it('returns tier=free when there are no active entitlements', () => {
    const snap = mapCustomerInfoToSnapshot(makeCustomerInfo(), true);
    expect(snap.tier).toBe('free');
    expect(snap.activeEntitlements).toEqual({});
  });

  it('returns tier=pro when the pro entitlement is active', () => {
    const snap = mapCustomerInfoToSnapshot(
      makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
      true,
    );
    expect(snap.tier).toBe('pro');
    expect(snap.activeEntitlements['pro']?.identifier).toBe('pro');
  });

  it('returns tier=free when only a non-pro entitlement is active', () => {
    const snap = mapCustomerInfoToSnapshot(
      makeCustomerInfo({
        active: [makeEntitlement({ identifier: 'beta_tester' })],
      }),
      true,
    );
    expect(snap.tier).toBe('free');
    expect(snap.activeEntitlements['beta_tester']).toBeDefined();
  });

  it('preserves multiple active entitlements in the map', () => {
    const snap = mapCustomerInfoToSnapshot(
      makeCustomerInfo({
        active: [
          makeEntitlement({ identifier: 'pro' }),
          makeEntitlement({ identifier: 'team' }),
        ],
      }),
      true,
    );
    expect(snap.tier).toBe('pro');
    expect(Object.keys(snap.activeEntitlements).sort()).toEqual(['pro', 'team']);
  });

  it('ignores entitlements whose expiration is in the past', () => {
    const past = Date.now() - 60_000;
    const snap = mapCustomerInfoToSnapshot(
      makeCustomerInfo({
        active: [
          makeEntitlement({
            identifier: 'pro',
            expirationDateMillis: past,
            expirationDate: new Date(past).toISOString(),
          }),
        ],
      }),
      true,
    );
    expect(snap.tier).toBe('free');
    expect(snap.activeEntitlements).toEqual({});
  });

  it('keeps lifetime grants (expirationDateMillis === null)', () => {
    const snap = mapCustomerInfoToSnapshot(
      makeCustomerInfo({
        active: [
          makeEntitlement({
            identifier: 'pro',
            expirationDate: null,
            expirationDateMillis: null,
          }),
        ],
      }),
      true,
    );
    expect(snap.tier).toBe('pro');
  });

  it('ignores entitlements with isActive === false', () => {
    const snap = mapCustomerInfoToSnapshot(
      makeCustomerInfo({
        active: [makeEntitlement({ identifier: 'pro', isActive: false })],
      }),
      true,
    );
    expect(snap.tier).toBe('free');
  });

  it('passes customerInfo through when adapter is configured', () => {
    const info = makeCustomerInfo();
    const snap = mapCustomerInfoToSnapshot(info, true);
    expect(snap.customerInfo).toBe(info);
  });

  it('hides customerInfo in stub-mode (fromConfiguredAdapter=false)', () => {
    const info = makeCustomerInfo();
    const snap = mapCustomerInfoToSnapshot(info, false);
    expect(snap.customerInfo).toBeNull();
  });
});

// ============================================================
// useEntitlementsQuery
// ============================================================

describe('useEntitlementsQuery', () => {
  it('resolves to tier=free for a fresh user', async () => {
    const { result } = renderHook(() => useEntitlementsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tier).toBe('free');
  });

  it('resolves to tier=pro when the pro entitlement is granted', async () => {
    mockAdapter.setCustomerInfo(
      makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
    );
    const { result } = renderHook(() => useEntitlementsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tier).toBe('pro');
    expect(result.current.data?.activeEntitlements['pro']).toBeDefined();
  });

  it('routes through the adapter exactly once per stale window', async () => {
    const { result, rerender } = renderHook(() => useEntitlementsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();
    rerender();
    expect(mockAdapter.getCustomerInfo).toHaveBeenCalledTimes(1);
  });

  it('reflects an externally-mutated cache after invalidation', async () => {
    const { result } = renderHook(() => useEntitlementsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tier).toBe('free');

    mockAdapter.setCustomerInfo(
      makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
    });
    await waitFor(() => expect(result.current.data?.tier).toBe('pro'));
  });

  it('surfaces errors via isError', async () => {
    // `useEntitlementsQuery` requests `retry: 1` — that overrides
    // the queryClient's `retry: false` default, so we must reject
    // for every attempt rather than `mockRejectedValueOnce`.
    mockAdapter.getCustomerInfo.mockRejectedValue(new Error('rc-network'));
    const { result } = renderHook(() => useEntitlementsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(result.current.error?.message).toMatch(/rc-network/);
  });
});

// ============================================================
// usePaidFeature
// ============================================================

describe('usePaidFeature', () => {
  it.each(ALL_PAID_FEATURES)(
    'returns false for "%s" when tier is free',
    async (feature) => {
      const { result } = renderHook(() => usePaidFeature(feature as PaidFeature), { wrapper });
      await waitFor(() => expect(result.current).toBe(false));
    },
  );

  it.each(ALL_PAID_FEATURES)(
    'returns true for "%s" when tier is pro',
    async (feature) => {
      mockAdapter.setCustomerInfo(
        makeCustomerInfo({ active: [makeEntitlement({ identifier: 'pro' })] }),
      );
      const { result } = renderHook(() => usePaidFeature(feature as PaidFeature), { wrapper });
      await waitFor(() => expect(result.current).toBe(true));
    },
  );

  it('shares the entitlements cache with useEntitlementsQuery (no double-fetch)', async () => {
    const { result } = renderHook(
      () => ({
        ent: useEntitlementsQuery(),
        custom: usePaidFeature('unlimited_custom_collections'),
        scanner: usePaidFeature('stack_scanner'),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.ent.isSuccess).toBe(true));
    expect(mockAdapter.getCustomerInfo).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// useInvalidateEntitlements
// ============================================================

describe('useInvalidateEntitlements', () => {
  it('triggers a refetch the next time the query runs', async () => {
    const { result } = renderHook(
      () => ({
        ent: useEntitlementsQuery(),
        invalidate: useInvalidateEntitlements(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.ent.isSuccess).toBe(true));
    await act(async () => {
      await result.current.invalidate();
    });
    expect(mockAdapter.getCustomerInfo.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
