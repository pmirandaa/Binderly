// React class-component error boundary. Necessary because hooks
// can't catch downstream errors — only `componentDidCatch` /
// `getDerivedStateFromError` can.
//
// We surface friendly messages for known `ApiError` subclasses via
// `<ErrorFallback>` and expose a `retry` callback that resets the
// boundary, allowing the children to remount cleanly.

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorFallback } from './ErrorFallback';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional override fallback. Defaults to `<ErrorFallback>`.
   */
  fallback?: (props: { error: unknown; retry: () => void }) => ReactNode;
  /**
   * Side-channel for telemetry (Sentry / PostHog hookup ships in a
   * later observability task; the shell only exposes the seam).
   */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly error: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  public override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      const fallback = this.props.fallback;
      if (fallback) return fallback({ error, retry: this.retry });
      return <ErrorFallback error={error} retry={this.retry} />;
    }
    return this.props.children;
  }
}
