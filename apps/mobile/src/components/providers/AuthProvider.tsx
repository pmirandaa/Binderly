// `<AuthProvider>` — owns the Supabase JS auth state subscription
// and exposes a typed `useAuth()` hook that downstream feature
// tasks (T-M-AUTH, T-M-COLLECTION, etc.) program against.
//
// The shell does NOT implement sign-in UI — the mobile sign-in
// screens belong to T-M-AUTH. What lives here is the contract:
//
//   useAuth(): {
//     session: Session | null,
//     user: User | null,
//     loading: boolean,    // true until the SDK reports first state
//     signOut: () => Promise<void>,
//   }
//
// The Supabase JS client is supplied by the parent (constructed
// once in `app/_layout.tsx` and shared with the api-client
// singleton).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

export interface AuthContextValue {
  readonly session: Session | null;
  readonly user: User | null;
  readonly loading: boolean;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  /** The Supabase JS client whose session this provider tracks. */
  supabase: SupabaseClient;
  children: ReactNode;
}

/**
 * Wrap a tree with the auth context. Subscribes to the Supabase
 * SDK's auth-state stream on mount and unsubscribes on unmount.
 * Initial session is hydrated asynchronously — `loading` flips to
 * `false` after the first SDK callback OR the first `getSession`
 * resolution, whichever wins.
 */
export function AuthProvider({ supabase, children }: AuthProviderProps): ReactNode {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setLoading(false);
      });

    const subscription = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.data.subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut,
    }),
    [session, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Read the auth context. Throws when no provider is mounted —
 * surfaces tree-wiring bugs at first call instead of silently
 * returning a stale shape.
 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth(): no <AuthProvider> found in the tree. Mount it in app/_layout.tsx.');
  }
  return value;
}
