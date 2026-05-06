'use client';

// Generic React error boundary. Surfaces `ApiError` codes from
// `@binderly/api-client` with a friendly message; falls back to a
// generic message for anything else. Downstream feature tasks may
// add per-segment `error.tsx` files for fine-grained recovery —
// this one wraps the global tree under `app/layout.tsx` so the
// app never white-screens.

import { Component, type ReactNode } from 'react';

import { ApiError } from '@binderly/api-client';
import { Button, Text, YStack } from '@binderly/ui';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Render override — receives the caught error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error): void {
    // Tested observability hooks land in T-DP-MONITORING (Sentry).
    // For the shell we just log so dev sees the trace in the
    // browser console.
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', error);
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  public override render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;
    if (error === null) return children;
    if (fallback !== undefined) return fallback(error, this.reset);
    return <DefaultErrorView error={error} onReset={this.reset} />;
  }
}

function DefaultErrorView({ error, onReset }: { error: Error; onReset: () => void }): ReactNode {
  const friendlyMessage = friendlyMessageFor(error);
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
        {friendlyMessage}
      </Text>
      <Button label="Try again" onPress={onReset} />
    </YStack>
  );
}

export function friendlyMessageFor(error: Error): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'AUTH':
        return 'Your session has expired. Please sign in again.';
      case 'NOT_FOUND':
        return 'We could not find what you were looking for.';
      case 'RATE_LIMIT':
        return 'You are doing that a little too quickly. Try again in a moment.';
      case 'NETWORK':
        return 'Network connection lost. Check your internet and try again.';
      case 'INTERNAL':
        return 'The server hit a problem. We have been notified.';
      case 'VALIDATION':
        return 'Some inputs were invalid. Please review and try again.';
      case 'CONFLICT':
        return 'This conflicts with an existing record. Refresh and try again.';
      case 'DECODE':
        return 'The server returned an unexpected response.';
      default:
        return error.message || 'An unknown error occurred.';
    }
  }
  return error.message || 'An unexpected error occurred.';
}
