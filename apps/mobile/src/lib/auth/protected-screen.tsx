// `<ProtectedScreen>` + `useRequireAuth()` — declarative auth
// gating for any screen that requires a signed-in user.
//
// The contract feature tasks downstream program against:
//
//   <ProtectedScreen>
//     <CollectionScreen />
//   </ProtectedScreen>
//
// While `useAuth().loading === true`, we render a fallback (a
// `<PageLoading>` from M-SHELL by default — overridable). Once
// loading resolves, an authenticated user sees `children`; an
// unauthenticated one is redirected to `/auth/sign-in`.
//
// The redirect runs from inside `useEffect` (NOT during render)
// because `expo-router`'s `router.replace` mutates navigation
// state, and React refuses side effects in render. We also gate on
// `loading === false` so the boot path doesn't briefly bounce to
// /sign-in while the SDK hydrates the persisted session.

import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';

import { PageLoading } from '../../components/loading/PageLoading.js';
import { useAuth } from '../../components/providers/AuthProvider.js';

/** Default landing route when an unauthenticated user trips the guard. */
export const DEFAULT_SIGN_IN_ROUTE = '/auth/sign-in';

export interface ProtectedScreenProps {
  /** The protected content. Rendered only when a session exists. */
  readonly children: ReactNode;
  /** Override the redirect target. Defaults to `/auth/sign-in`. */
  readonly redirectTo?: string;
  /** Optional fallback rendered while the auth context is loading. */
  readonly loadingFallback?: ReactNode;
}

/**
 * Wrap any screen with this component to require a signed-in user.
 * Redirects to `/auth/sign-in` (overridable) when no session is
 * present and the auth context has finished hydrating.
 */
export function ProtectedScreen(props: ProtectedScreenProps): ReactNode {
  const { children, redirectTo = DEFAULT_SIGN_IN_ROUTE, loadingFallback } = props;
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (session === null) {
      router.replace(redirectTo as never);
    }
  }, [loading, session, router, redirectTo]);

  if (loading || session === null) {
    return loadingFallback ?? <PageLoading />;
  }
  return <>{children}</>;
}

/**
 * Hook variant for callers that prefer to assert auth imperatively
 * (for example, inside a tab layout that needs to gate every
 * child). Triggers the same `router.replace` redirect when the
 * session resolves to `null` after hydration.
 *
 * Returns the live auth context so callers can branch on
 * `loading` / `session` without a second `useAuth()` call.
 */
export function useRequireAuth(redirectTo: string = DEFAULT_SIGN_IN_ROUTE): {
  readonly loading: boolean;
  readonly authenticated: boolean;
} {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (session === null) {
      router.replace(redirectTo as never);
    }
  }, [loading, session, router, redirectTo]);

  return {
    loading,
    authenticated: !loading && session !== null,
  };
}
