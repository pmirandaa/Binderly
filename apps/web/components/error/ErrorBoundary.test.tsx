import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, ApiNotFoundError, ApiUnauthorizedError } from '@binderly/api-client';

import { ErrorBoundary, friendlyMessageFor } from './ErrorBoundary.js';
import { renderWithProviders } from '../../test-utils/render.js';

import type { ReactNode } from 'react';

function Boom({ error }: { error: Error }): ReactNode {
  throw error;
}

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    renderWithProviders(
      <ErrorBoundary>
        <span data-testid="ok">ok</span>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toHaveTextContent('ok');
  });

  it('catches a thrown Error and renders the default fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(
      <ErrorBoundary>
        <Boom error={new Error('kaboom')} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('renders a friendly message for ApiUnauthorizedError', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(
      <ErrorBoundary>
        <Boom error={new ApiUnauthorizedError('expired')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Your session has expired/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('renders a custom fallback when supplied', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary fallback={(error) => <div data-testid="custom">custom:{error.message}</div>}>
        <Boom error={new Error('explode')} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('custom:explode');
    spy.mockRestore();
  });

  it('reset callback is invoked from the default fallback', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const reset = vi.fn();
    render(
      <ErrorBoundary
        fallback={(_error, resetCb) => (
          <button
            type="button"
            onClick={() => {
              reset();
              resetCb();
            }}
          >
            try again
          </button>
        )}
      >
        <Boom error={new Error('explode')} />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('friendlyMessageFor', () => {
  it('returns a friendly message for each ApiError code', () => {
    expect(friendlyMessageFor(new ApiUnauthorizedError('x'))).toMatch(/session has expired/);
    expect(friendlyMessageFor(new ApiNotFoundError('x'))).toMatch(/could not find/);
    expect(friendlyMessageFor(new ApiError('NETWORK', 'x'))).toMatch(/Network connection lost/);
    expect(friendlyMessageFor(new ApiError('INTERNAL', 'x'))).toMatch(/server hit a problem/);
    expect(friendlyMessageFor(new ApiError('VALIDATION', 'x'))).toMatch(/inputs were invalid/);
    expect(friendlyMessageFor(new ApiError('CONFLICT', 'x'))).toMatch(/conflicts with/);
    expect(friendlyMessageFor(new ApiError('RATE_LIMIT', 'x'))).toMatch(/too quickly/);
    expect(friendlyMessageFor(new ApiError('DECODE', 'x'))).toMatch(/unexpected response/);
  });

  it('falls back to the message on a plain Error', () => {
    expect(friendlyMessageFor(new Error('boom'))).toBe('boom');
  });

  it('returns a default message when the Error has no message', () => {
    const err = new Error();
    expect(friendlyMessageFor(err)).toMatch(/unexpected error/);
  });
});
