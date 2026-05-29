import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntitlementsDto } from '@binderly/api-contracts';

import { useEntitlement } from './entitlement';
import { useGate, useLimitGate } from './useGate';

import type { ReactNode } from 'react';

const hoisted = vi.hoisted(() => ({
  authState: {
    user: null as null | { id: string },
    loading: false,
    session: null,
    signOut: () => Promise.resolve(),
  },
  getMyEntitlements: vi.fn(),
}));

vi.mock('../../components/providers/AuthProvider', () => ({
  useAuth: () => hoisted.authState,
}));

vi.mock('../api-client', () => ({
  getApiClient: () => ({ entitlements: { getMyEntitlements: hoisted.getMyEntitlements } }),
}));

function dto(tier: 'free' | 'pro'): EntitlementsDto {
  return {
    tier,
    activeFeatures:
      tier === 'pro'
        ? ['stack_scanner', 'export_data', 'pricing_history', 'grading_prediction']
        : [],
    source: 'revenuecat',
    checkedAt: '2026-05-29T00:00:00.000Z',
  } as EntitlementsDto;
}

function setSignedIn(): void {
  hoisted.authState = {
    user: { id: 'u1' },
    loading: false,
    session: null,
    signOut: () => Promise.resolve(),
  };
}

function setSignedOut(loading = false): void {
  hoisted.authState = {
    user: null,
    loading,
    session: null,
    signOut: () => Promise.resolve(),
  };
}

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

beforeEach(() => {
  hoisted.getMyEntitlements.mockReset();
  setSignedOut();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useGate — fail-closed', () => {
  it('signed-out user is blocked (free) and not loading', () => {
    setSignedOut();
    const { result } = renderHook(() => useGate('export_data'), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.result.allowed).toBe(false);
    expect(hoisted.getMyEntitlements).not.toHaveBeenCalled();
  });

  it('reports loading while auth is still resolving', () => {
    setSignedOut(true);
    const { result } = renderHook(() => useGate('export_data'), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
    // Still fail-closed under the skeleton.
    expect(result.current.result.allowed).toBe(false);
  });

  it('reports loading while the entitlement read is in flight, blocked underneath', async () => {
    setSignedIn();
    let resolve: (v: EntitlementsDto) => void = () => undefined;
    hoisted.getMyEntitlements.mockReturnValue(
      new Promise<EntitlementsDto>((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useGate('export_data'), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.result.allowed).toBe(false);
    resolve(dto('pro'));
    await waitFor(() => expect(result.current.result.allowed).toBe(true));
  });

  it('a read failure degrades to free (blocked), never throws', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useGate('export_data'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.result.allowed).toBe(false);
    if (!result.current.result.allowed) {
      expect(result.current.result.reason).toBe('requires_pro');
    }
  });
});

describe('useGate — resolved tiers', () => {
  it('pro unlocks an on/off feature', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockResolvedValue(dto('pro'));
    const { result } = renderHook(() => useGate('pricing_history'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.result.allowed).toBe(true));
  });

  it('free is blocked on an on/off feature with requires_pro', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockResolvedValue(dto('free'));
    const { result } = renderHook(() => useGate('grading_prediction'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const r = result.current.result;
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('requires_pro');
      expect(r.feature).toBe('grading_prediction');
    }
  });
});

describe('useLimitGate', () => {
  it('free below the cap is allowed (2/3 custom collections)', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockResolvedValue(dto('free'));
    const { result } = renderHook(() => useLimitGate('customCollections', 2), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.result.allowed).toBe(true);
  });

  it('free at the cap is blocked with free_limit_reached + limit', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockResolvedValue(dto('free'));
    const { result } = renderHook(() => useLimitGate('customCollections', 3), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const r = result.current.result;
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('free_limit_reached');
      expect(r.limit).toBe(3);
      expect(r.feature).toBe('unlimited_custom_collections');
    }
  });

  it('pro is unbounded at the cap', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockResolvedValue(dto('pro'));
    const { result } = renderHook(() => useLimitGate('shareables', 5), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.result.allowed).toBe(true));
  });

  it('free shareables at 1/1 is blocked', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockResolvedValue(dto('free'));
    const { result } = renderHook(() => useLimitGate('shareables', 1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.result.allowed).toBe(false);
  });
});

describe('useEntitlement', () => {
  it('returns the resolved pro tier + revenuecat source', async () => {
    setSignedIn();
    hoisted.getMyEntitlements.mockResolvedValue(dto('pro'));
    const { result } = renderHook(() => useEntitlement(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.tier).toBe('pro'));
    expect(result.current.source).toBe('revenuecat');
    expect(result.current.isLoading).toBe(false);
  });

  it('signed-out resolves to a free fallback', () => {
    setSignedOut();
    const { result } = renderHook(() => useEntitlement(), { wrapper: wrapper() });
    expect(result.current.tier).toBe('free');
    expect(result.current.source).toBe('fallback');
  });
});
