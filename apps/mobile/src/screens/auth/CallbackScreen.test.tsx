import { act } from '@testing-library/react';
import * as Linking from 'expo-linking';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallbackScreen, POST_SIGN_IN_ROUTE } from './CallbackScreen';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

// The setup.ts mock of `expo-linking` does not include
// `getInitialURL`. Augment it for this file only.
vi.mock('expo-linking', () => ({
  createURL: vi.fn((path: string) => `binderly://${path.replace(/^\//, '')}`),
  openURL: vi.fn(async () => true),
  parse: vi.fn(() => ({})),
  useURL: vi.fn(() => null),
  getInitialURL: vi.fn(async () => null),
}));

// CallbackScreen → lib/auth barrel pulls in apple.ts + oauth.ts which
// import expo-apple-authentication and expo-web-browser. Mock both
// locally so the native bridge is not touched under jsdom.
vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: vi.fn(async () => false),
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(async () => ({ type: 'cancel' })),
}));

// Stable router mock — see protected-screen.test.tsx for the rationale.
const { routerMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
}));

vi.mock('expo-router', () => ({
  Slot: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Stack: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
    Screen: ({ children }: { children?: React.ReactNode }) => children ?? null,
  }),
  Tabs: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
    Screen: ({ children }: { children?: React.ReactNode }) => children ?? null,
  }),
  Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Redirect: () => null,
  router: routerMocks,
  useRouter: () => routerMocks,
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  usePathname: () => '/',
}));

beforeEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
  vi.mocked(Linking.useURL).mockReset();
  vi.mocked(Linking.useURL).mockReturnValue(null);
  vi.mocked(Linking.getInitialURL).mockReset();
  vi.mocked(Linking.getInitialURL).mockResolvedValue(null);
});

afterEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
});

interface FakeApiClient {
  auth: {
    exchangeCodeForSession: ReturnType<typeof vi.fn>;
  };
}

function buildClient(): FakeApiClient {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ userId: 'user-1', expiresAt: 'now' })),
    },
  };
}

function renderScreen(client: FakeApiClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ApiClientProvider
      client={client as unknown as Parameters<typeof ApiClientProvider>[0]['client']}
    >
      {children}
    </ApiClientProvider>
  );
  return renderWithProvider(<CallbackScreen />, { wrapper: Wrapper });
}

describe('<CallbackScreen>', () => {
  it('exposes the post-sign-in route as a public constant', () => {
    expect(POST_SIGN_IN_ROUTE).toBe('/(tabs)');
  });

  it('exchanges the code from useURL when present', async () => {
    vi.mocked(Linking.useURL).mockReturnValue('binderly://auth/callback?code=abc123');
    const client = buildClient();
    renderScreen(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith({ code: 'abc123' });
  });

  it('falls back to Linking.getInitialURL when useURL returns null', async () => {
    vi.mocked(Linking.useURL).mockReturnValue(null);
    vi.mocked(Linking.getInitialURL).mockResolvedValue(
      'binderly://auth/callback?code=fallback-code',
    );
    const client = buildClient();
    renderScreen(client);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith({ code: 'fallback-code' });
  });

  it('navigates to the tabs route on a successful exchange', async () => {
    vi.mocked(Linking.useURL).mockReturnValue('binderly://auth/callback?code=abc');
    const client = buildClient();
    renderScreen(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('shows a user-readable error when no callback URL is available', async () => {
    vi.mocked(Linking.useURL).mockReturnValue(null);
    vi.mocked(Linking.getInitialURL).mockResolvedValue(null);
    const client = buildClient();
    const result = renderScreen(client);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.container.textContent).toContain('No callback URL');
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('shows a user-readable error when the URL has no code param', async () => {
    vi.mocked(Linking.useURL).mockReturnValue('binderly://auth/callback?state=xyz');
    const client = buildClient();
    const result = renderScreen(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.container.textContent).toContain('did not include an authorization code');
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('surfaces the provider error_description when present', async () => {
    vi.mocked(Linking.useURL).mockReturnValue(
      'binderly://auth/callback?error=access_denied&error_description=Email+confirmation+required',
    );
    const client = buildClient();
    const result = renderScreen(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.container.textContent).toContain('Email confirmation required');
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('surfaces the exchange error when supabase rejects', async () => {
    vi.mocked(Linking.useURL).mockReturnValue('binderly://auth/callback?code=abc');
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockRejectedValueOnce(new Error('Token expired'));
    const result = renderScreen(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.container.textContent).toContain('Token expired');
  });

  it('shows a Back to sign in button on the error path', async () => {
    vi.mocked(Linking.useURL).mockReturnValue(null);
    vi.mocked(Linking.getInitialURL).mockResolvedValue(null);
    const client = buildClient();
    const result = renderScreen(client);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.getByTestId('callback-back-button')).toBeTruthy();
  });
});
