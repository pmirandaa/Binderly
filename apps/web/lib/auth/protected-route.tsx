'use client';

// `<ProtectedRoute>` — declarative client-side auth gate.
//
// Wrap any subtree that requires a signed-in user. While
// `useAuth().loading === true`, the wrapper renders a `fallback`
// (defaults to a `<Spinner>`-flavoured placeholder) so the user
// never sees protected content flash before the session
// resolves. Once `loading === false`:
//   - signed in → render children
//   - signed out → call `router.replace(buildSignInUrl(currentPath))`
//     and render `null` until the browser navigates.
//
// The middleware does a best-effort cookie sniff before this
// component ever mounts; this wrapper is the definitive gate
// because it has access to the live Supabase JS session
// (which lives in localStorage by default and isn't visible to
// edge middleware).

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Spinner, Text, YStack } from '@binderly/ui';

import { buildSignInUrl } from './redirect';
import { useAuth } from '../../components/providers/AuthProvider';

export interface ProtectedRouteProps {
  /** The protected subtree. Rendered only when authenticated. */
  children: ReactNode;
  /**
   * Optional render slot shown while the session is still
   * loading. Defaults to a centred spinner.
   */
  fallback?: ReactNode;
}

function DefaultFallback(): ReactNode {
  return (
    <YStack
      padding="$6"
      gap="$3"
      alignItems="center"
      justifyContent="center"
      data-testid="protected-route-loading"
    >
      <Spinner size="md" aria-label="Loading session" />
      <Text variant="body" tone="muted">
        Checking your session…
      </Text>
    </YStack>
  );
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps): ReactNode {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;
    if (session !== null) return;
    const query = searchParams?.toString();
    const current =
      pathname !== null && pathname !== ''
        ? query !== undefined && query !== ''
          ? `${pathname}?${query}`
          : pathname
        : '/';
    router.replace(buildSignInUrl(current));
  }, [loading, session, router, pathname, searchParams]);

  if (loading) return fallback ?? <DefaultFallback />;
  if (session === null) return null;
  return <>{children}</>;
}
