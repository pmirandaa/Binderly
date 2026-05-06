// Friendly fallback rendered when `<ErrorBoundary>` catches a
// downstream throw. Surfaces `ApiError` subclasses with a
// human-readable message; everything else collapses to a generic
// "Something went wrong" headline.

import { ApiError } from '@binderly/api-client';
import { Button, Text, YStack } from '@binderly/ui';

import type { ReactNode } from 'react';

export interface ErrorFallbackProps {
  /** The thrown value (anything React's error boundary surfaces). */
  error: unknown;
  /** Reset the boundary; rerenders the children once cleared. */
  retry: () => void;
}

interface FriendlyMessage {
  readonly title: string;
  readonly description: string;
  readonly retryLabel: string;
}

function describe(error: unknown): FriendlyMessage {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'AUTH':
        return {
          title: 'Please sign in again',
          description: 'Your session has expired. Sign back in to continue.',
          retryLabel: 'Try again',
        };
      case 'NETWORK':
        return {
          title: 'No connection',
          description:
            'Binderly couldn’t reach the server. Check your connection and try again. Saved data is still available offline.',
          retryLabel: 'Retry',
        };
      case 'RATE_LIMIT':
        return {
          title: 'Slow down',
          description: 'Too many requests in a short window. Wait a moment and try again.',
          retryLabel: 'Retry',
        };
      case 'VALIDATION':
        return {
          title: 'Couldn’t process that request',
          description:
            'The data the app sent didn’t pass validation. Update the form and try again.',
          retryLabel: 'Retry',
        };
      case 'NOT_FOUND':
        return {
          title: 'Not found',
          description: 'The resource you were looking for is no longer available.',
          retryLabel: 'Go back',
        };
      case 'INTERNAL':
        return {
          title: 'Server hiccup',
          description: 'Binderly’s server returned an error. Try again in a moment.',
          retryLabel: 'Retry',
        };
      default:
        return {
          title: 'Something went wrong',
          description: error.message,
          retryLabel: 'Retry',
        };
    }
  }
  if (error instanceof Error) {
    return {
      title: 'Something went wrong',
      description: error.message,
      retryLabel: 'Retry',
    };
  }
  return {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Try again — if it keeps happening, tell us.',
    retryLabel: 'Retry',
  };
}

export function ErrorFallback({ error, retry }: ErrorFallbackProps): ReactNode {
  const { title, description, retryLabel } = describe(error);
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
    >
      <Text variant="title" tone="default">
        {title}
      </Text>
      <Text variant="body" tone="muted">
        {description}
      </Text>
      <Button label={retryLabel} variant="primary" size="md" onPress={retry} />
    </YStack>
  );
}

export { describe as describeErrorForFallback };
