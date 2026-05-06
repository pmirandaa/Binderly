import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AuthCallbackPage from './page';
import { renderWithProviders } from '../../../test-utils/render';
import { createFakeSupabase } from '../../../test-utils/supabase-stub';

let currentParams = new URLSearchParams('');
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/auth/callback',
}));

const exchangeCodeForSession = vi.fn();

vi.mock('../../../lib/api-client', () => ({
  getApiClient: () => ({
    auth: { exchangeCodeForSession },
  }),
}));

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  replace.mockReset();
  currentParams = new URLSearchParams('');
});

afterEach(() => {
  currentParams = new URLSearchParams('');
});

function renderPage(): void {
  const fake = createFakeSupabase(null);
  renderWithProviders(<AuthCallbackPage />, { supabase: fake.client });
}

describe('AuthCallbackPage', () => {
  it('renders the pending state on initial mount', () => {
    currentParams = new URLSearchParams('code=abc');
    const resolveBox: { fn: (() => void) | null } = { fn: null };
    exchangeCodeForSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBox.fn = () => resolve();
        }),
    );
    renderPage();
    expect(screen.getByTestId('callback-pending')).toBeInTheDocument();
    resolveBox.fn?.();
  });

  it('exchanges the code and redirects to / on success', async () => {
    currentParams = new URLSearchParams('code=abc');
    exchangeCodeForSession.mockResolvedValue({
      userId: 'u',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    renderPage();
    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith({ code: 'abc' });
    });
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/');
    });
  });

  it('redirects to ?next= when present', async () => {
    currentParams = new URLSearchParams('code=abc&next=%2Fcollection%2Fxyz');
    exchangeCodeForSession.mockResolvedValue({
      userId: 'u',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    renderPage();
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/collection/xyz');
    });
  });

  it('falls back to / when ?next= is unsafe (open-redirect guard)', async () => {
    currentParams = new URLSearchParams('code=abc&next=https%3A%2F%2Fevil.com');
    exchangeCodeForSession.mockResolvedValue({
      userId: 'u',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    renderPage();
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/');
    });
  });

  it('shows the provider error_description when present and skips the exchange', async () => {
    currentParams = new URLSearchParams(
      'error=access_denied&error_description=The+user+denied+access',
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('callback-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('callback-error-message')).toHaveTextContent(
      'The user denied access',
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to ?error= when only the short error code is present', async () => {
    currentParams = new URLSearchParams('error=access_denied');
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('callback-error-message')).toHaveTextContent('access_denied');
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('shows an error when no code is present at all', async () => {
    currentParams = new URLSearchParams('');
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('callback-error-message')).toHaveTextContent(
        /Missing authorization code/,
      );
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('surfaces SDK exchange errors inline', async () => {
    currentParams = new URLSearchParams('code=abc');
    exchangeCodeForSession.mockRejectedValue(new Error('code already used'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('callback-error-message')).toHaveTextContent('code already used');
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders a "Try again" link on the error path', async () => {
    currentParams = new URLSearchParams('error=oops');
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('callback-retry')).toBeInTheDocument();
    });
    expect(screen.getByTestId('callback-retry').getAttribute('href')).toBe('/auth/sign-in');
  });
});
