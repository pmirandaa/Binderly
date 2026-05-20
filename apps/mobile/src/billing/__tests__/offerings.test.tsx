// Tests for the offerings hook + dev-mode sentinel.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetBillingForTesting,
  setBillingAdapterForTesting,
  useOfferings,
} from '../index.js';
import { createMockAdapter, makeOfferings, type MockPurchasesAdapter } from './_fixtures.js';

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

describe('useOfferings', () => {
  it('returns the current offering and full map', async () => {
    mockAdapter.setOfferings(makeOfferings());
    const { result } = renderHook(() => useOfferings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.current?.identifier).toBe('default');
    expect(result.current.data?.all['default']?.availablePackages).toHaveLength(2);
  });

  it('resolves to current=null when no offering is configured (dev-mode sentinel)', async () => {
    const { result } = renderHook(() => useOfferings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.current).toBeNull();
    expect(result.current.data?.all).toEqual({});
  });

  it('only invokes the adapter once per stale window', async () => {
    mockAdapter.setOfferings(makeOfferings());
    const { result, rerender } = renderHook(() => useOfferings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();
    rerender();
    expect(mockAdapter.getOfferings).toHaveBeenCalledTimes(1);
  });

  it('returns a defensive clone of the all-offerings map', async () => {
    const offerings = makeOfferings();
    mockAdapter.setOfferings(offerings);
    const { result } = renderHook(() => useOfferings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.all).not.toBe(offerings.all);
    expect(result.current.data?.all['default']).toBe(offerings.all['default']);
  });

  it('surfaces errors via isError', async () => {
    // `useOfferings` requests `retry: 1` per-query, overriding the
    // queryClient's `retry: false` default; both attempts must
    // reject to land in the error branch.
    mockAdapter.getOfferings.mockRejectedValue(new Error('rc-offline'));
    const { result } = renderHook(() => useOfferings(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(result.current.error?.message).toMatch(/rc-offline/);
  });
});
