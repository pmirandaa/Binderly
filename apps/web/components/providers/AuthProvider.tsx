'use client';

// AuthProvider — exposes Supabase JS auth state via React context.
//
// Subscribes once to `supabase.auth.onAuthStateChange` on mount,
// keeps `{ session, user, loading }` in sync, and surfaces a
// `signOut` action. Real interactive sign-in flows (OAuth,
// magic-link, callback handling) live in T-W-AUTH; this provider
// is the read-side surface every authenticated route reads from.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getBrowserSupabase } from '../../lib/supabase-browser';

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Test seam — pass an explicit Supabase instance to skip the singleton. */
  supabase?: SupabaseClient;
}

export function AuthProvider({ children, supabase }: AuthProviderProps): ReactNode {
  const client = useMemo(() => supabase ?? getBrowserSupabase(), [supabase]);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        await client.auth.signOut();
      },
    }),
    [session, loading, client],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
