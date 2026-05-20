import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';

import { FAKE_PROFILE, FAKE_SHAREABLE, FAKE_SUBSCRIPTION } from './fixtures';
import { ShareablesSettingsRoute } from './ShareablesSettingsRoute';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

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
});

afterEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
});

type FakeSession = {
  access_token: string;
  refresh_token: string;
  user: { id: string };
} | null;

function buildSupabase(initialSession: FakeSession = null) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: initialSession }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as Parameters<typeof AuthProvider>[0]['supabase'];
}

// Minimal BinderlyClient stand-in for the route adapter.
function buildClient() {
  return {
    profile: {
      getMyProfile: vi.fn(async () => FAKE_PROFILE),
      updateMyProfile: vi.fn(async (patch: Record<string, unknown>) => ({
        ...FAKE_PROFILE,
        ...patch,
      })),
      getMySubscription: vi.fn(async () => FAKE_SUBSCRIPTION),
      checkHandleAvailability: vi.fn(async () => ({
        handle: 'pablo',
        available: true,
      })),
    },
    shareables: {
      listShareables: vi.fn(async () => [FAKE_SHAREABLE]),
      createShareable: vi.fn(async () => FAKE_SHAREABLE),
      updateShareable: vi.fn(async () => FAKE_SHAREABLE),
      deleteShareable: vi.fn(async () => undefined),
    },
  };
}

interface RenderOptions {
  readonly session: FakeSession;
  readonly client?: ReturnType<typeof buildClient>;
}

function renderRoute(opts: RenderOptions) {
  const supabase = buildSupabase(opts.session);
  const client = opts.client ?? buildClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider supabase={supabase}>
      <ApiClientProvider client={client as unknown as BinderlyClient}>
        {children}
      </ApiClientProvider>
    </AuthProvider>
  );
  return renderWithProvider(<ShareablesSettingsRoute />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

describe('<ShareablesSettingsRoute> auth gate', () => {
  it('shows the sign-in CTA when no session is present', async () => {
    renderRoute({ session: null });
    await waitFor(() => {
      expect(screen.queryByTestId('m-settings-shareables-signin')).not.toBeNull();
    });
  });

  it('routes to /auth/sign-in when the sign-in CTA is tapped', async () => {
    renderRoute({ session: null });
    await waitFor(() => {
      expect(screen.queryByTestId('m-settings-shareables-signin-button')).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-settings-shareables-signin-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('renders the settings screen when a session is present', async () => {
    renderRoute({ session: SIGNED_IN });
    await waitFor(
      () => {
        expect(screen.queryByTestId('m-settings-shareables-page')).not.toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('forwards the api adapter to the screen (profile fetch is called)', async () => {
    const client = buildClient();
    renderRoute({ session: SIGNED_IN, client });
    await waitFor(
      () => {
        expect(client.profile.getMyProfile).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
  });
});
