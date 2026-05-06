// `<CallbackScreen>` — the deep-link handler the OS routes to
// when the OAuth provider (or magic-link email) redirects back to
// `binderly://auth/callback?code=...`.
//
// On mount we:
//   1. Read the current URL (preferring `useURL` so the route
//      receives the value Expo Router parsed for us, falling back
//      to `Linking.getInitialURL` for the cold-start case).
//   2. Extract the `code` query param (or surface the
//      `error_description` if the provider redirected with one).
//   3. Call `supabase.auth.exchangeCodeForSession(code)` to swap
//      the PKCE code for an active session. The SDK persists the
//      session through the secure-store adapter wired by M-SHELL.
//   4. Navigate to `/(tabs)` on success, or surface the error
//      with a "Try again" button on failure.
//
// Magic-link callbacks land here too: Supabase ships them with the
// same `?code=` param shape, so the same exchange call works.
//
// Lazy-init: every Supabase / Linking call lives inside `useEffect`.
// No top-level side effects. Mirrors `<AuthProvider>`.

import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Button, Text, YStack } from '@binderly/ui';

import { PageLoading } from '../../components/loading/PageLoading.js';
import { useApiClient } from '../../lib/api-client.js';
import { extractAuthCodeFromUrl, extractAuthErrorFromUrl } from '../../lib/auth/index.js';

type Status =
  | { readonly kind: 'pending' }
  | { readonly kind: 'success' }
  | { readonly kind: 'error'; readonly message: string };

const PENDING_STATUS: Status = { kind: 'pending' };

/** Where to land once the session resolves. */
export const POST_SIGN_IN_ROUTE = '/(tabs)';

export function CallbackScreen(): ReactNode {
  const apiClient = useApiClient();
  const router = useRouter();
  const initialUrl = Linking.useURL();

  const [status, setStatus] = useState<Status>(PENDING_STATUS);

  const exchange = useCallback(async () => {
    setStatus(PENDING_STATUS);
    let url: string | null = initialUrl;
    if (url === null || url.length === 0) {
      try {
        url = await Linking.getInitialURL();
      } catch {
        url = null;
      }
    }
    if (url === null || url.length === 0) {
      setStatus({
        kind: 'error',
        message: 'No callback URL was received from the sign-in flow.',
      });
      return;
    }

    const errorMessage = extractAuthErrorFromUrl(url);
    if (errorMessage !== null) {
      setStatus({ kind: 'error', message: errorMessage });
      return;
    }

    const code = extractAuthCodeFromUrl(url);
    if (code === null) {
      setStatus({
        kind: 'error',
        message: 'The callback URL did not include an authorization code.',
      });
      return;
    }

    try {
      await apiClient.auth.exchangeCodeForSession({ code });
      setStatus({ kind: 'success' });
      router.replace(POST_SIGN_IN_ROUTE as never);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to complete sign-in.';
      setStatus({ kind: 'error', message });
    }
  }, [apiClient, router, initialUrl]);

  useEffect(() => {
    void exchange();
  }, [exchange]);

  if (status.kind === 'pending' || status.kind === 'success') {
    return <PageLoading message="Signing you in…" />;
  }

  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID="callback-screen-error"
    >
      <Text variant="title" tone="default">
        Sign-in failed
      </Text>
      <Text variant="body" tone="muted">
        {status.message}
      </Text>
      <Button
        label="Back to sign in"
        variant="primary"
        size="lg"
        onPress={() => {
          router.replace('/auth/sign-in' as never);
        }}
        accessibilityLabel="Back to sign in"
        testID="callback-back-button"
      />
    </YStack>
  );
}
