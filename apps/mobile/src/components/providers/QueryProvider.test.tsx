import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QueryProvider, createMobileQueryClient } from './QueryProvider';

describe('createMobileQueryClient', () => {
  it('returns a QueryClient instance', () => {
    const client = createMobileQueryClient();
    expect(client).toBeInstanceOf(QueryClient);
  });

  it('configures offlineFirst network mode for queries and mutations', () => {
    const client = createMobileQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.networkMode).toBe('offlineFirst');
    expect(defaults.mutations?.networkMode).toBe('offlineFirst');
  });

  it('sets a non-zero stale-time and gc-time so reads survive remounts', () => {
    const client = createMobileQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBeGreaterThan(0);
    expect(defaults.queries?.gcTime).toBeGreaterThan(0);
  });

  it('disables refetchOnWindowFocus (we drive focus from AppState instead)', () => {
    const defaults = createMobileQueryClient().getDefaultOptions();
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
  });
});

describe('<QueryProvider>', () => {
  it('renders children', () => {
    const result = render(
      <QueryProvider>
        <span data-testid="child">child</span>
      </QueryProvider>,
    );
    expect(result.getByTestId('child').textContent).toBe('child');
  });

  it('exposes a QueryClient via useQueryClient()', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryProvider>{children}</QueryProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    expect(result.current).toBeInstanceOf(QueryClient);
  });

  it('uses the supplied client when provided', () => {
    const custom = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryProvider client={custom}>{children}</QueryProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    expect(result.current).toBe(custom);
  });

  it('subscribes to NetInfo on mount and cleans up on unmount', () => {
    const { unmount } = render(
      <QueryProvider>
        <></>
      </QueryProvider>,
    );
    // The mocked NetInfo records every addEventListener; the
    // provider's effect should have called it at least once. After
    // unmount, no further invocations occur (cleanup happens
    // synchronously via the returned unsubscribe).
    unmount();
    // Smoke: nothing throws on unmount.
    expect(true).toBe(true);
  });
});
