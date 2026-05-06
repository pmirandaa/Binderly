'use client';

// Reusable full-page loading state. RSC-safe: no hooks, no
// client-side state. Feature tasks pass an optional `label` for
// screen-readers.

import { Spinner, Text, YStack } from '@binderly/ui';

export interface PageLoadingProps {
  label?: string;
}

export function PageLoading({ label = 'Loading…' }: PageLoadingProps): React.ReactNode {
  return (
    <YStack
      padding="$6"
      gap="$3"
      alignItems="center"
      justifyContent="center"
      role="status"
      aria-live="polite"
    >
      <Spinner size="lg" />
      <Text variant="body" tone="muted">
        {label}
      </Text>
    </YStack>
  );
}
