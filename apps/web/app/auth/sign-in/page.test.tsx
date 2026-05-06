import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SignInPage from './page';
import { renderWithProviders } from '../../../test-utils/render';
import { createFakeSupabase } from '../../../test-utils/supabase-stub';

const searchParams = new URLSearchParams('');

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/auth/sign-in',
}));

const signInWithMagicLink = vi.fn();
const signInWithOAuth = vi.fn();

vi.mock('../../../lib/api-client', () => ({
  getApiClient: () => ({
    auth: {
      signInWithMagicLink,
      signInWithOAuth,
    },
  }),
}));

const ORIGINAL_LOCATION = window.location;
const assignSpy = vi.fn();

beforeEach(() => {
  signInWithMagicLink.mockReset();
  signInWithOAuth.mockReset();
  assignSpy.mockReset();
  signInWithMagicLink.mockResolvedValue(undefined);
  signInWithOAuth.mockResolvedValue({ url: 'https://provider.test/auth' });
  searchParams.delete('next');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...ORIGINAL_LOCATION,
      origin: 'https://app.binderly.test',
      assign: assignSpy,
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

function renderPage(): void {
  const fake = createFakeSupabase(null);
  renderWithProviders(<SignInPage />, { supabase: fake.client });
}

describe('SignInPage — render', () => {
  it('renders the magic-link form and three OAuth buttons', () => {
    renderPage();
    expect(screen.getByTestId('sign-in-page')).toBeInTheDocument();
    expect(screen.getByTestId('magic-link-form')).toBeInTheDocument();
    expect(screen.getByTestId('oauth-google')).toBeInTheDocument();
    expect(screen.getByTestId('oauth-apple')).toBeInTheDocument();
    expect(screen.getByTestId('oauth-discord')).toBeInTheDocument();
  });

  it('shows the title and helper copy', () => {
    renderPage();
    expect(screen.getByText('Sign in to Binderly')).toBeInTheDocument();
    expect(screen.getByText(/never share your collection/i)).toBeInTheDocument();
  });
});

describe('SignInPage — magic link', () => {
  it('rejects empty email and does not call the SDK', async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(signInWithMagicLink).not.toHaveBeenCalled();
  });

  it('rejects malformed email', async () => {
    renderPage();
    const user = userEvent.setup();
    const input = screen.getByTestId('email-input') as HTMLInputElement;
    await user.click(input);
    await user.type(input, 'not-an-email');
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(signInWithMagicLink).not.toHaveBeenCalled();
  });

  it('clears the inline error once the user types again', async () => {
    renderPage();
    const user = userEvent.setup();
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    const input = screen.getByTestId('email-input') as HTMLInputElement;
    await user.type(input, 'a');
    expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  });

  it('calls signInWithMagicLink with the email and a callback redirect URL', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('email-input') as HTMLInputElement, 'pablo@binderly.test');
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledTimes(1);
    });
    expect(signInWithMagicLink).toHaveBeenCalledWith({
      email: 'pablo@binderly.test',
      redirectTo: 'https://app.binderly.test/auth/callback',
    });
  });

  it('encodes ?next= into the callback redirectTo', async () => {
    searchParams.set('next', '/collection/abc');
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('email-input') as HTMLInputElement, 'pablo@binderly.test');
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalled();
    });
    expect(signInWithMagicLink).toHaveBeenCalledWith({
      email: 'pablo@binderly.test',
      redirectTo: 'https://app.binderly.test/auth/callback?next=%2Fcollection%2Fabc',
    });
  });

  it('shows the inbox-confirmation message after a successful submit', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('email-input') as HTMLInputElement, 'pablo@binderly.test');
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('magic-link-sent')).toBeInTheDocument();
    });
    expect(screen.getByText(/Magic link sent to pablo@binderly\.test/)).toBeInTheDocument();
  });

  it('surfaces SDK errors as inline copy and resets the busy flag', async () => {
    signInWithMagicLink.mockRejectedValue(new Error('rate limited'));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('email-input') as HTMLInputElement, 'pablo@binderly.test');
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('sign-in-error')).toHaveTextContent('rate limited');
    });
  });

  it('does not double-submit while a request is pending', async () => {
    const resolveBox: { fn: (() => void) | null } = { fn: null };
    signInWithMagicLink.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBox.fn = resolve;
        }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('email-input') as HTMLInputElement, 'pablo@binderly.test');
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });
    expect(signInWithMagicLink).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveBox.fn?.();
    });
  });
});

describe('SignInPage — OAuth', () => {
  it.each(['google', 'apple', 'discord'] as const)(
    'clicking the %s button triggers signInWithOAuth and follows the URL',
    async (provider) => {
      renderPage();
      await act(async () => {
        fireEvent.click(screen.getByTestId(`oauth-${provider}`));
      });
      await waitFor(() => {
        expect(signInWithOAuth).toHaveBeenCalledWith({
          provider,
          redirectTo: 'https://app.binderly.test/auth/callback',
        });
      });
      expect(assignSpy).toHaveBeenCalledWith('https://provider.test/auth');
    },
  );

  it('preserves ?next= across the OAuth round-trip', async () => {
    searchParams.set('next', '/collection');
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId('oauth-google'));
    });
    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        redirectTo: 'https://app.binderly.test/auth/callback?next=%2Fcollection',
      });
    });
  });

  it('surfaces OAuth SDK errors and re-enables the buttons', async () => {
    signInWithOAuth.mockRejectedValue(new Error('provider blew up'));
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId('oauth-google'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('sign-in-error')).toHaveTextContent('provider blew up');
    });
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('disables the other OAuth buttons while one is in flight', async () => {
    const oauthBox: { fn: ((value: { url: string }) => void) | null } = { fn: null };
    signInWithOAuth.mockImplementation(
      () =>
        new Promise<{ url: string }>((resolve) => {
          oauthBox.fn = resolve;
        }),
    );
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId('oauth-google'));
    });
    const apple = screen.getByTestId('oauth-apple');
    expect(apple.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      oauthBox.fn?.({ url: 'https://provider.test/auth' });
    });
  });
});
