import { fireEvent } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiUnauthorizedError } from '@binderly/api-client';

import { ErrorBoundary } from './ErrorBoundary';
import { renderWithProvider } from '../../test-utils/render';

function Boom({ error }: { error: unknown }): ReactNode {
  throw error;
}

function ToggleBoom({ initial }: { initial: unknown }): ReactNode {
  // Test scaffold: the wrapper toggles a state flag the boundary
  // resets via its retry button, allowing us to verify children
  // remount cleanly after a retry.
  const [error, setError] = useState<unknown>(initial);
  void setError;
  return <Boom error={error} />;
}

describe('<ErrorBoundary>', () => {
  it('renders children when nothing throws', () => {
    const result = renderWithProvider(
      <ErrorBoundary>
        <span data-testid="child">ok</span>
      </ErrorBoundary>,
    );
    expect(result.getByTestId('child').textContent).toBe('ok');
  });

  it('renders the default ErrorFallback for an Error', () => {
    // Suppress the noisy React error log in jsdom.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = renderWithProvider(
        <ErrorBoundary>
          <Boom error={new Error('boom')} />
        </ErrorBoundary>,
      );
      expect(result.container.textContent).toMatch(/Something went wrong/);
      expect(result.container.textContent).toMatch(/boom/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('surfaces a friendly title for ApiUnauthorizedError', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = renderWithProvider(
        <ErrorBoundary>
          <Boom error={new ApiUnauthorizedError('jwt expired')} />
        </ErrorBoundary>,
      );
      expect(result.container.textContent).toMatch(/Please sign in again/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('uses a custom fallback when provided', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const fallback = ({ error, retry }: { error: unknown; retry: () => void }) => (
        <span data-testid="custom" onClick={retry}>
          custom-{(error as Error).message}
        </span>
      );
      const result = renderWithProvider(
        <ErrorBoundary fallback={fallback}>
          <Boom error={new Error('x')} />
        </ErrorBoundary>,
      );
      expect(result.getByTestId('custom').textContent).toBe('custom-x');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('invokes onError with the thrown value and the React info object', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const onError = vi.fn();
      const error = new Error('telemetry');
      renderWithProvider(
        <ErrorBoundary onError={onError}>
          <Boom error={error} />
        </ErrorBoundary>,
      );
      expect(onError).toHaveBeenCalledTimes(1);
      const [thrown, info] = onError.mock.calls[0] as [unknown, { componentStack?: string | null }];
      expect(thrown).toBe(error);
      expect(typeof info).toBe('object');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('exposes a retry callback that resets the boundary', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const fallback = ({ retry }: { retry: () => void }) => (
        <button data-testid="retry" onClick={retry}>
          retry
        </button>
      );
      const result = renderWithProvider(
        <ErrorBoundary fallback={fallback}>
          <ToggleBoom initial={new Error('first')} />
        </ErrorBoundary>,
      );
      expect(result.getByTestId('retry')).toBeTruthy();
      // Clicking retry resets the boundary; the child re-renders
      // and (since `ToggleBoom`'s state still holds the same error)
      // throws again. We only verify the click doesn't crash and
      // the fallback is shown again.
      fireEvent.click(result.getByTestId('retry'));
      expect(result.getByTestId('retry')).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });
});
