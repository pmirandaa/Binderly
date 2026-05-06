import { act, fireEvent } from '@testing-library/react';
import * as WebBrowser from 'expo-web-browser';
import { describe, expect, it, vi } from 'vitest';

import { SignInScreen } from './SignInScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(async () => ({
    type: 'success',
    url: 'binderly://auth/callback?code=abc',
  })),
}));

vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: vi.fn(async () => false),
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

interface FakeApiClient {
  auth: {
    signInWithMagicLink: ReturnType<typeof vi.fn>;
    raw: () => unknown;
  };
}

function buildSupabase() {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithOAuth: vi.fn(async () => ({
        data: { url: 'https://provider.example/oauth' },
        error: null,
      })),
      signInWithIdToken: vi.fn(async () => ({ data: { session: {} }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
}

function buildClient(supabase: ReturnType<typeof buildSupabase>): FakeApiClient {
  return {
    auth: {
      signInWithMagicLink: vi.fn(async () => undefined),
      raw: () => supabase,
    },
  };
}

function renderScreen(client: FakeApiClient, supabase: ReturnType<typeof buildSupabase>) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider supabase={supabase as unknown as Parameters<typeof AuthProvider>[0]['supabase']}>
      <ApiClientProvider
        client={client as unknown as Parameters<typeof ApiClientProvider>[0]['client']}
      >
        {children}
      </ApiClientProvider>
    </AuthProvider>
  );
  return renderWithProvider(<SignInScreen />, { wrapper: Wrapper });
}

describe('<SignInScreen>', () => {
  it('renders the heading + email field + magic link + three OAuth buttons', () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    expect(result.container.textContent).toContain('Sign in to Binderly');
    expect(result.container.textContent).toContain('Send magic link');
    expect(result.container.textContent).toContain('Sign in with Apple');
    expect(result.container.textContent).toContain('Continue with Google');
    expect(result.container.textContent).toContain('Continue with Discord');
  });

  it('renders an Email input', () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    const input = result.container.querySelector('input[id^="binderly-input-"]');
    expect(input).not.toBeNull();
  });

  it('disables the magic-link button until a valid email is typed', async () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    const magicLink = result.getByTestId('sign-in-magic-link');
    expect(magicLink.getAttribute('aria-disabled')).toBe('true');

    const input = result.container.querySelector('input[id^="binderly-input-"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await act(async () => {
      fireEvent.input(input, { target: { value: 'pablo@example.com' } });
    });
    expect(magicLink.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('calls api-client.auth.signInWithMagicLink when submit fires with valid input', async () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    const input = result.container.querySelector('input[id^="binderly-input-"]');
    if (input === null) throw new Error('email input missing');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'pablo@example.com' } });
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('sign-in-magic-link'));
    });
    expect(client.auth.signInWithMagicLink).toHaveBeenCalledWith({
      email: 'pablo@example.com',
      redirectTo: undefined,
    });
  });

  it('shows a success helper after magic-link send', async () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    const input = result.container.querySelector('input[id^="binderly-input-"]');
    if (input === null) throw new Error('email input missing');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'pablo@example.com' } });
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('sign-in-magic-link'));
    });
    expect(result.container.textContent).toContain('Check pablo@example.com');
  });

  it('surfaces an error when magic link sending fails', async () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    client.auth.signInWithMagicLink.mockRejectedValueOnce(new Error('Rate limited'));
    const result = renderScreen(client, supabase);
    const input = result.container.querySelector('input[id^="binderly-input-"]');
    if (input === null) throw new Error('email input missing');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'pablo@example.com' } });
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('sign-in-magic-link'));
    });
    expect(result.container.textContent).toContain('Rate limited');
  });

  it('starts the OAuth flow when a Google button is pressed', async () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('sign-in-oauth-google'));
    });
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'binderly://auth/callback',
        skipBrowserRedirect: true,
      },
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalled();
  });

  it('starts the OAuth flow for Discord when its button is pressed', async () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('sign-in-oauth-discord'));
    });
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'discord' }),
    );
  });

  it('falls back to the OAuth flow for Apple on non-iOS / unavailable', async () => {
    const supabase = buildSupabase();
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('sign-in-oauth-apple'));
    });
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'apple' }),
    );
  });

  it('surfaces OAuth errors inline', async () => {
    const supabase = buildSupabase();
    supabase.auth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: undefined } as { url: string | undefined },
      error: { message: 'provider misconfigured' } as unknown as Awaited<
        ReturnType<typeof supabase.auth.signInWithOAuth>
      >['error'],
    } as Awaited<ReturnType<typeof supabase.auth.signInWithOAuth>>);
    const client = buildClient(supabase);
    const result = renderScreen(client, supabase);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('sign-in-oauth-google'));
    });
    expect(result.container.textContent).toContain('provider misconfigured');
  });
});
