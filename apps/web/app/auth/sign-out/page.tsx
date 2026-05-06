'use client';

// Sign-out page.
//
// Triggers `AuthProvider.signOut()` once on mount, then
// redirects to `/`. The provider's signOut delegates to
// `supabase.auth.signOut()` which clears the persisted session
// and notifies the AuthProvider's `onAuthStateChange`
// subscriber so the rest of the app updates immediately.
//
// Idempotent: revisiting after a sign-out simply re-runs the
// SDK call (which is a no-op) and redirects again.

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Spinner, Text, YStack } from '@binderly/ui';

import { useAuth } from '../../../components/providers/AuthProvider';

type Status = 'pending' | 'done' | 'error';

const REDIRECT_DELAY_MS = 600;

export default function SignOutPage(): ReactNode {
  const { signOut, loading } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Pin the latest `signOut` and `router` to refs so the
  // run-once effect below isn't re-triggered when their
  // identities flap on re-render (AuthProvider rebuilds its
  // value when client/session/loading state updates; mocked
  // routers in tests return a fresh object per call).
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const routerRef = useRef(router);
  routerRef.current = router;
  // Run-once guard: avoids double-firing the SDK when
  // AuthProvider hydrates and the effect re-evaluates.
  const startedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async (): Promise<void> => {
      try {
        await signOutRef.current();
        if (cancelled) return;
        setStatus('done');
        timer = setTimeout(() => {
          if (cancelled) return;
          routerRef.current.replace('/');
        }, REDIRECT_DELAY_MS);
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(toErrorMessage(error, 'Could not sign you out — please retry.'));
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [loading]);

  return (
    <YStack
      padding="$6"
      gap="$4"
      maxWidth={420}
      marginHorizontal="auto"
      alignItems="center"
      data-testid="sign-out-page"
    >
      {status === 'pending' ? (
        <YStack gap="$3" alignItems="center" data-testid="sign-out-pending">
          <Spinner size="md" aria-label="Signing out" />
          <Text variant="title">Signing you out…</Text>
        </YStack>
      ) : null}

      {status === 'done' ? (
        <YStack gap="$3" alignItems="center" data-testid="sign-out-done">
          <Text variant="title">Signed out</Text>
          <Text variant="body" tone="muted">
            Redirecting…
          </Text>
        </YStack>
      ) : null}

      {status === 'error' ? (
        <YStack gap="$3" alignItems="center" data-testid="sign-out-error">
          <Text variant="title">Sign-out failed</Text>
          <Text variant="body" tone="muted" data-testid="sign-out-error-message">
            {errorMessage}
          </Text>
        </YStack>
      ) : null}
    </YStack>
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return fallback;
}
