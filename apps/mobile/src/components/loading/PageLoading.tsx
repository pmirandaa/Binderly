// Full-page loading primitive. Used by Suspense fallbacks and the
// AuthProvider's hydration window. Token-driven so the colours
// follow the active theme automatically.

import { Spinner, Text, YStack } from '@binderly/ui';

import type { ReactNode } from 'react';

export interface PageLoadingProps {
  /** Optional message; falls back to a generic "Loading…" string. */
  message?: string;
}

export function PageLoading({ message }: PageLoadingProps): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$3"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Loading'}
    >
      <Spinner size="lg" />
      {message !== undefined ? (
        <Text variant="bodySmall" tone="muted">
          {message}
        </Text>
      ) : null}
    </YStack>
  );
}
