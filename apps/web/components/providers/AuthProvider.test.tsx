import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Text } from '@binderly/ui';

import { AuthProvider, useAuth } from './AuthProvider';
import { createFakeSupabase } from '../../test-utils/supabase-stub';

import type { Session } from '@supabase/supabase-js';
import type { ReactNode } from 'react';

function AuthReadout(): ReactNode {
  const { session, user, loading } = useAuth();
  return (
    <>
      <Text data-testid="loading">{loading ? 'loading' : 'idle'}</Text>
      <Text data-testid="session">{session === null ? 'none' : 'present'}</Text>
      <Text data-testid="user">{user === null ? 'anon' : (user.email ?? 'anon')}</Text>
    </>
  );
}

describe('AuthProvider', () => {
  it('exposes a context with session=null and loading=false after init', async () => {
    const fake = createFakeSupabase(null);
    render(
      <AuthProvider supabase={fake.client}>
        <AuthReadout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('idle');
    });
    expect(screen.getByTestId('session')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('anon');
  });

  it('subscribes to auth state changes and updates session', async () => {
    const fake = createFakeSupabase(null);
    render(
      <AuthProvider supabase={fake.client}>
        <AuthReadout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('idle');
    });
    expect(fake.onAuthStateChange).toHaveBeenCalledTimes(1);
    const fakeSession = {
      access_token: 't',
      refresh_token: 'r',
      expires_in: 3600,
      token_type: 'bearer',
      user: {
        id: 'u',
        email: 'a@b.co',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: '2025-01-01T00:00:00Z',
      },
    } as unknown as Session;
    act(() => fake.emit(fakeSession));
    await waitFor(() => {
      expect(screen.getByTestId('session')).toHaveTextContent('present');
    });
    expect(screen.getByTestId('user')).toHaveTextContent('a@b.co');
  });

  it('signOut delegates to the supabase client', async () => {
    const fake = createFakeSupabase(null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider supabase={fake.client}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.signOut();
    });
    expect(fake.signOut).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from auth state changes on unmount', async () => {
    const fake = createFakeSupabase(null);
    const { unmount } = render(
      <AuthProvider supabase={fake.client}>
        <AuthReadout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(fake.onAuthStateChange).toHaveBeenCalledTimes(1);
    });
    const subscription = fake.onAuthStateChange.mock.results[0]?.value?.data?.subscription;
    expect(subscription).toBeDefined();
    unmount();
    // No assertion failure means cleanup didn't throw; emit is now a no-op.
    act(() => fake.emit(null));
  });

  it('throws if useAuth is called outside the provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/useAuth must be used inside <AuthProvider>/);
  });
});
