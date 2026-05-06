'use client';

// OAuth / PKCE / magic-link callback.
//
// Three terminal states:
//   - Success: `?code=` is present, `exchangeCodeForSession`
//     succeeds, redirect to `?next=` (default `/`).
//   - Provider error: `?error_description=` is present (or no
//     code at all). Render the message and a "Try again" link.
//   - SDK error: exchange threw — render the message inline.
//
// All Supabase access happens inside `useEffect` so the page
// can be rendered (and statically prerendered) without env
// vars, matching the W-SHELL hotfix pattern.

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { Spinner, Text, YStack } from '@binderly/ui';

import { getApiClient } from '../../../lib/api-client';
import { extractNext } from '../../../lib/auth/redirect';

type Status = 'pending' | 'success' | 'error';

export default function AuthCallbackPage(): ReactNode {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const errorDescription = searchParams?.get('error_description');
      const error = searchParams?.get('error');
      if (errorDescription !== null && errorDescription !== undefined && errorDescription !== '') {
        setErrorMessage(errorDescription);
        setStatus('error');
        return;
      }
      if (error !== null && error !== undefined && error !== '') {
        setErrorMessage(error);
        setStatus('error');
        return;
      }
      const code = searchParams?.get('code');
      if (code === null || code === undefined || code === '') {
        setErrorMessage('Missing authorization code in the callback URL.');
        setStatus('error');
        return;
      }
      try {
        const api = getApiClient();
        await api.auth.exchangeCodeForSession({ code });
        if (cancelled) return;
        setStatus('success');
        const next = extractNext(searchParams);
        router.replace(next);
      } catch (caught) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(toErrorMessage(caught, 'Sign-in failed. Please try again.'));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <YStack
      padding="$6"
      gap="$4"
      maxWidth={420}
      marginHorizontal="auto"
      alignItems="center"
      data-testid="auth-callback-page"
    >
      {status === 'pending' ? (
        <YStack gap="$3" alignItems="center" data-testid="callback-pending">
          <Spinner size="md" aria-label="Completing sign-in" />
          <Text variant="title">Completing sign in…</Text>
          <Text variant="body" tone="muted">
            Hang on a moment while we finish the round-trip.
          </Text>
        </YStack>
      ) : null}

      {status === 'success' ? (
        <YStack gap="$3" alignItems="center" data-testid="callback-success">
          <Text variant="title">Signed in</Text>
          <Text variant="body" tone="muted">
            Redirecting…
          </Text>
        </YStack>
      ) : null}

      {status === 'error' ? (
        <YStack gap="$3" alignItems="center" data-testid="callback-error">
          <Text variant="title">Couldn’t complete sign-in</Text>
          <Text variant="body" tone="muted" data-testid="callback-error-message">
            {errorMessage}
          </Text>
          <a href="/auth/sign-in" data-testid="callback-retry">
            <Text variant="label">Try again</Text>
          </a>
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
