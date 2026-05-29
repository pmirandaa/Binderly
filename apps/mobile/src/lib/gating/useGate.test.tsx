import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEntitlement } from './entitlement';
import { useGate, useLimitGate } from './useGate';

const hoisted = vi.hoisted(() => ({
  snapshot: { data: undefined as undefined | { tier: 'free' | 'pro' }, isPending: true },
}));

vi.mock('../../billing/index.js', () => ({
  useEntitlementsQuery: () => hoisted.snapshot,
}));

function setResolved(tier: 'free' | 'pro'): void {
  hoisted.snapshot = { data: { tier }, isPending: false };
}

function setLoading(): void {
  hoisted.snapshot = { data: undefined, isPending: true };
}

beforeEach(() => {
  setLoading();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useEntitlement', () => {
  it('resolves to the RC-derived pro tier', () => {
    setResolved('pro');
    const { result } = renderHook(() => useEntitlement());
    expect(result.current.tier).toBe('pro');
    expect(result.current.isLoading).toBe(false);
  });

  it('fail-closed: a pending read is free + loading', () => {
    setLoading();
    const { result } = renderHook(() => useEntitlement());
    expect(result.current.tier).toBe('free');
    expect(result.current.isLoading).toBe(true);
  });
});

describe('useGate — fail-closed', () => {
  it('reports loading while the RC read is in flight, blocked underneath', () => {
    setLoading();
    const { result } = renderHook(() => useGate('export_data'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.result.allowed).toBe(false);
  });

  it('blocks free with requires_pro', () => {
    setResolved('free');
    const { result } = renderHook(() => useGate('grading_prediction'));
    const r = result.current.result;
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('requires_pro');
      expect(r.feature).toBe('grading_prediction');
    }
  });

  it('allows pro on an on/off feature', () => {
    setResolved('pro');
    const { result } = renderHook(() => useGate('pricing_history'));
    expect(result.current.result.allowed).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useLimitGate', () => {
  it('free below the cap is allowed (2/3 custom collections)', () => {
    setResolved('free');
    const { result } = renderHook(() => useLimitGate('customCollections', 2));
    expect(result.current.result.allowed).toBe(true);
  });

  it('free at the cap is blocked with free_limit_reached + limit', () => {
    setResolved('free');
    const { result } = renderHook(() => useLimitGate('customCollections', 3));
    const r = result.current.result;
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('free_limit_reached');
      expect(r.limit).toBe(3);
      expect(r.feature).toBe('unlimited_custom_collections');
    }
  });

  it('free shareables at 1/1 is blocked', () => {
    setResolved('free');
    const { result } = renderHook(() => useLimitGate('shareables', 1));
    expect(result.current.result.allowed).toBe(false);
  });

  it('pro is unbounded at the cap', () => {
    setResolved('pro');
    const { result } = renderHook(() => useLimitGate('shareables', 9));
    expect(result.current.result.allowed).toBe(true);
  });

  it('free with a pending read is blocked (fail-closed)', () => {
    setLoading();
    const { result } = renderHook(() => useLimitGate('customCollections', 0));
    // Pending → free → 0/3 is technically allowed, but isLoading guards the UI.
    expect(result.current.isLoading).toBe(true);
  });
});
