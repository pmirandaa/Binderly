import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './AuthProvider';

type AuthChangeListener = (
  event: string,
  session: { access_token: string; refresh_token: string; user: { id: string } } | null,
) => void;

type FakeSession = {
  access_token: string;
  refresh_token: string;
  user: { id: string };
} | null;

function buildSupabaseMock(initialSession: FakeSession = null) {
  let listener: AuthChangeListener | null = null;
  const unsubscribe = vi.fn();
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: initialSession }, error: null })),
      onAuthStateChange: vi.fn((cb: AuthChangeListener) => {
        listener = cb;
        return { data: { subscription: { unsubscribe } } };
      }),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  return {
    supabase: supabase as unknown as Parameters<typeof AuthProvider>[0]['supabase'],
    fireAuthEvent: (event: string, session: FakeSession) => {
      listener?.(event, session);
    },
    unsubscribe,
  };
}

describe('<AuthProvider>', () => {
  it('starts with loading: true and a null session', async () => {
    const { supabase } = buildSupabaseMock();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider supabase={supabase}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(true);
    // Wait for async getSession() to resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
  });

  it('hydrates the initial session from supabase.auth.getSession()', async () => {
    const initialSession: FakeSession = {
      access_token: 'jwt',
      refresh_token: 'r',
      user: { id: 'user-1' },
    };
    const { supabase } = buildSupabaseMock(initialSession);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider supabase={supabase}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.session?.access_token).toBe('jwt');
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.loading).toBe(false);
  });

  it('updates on a SIGNED_IN auth change event', async () => {
    const { supabase, fireAuthEvent } = buildSupabaseMock();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider supabase={supabase}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.session).toBeNull();

    act(() => {
      fireAuthEvent('SIGNED_IN', {
        access_token: 'jwt-after-signin',
        refresh_token: 'r',
        user: { id: 'user-2' },
      });
    });
    expect(result.current.session?.access_token).toBe('jwt-after-signin');
    expect(result.current.user?.id).toBe('user-2');
  });

  it('clears state on a SIGNED_OUT event', async () => {
    const initial: FakeSession = {
      access_token: 'jwt',
      refresh_token: 'r',
      user: { id: 'u' },
    };
    const { supabase, fireAuthEvent } = buildSupabaseMock(initial);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider supabase={supabase}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.user).not.toBeNull();
    act(() => {
      fireAuthEvent('SIGNED_OUT', null);
    });
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('exposes a signOut callback that delegates to supabase.auth.signOut', async () => {
    const { supabase } = buildSupabaseMock();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider supabase={supabase}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signOut();
    });
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', async () => {
    const { supabase, unsubscribe } = buildSupabaseMock();
    const { unmount } = render(
      <AuthProvider supabase={supabase}>
        <></>
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('throws when useAuth is called without a provider', () => {
    expect(() => renderHook(() => useAuth())).toThrowError(/<AuthProvider>/);
  });
});
