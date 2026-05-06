import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProtectedScreen, useRequireAuth } from './protected-screen';
import { AuthProvider } from '../../components/providers/AuthProvider';

import type { ReactNode } from 'react';

// Re-mock expo-router with a stable router instance whose mocks we
// can read across renders. The setup.ts mock returns a *new* object
// from every `useRouter()` call, which makes assertions impossible.
// `vi.hoisted` co-elevates the mock state alongside the `vi.mock`
// factory call so the closure is initialized before module import.
const { routerMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
}));

vi.mock('expo-router', () => {
  return {
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
  };
});

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

function buildSupabaseMock(initialSession: FakeSession = null) {
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: initialSession }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  return supabase as unknown as Parameters<typeof AuthProvider>[0]['supabase'];
}

function wrap(supabase: Parameters<typeof AuthProvider>[0]['supabase']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthProvider supabase={supabase}>{children}</AuthProvider>;
  };
}

describe('<ProtectedScreen>', () => {
  it('renders the loading fallback while auth is hydrating', () => {
    const supabase = buildSupabaseMock();
    const Wrapper = wrap(supabase);
    const result = render(
      <Wrapper>
        <ProtectedScreen loadingFallback={<>loading-marker</>}>
          <>secret-content</>
        </ProtectedScreen>
      </Wrapper>,
    );
    expect(result.container.textContent).toContain('loading-marker');
    expect(result.container.textContent).not.toContain('secret-content');
  });

  it('renders children once a session is present', async () => {
    const supabase = buildSupabaseMock({
      access_token: 'jwt',
      refresh_token: 'r',
      user: { id: 'user-1' },
    });
    const Wrapper = wrap(supabase);
    const result = render(
      <Wrapper>
        <ProtectedScreen loadingFallback={<>loading-marker</>}>
          <>secret-content</>
        </ProtectedScreen>
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.container.textContent).toContain('secret-content');
  });

  it('redirects to /auth/sign-in when no session resolves', async () => {
    const supabase = buildSupabaseMock(null);
    const Wrapper = wrap(supabase);

    render(
      <Wrapper>
        <ProtectedScreen loadingFallback={<>loading-marker</>}>
          <>secret-content</>
        </ProtectedScreen>
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(routerMocks.replace).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('honours a custom redirectTo target', async () => {
    const supabase = buildSupabaseMock(null);
    const Wrapper = wrap(supabase);

    render(
      <Wrapper>
        <ProtectedScreen redirectTo="/welcome" loadingFallback={<>loading-marker</>}>
          <>secret-content</>
        </ProtectedScreen>
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(routerMocks.replace).toHaveBeenCalledWith('/welcome');
  });
});

describe('useRequireAuth()', () => {
  it('reports loading: true while auth hydrates, then authenticated: true', async () => {
    const supabase = buildSupabaseMock({
      access_token: 'jwt',
      refresh_token: 'r',
      user: { id: 'user-1' },
    });
    const Wrapper = wrap(supabase);
    const { result } = renderHook(() => useRequireAuth(), { wrapper: Wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.authenticated).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.authenticated).toBe(true);
  });

  it('triggers the sign-in redirect when no session is present', async () => {
    const supabase = buildSupabaseMock(null);
    const Wrapper = wrap(supabase);
    const { result } = renderHook(() => useRequireAuth(), { wrapper: Wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(routerMocks.replace).toHaveBeenCalledWith('/auth/sign-in');
    expect(result.current.authenticated).toBe(false);
  });
});
