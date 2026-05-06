'use client';

// Next.js global error boundary. Renders the same friendly view
// our app-level <ErrorBoundary> uses; per-segment error.tsx files
// can override with surface-specific recovery in feature tasks.

import { useEffect } from 'react';

import { Button, Text, YStack } from '@binderly/ui';

import { friendlyMessageFor } from '../components/error/ErrorBoundary';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactNode {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.error('[app/error.tsx]', error);
    }
  }, [error]);

  return (
    <YStack
      padding="$6"
      gap="$4"
      alignItems="center"
      justifyContent="center"
      role="alert"
      aria-live="assertive"
    >
      <Text variant="title">Something went wrong</Text>
      <Text variant="body" tone="muted">
        {friendlyMessageFor(error)}
      </Text>
      <Button label="Try again" onPress={reset} />
    </YStack>
  );
}
