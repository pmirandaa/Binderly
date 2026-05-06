import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ApiConflictError,
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiServerError,
  ApiUnauthorizedError,
  ApiValidationError,
} from '@binderly/api-client';

import { ErrorFallback, describeErrorForFallback } from './ErrorFallback';
import { renderWithProvider } from '../../test-utils/render';

describe('describeErrorForFallback', () => {
  it('maps ApiUnauthorizedError to a sign-in prompt', () => {
    const desc = describeErrorForFallback(new ApiUnauthorizedError('expired'));
    expect(desc.title).toMatch(/sign in again/i);
  });

  it('maps ApiNetworkError to a connection prompt', () => {
    const desc = describeErrorForFallback(new ApiNetworkError('dns'));
    expect(desc.title).toMatch(/no connection/i);
  });

  it('maps ApiRateLimitError to a slow-down prompt', () => {
    const desc = describeErrorForFallback(new ApiRateLimitError('throttled'));
    expect(desc.title).toMatch(/slow down/i);
  });

  it('maps ApiValidationError to a process-failure prompt', () => {
    const desc = describeErrorForFallback(new ApiValidationError('bad payload'));
    expect(desc.title).toMatch(/couldn’t process/i);
  });

  it('maps ApiNotFoundError to a not-found prompt', () => {
    const desc = describeErrorForFallback(new ApiNotFoundError('gone'));
    expect(desc.title).toMatch(/not found/i);
  });

  it('maps ApiServerError to a server-hiccup prompt', () => {
    const desc = describeErrorForFallback(new ApiServerError('500'));
    expect(desc.title).toMatch(/server hiccup/i);
  });

  it('falls back to the message for unmapped ApiErrors', () => {
    const desc = describeErrorForFallback(new ApiConflictError('conflict-message'));
    expect(desc.description).toMatch(/conflict-message/);
  });

  it('falls back to the message for plain Errors', () => {
    const desc = describeErrorForFallback(new Error('boom'));
    expect(desc.description).toBe('boom');
  });

  it('falls back to a generic message for non-Error throws', () => {
    const desc = describeErrorForFallback({ weird: true });
    expect(desc.title).toMatch(/something went wrong/i);
  });
});

describe('<ErrorFallback>', () => {
  it('renders the title, description and retry button', () => {
    const retry = vi.fn();
    const result = renderWithProvider(<ErrorFallback error={new Error('uh oh')} retry={retry} />);
    expect(result.container.textContent).toMatch(/Something went wrong/);
    expect(result.container.textContent).toMatch(/uh oh/);
  });

  it('invokes the retry callback when the retry button is pressed', () => {
    const retry = vi.fn();
    const result = renderWithProvider(<ErrorFallback error={new Error('uh oh')} retry={retry} />);
    // Tamagui buttons render as a Pressable on web — `getByText`
    // returns the inner Text node, but the synthetic press handler
    // is attached to its surface ancestor. firing on the button
    // text bubble gives us the closest equivalent we can verify.
    const buttonText = result.getByText(/Retry|Try again|Go back/);
    fireEvent.click(buttonText);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
