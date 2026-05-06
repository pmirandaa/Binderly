'use client';

import { Text, YStack } from '@binderly/ui';

export default function SignInPage(): React.ReactNode {
  return (
    <YStack padding="$6" gap="$3" data-testid="sign-in-page">
      <Text variant="title">Sign in</Text>
      <Text variant="body" tone="muted">
        Sign in flows (Google, Apple, Discord, magic link) land in T-W-AUTH.
      </Text>
    </YStack>
  );
}
