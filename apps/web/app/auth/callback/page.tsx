'use client';

import { Text, YStack } from '@binderly/ui';

export default function AuthCallbackPage(): React.ReactNode {
  return (
    <YStack padding="$6" gap="$3" data-testid="auth-callback-page">
      <Text variant="title">Completing sign in…</Text>
      <Text variant="body" tone="muted">
        OAuth callback handling lands in T-W-AUTH.
      </Text>
    </YStack>
  );
}
