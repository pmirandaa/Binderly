import { useQueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_STALE_TIME_MS, QueryProvider, createDefaultQueryClient } from './QueryProvider';

import type { ReactNode } from 'react';

describe('QueryProvider', () => {
  it('mounts without throwing and exposes the QueryClient', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryProvider>{children}</QueryProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    expect(result.current).toBeDefined();
  });

  it('uses the provided client instead of creating a new one', () => {
    const explicit = createDefaultQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryProvider client={explicit}>{children}</QueryProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    expect(result.current).toBe(explicit);
  });

  it('createDefaultQueryClient applies the documented defaults', () => {
    const client = createDefaultQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(defaults.queries?.retry).toBe(1);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(0);
  });
});
