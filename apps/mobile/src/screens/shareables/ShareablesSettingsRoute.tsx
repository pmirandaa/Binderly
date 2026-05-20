// `<ShareablesSettingsRoute>` — auth gate + api-client wiring for
// the mobile shareables settings surface.
//
// Mirrors the web `<ShareablesSettingsRoute>` split:
//
//   1. `useAuth()` gate. Signed-out users see a sign-in CTA that
//      routes to `/auth/sign-in` (matches the
//      `<CollectionScreen>` pattern).
//   2. Build the narrow `SettingsApi` once (from
//      `useApiClient()`) — no per-render allocations beyond the
//      thin adapter wrapper.
//   3. Hand the api to `<ShareablesSettingsScreen>`.

import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';

import { Button, Spinner, Text, YStack } from '@binderly/ui';

import { binderlyClientToSettingsApi } from './api.js';
import { ShareablesSettingsScreen } from './ShareablesSettingsScreen.js';
import { useAuth } from '../../components/providers/AuthProvider.js';
import { useApiClient } from '../../lib/api-client.js';

export function ShareablesSettingsRoute(): ReactNode {
  const router = useRouter();
  const { session, loading } = useAuth();
  const client = useApiClient();
  const api = useMemo(() => binderlyClientToSettingsApi(client), [client]);

  const handleSignIn = useCallback(() => {
    router.push('/auth/sign-in');
  }, [router]);

  if (loading) {
    return (
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="$2"
        padding="$6"
        testID="m-settings-shareables-loading"
      >
        <Spinner size="md" />
        <Text variant="caption" tone="muted">
          Loading your settings\u2026
        </Text>
      </YStack>
    );
  }

  if (session === null) {
    return (
      <YStack
        flex={1}
        gap="$4"
        padding="$6"
        alignItems="center"
        justifyContent="center"
        maxWidth={520}
        marginHorizontal="auto"
        testID="m-settings-shareables-signin"
      >
        <YStack gap="$2" alignItems="center">
          <Text variant="title">Sign in to manage your public shareables</Text>
          <Text variant="body" tone="muted">
            Your handle, theme, and per-page toggles live in your account. Sign in to edit them.
          </Text>
        </YStack>
        <Button
          label="Sign in"
          variant="primary"
          size="lg"
          onPress={handleSignIn}
          accessibilityLabel="Sign in"
          testID="m-settings-shareables-signin-button"
        />
      </YStack>
    );
  }

  return <ShareablesSettingsScreen api={api} />;
}
