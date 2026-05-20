// Tests for `useBillingBootstrap()` — the React-side glue that
// wires auth-state transitions to RevenueCat configure / logIn /
// logOut. The init module is exercised in two ways:
//
//   1. Through a custom AuthProvider-equivalent shim that lets us
//      flip session state from `null` to `{ user }` and back.
//      This is the contract surface that the real app shell uses,
//      so we mirror it.
//
//   2. The real `react-native-purchases` module is mocked at the
//      module-level so we can assert configure/logIn/logOut calls
//      directly.

import { act, renderHook } from '@testing-library/react';
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetBillingForTesting, useBillingBootstrap } from '../init.js';

import type { Session, User } from '@supabase/supabase-js';

const { mockPurchases } = vi.hoisted(() => {
  const mock = {
    configure: vi.fn(),
    logIn: vi.fn(async (id: string) => ({
      customerInfo: { __mock__: true, id },
      created: false,
    })),
    logOut: vi.fn(async () => ({ __mock__: true })),
    getOfferings: vi.fn(async () => ({ all: {}, current: null })),
    getCustomerInfo: vi.fn(async () => ({ __mock__: true })),
    purchasePackage: vi.fn(async () => ({
      customerInfo: { __mock__: true },
      productIdentifier: 'p',
    })),
    restorePurchases: vi.fn(async () => ({ __mock__: true })),
  };
  return { mockPurchases: mock };
});

vi.mock('react-native-purchases', () => ({ default: mockPurchases }));

// Mock the AuthProvider's useAuth — we drive it from a local
// controllable context so the test can flip session state without
// pulling Supabase into jsdom.
type Auth = { session: Session | null; loading: boolean };
const AuthControlContext = createContext<Auth>({ session: null, loading: false });

// vitest hoists `vi.mock` calls above all imports, so the mock is
// registered before `../init.js`'s `useBillingBootstrap` is loaded
// (which is why this works despite the static import appearing
// "above" the mock declaration in source order).
vi.mock('../../components/providers/AuthProvider.js', () => ({
  useAuth: (): Auth & { user: User | null; signOut: () => Promise<void> } => {
    const value = useContext(AuthControlContext);
    return {
      ...value,
      user: value.session?.user ?? null,
      signOut: async () => {
        /* no-op */
      },
    };
  },
}));

function makeSession(userId: string): Session {
  return {
    access_token: 'tkn',
    refresh_token: 'rfr',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, app_metadata: {}, user_metadata: {}, aud: 'authenticated' } as User,
  } as Session;
}

function controllableAuthHarness(initial: Auth) {
  let setter: ((next: Auth) => void) | null = null;
  function Wrapper({ children }: { children: ReactNode }): React.ReactElement {
    const [auth, setAuth] = useState<Auth>(initial);
    setter = setAuth;
    return (
      <AuthControlContext.Provider value={auth}>{children}</AuthControlContext.Provider>
    );
  }
  function flip(next: Auth): void {
    if (setter === null) throw new Error('harness not mounted');
    setter(next);
  }
  return { Wrapper, flip };
}

beforeEach(() => {
  resetBillingForTesting();
  mockPurchases.configure.mockClear();
  mockPurchases.logIn.mockClear();
  mockPurchases.logOut.mockClear();
});

afterEach(() => {
  resetBillingForTesting();
});

describe('useBillingBootstrap', () => {
  it('does nothing while auth is still loading', () => {
    const harness = controllableAuthHarness({ session: null, loading: true });
    renderHook(
      () =>
        useBillingBootstrap({ iosKey: 'k', androidKey: undefined, platform: 'ios' }),
      { wrapper: harness.Wrapper },
    );
    expect(mockPurchases.configure).not.toHaveBeenCalled();
  });

  it('configures with anonymous appUserID when auth resolves to a null session', () => {
    const harness = controllableAuthHarness({ session: null, loading: false });
    renderHook(
      () =>
        useBillingBootstrap({ iosKey: 'k', androidKey: undefined, platform: 'ios' }),
      { wrapper: harness.Wrapper },
    );
    expect(mockPurchases.configure).toHaveBeenCalledWith({
      apiKey: 'k',
      appUserID: null,
    });
  });

  it('configures with the supabase user id once auth resolves', () => {
    const harness = controllableAuthHarness({
      session: makeSession('user-42'),
      loading: false,
    });
    renderHook(
      () =>
        useBillingBootstrap({ iosKey: 'k', androidKey: undefined, platform: 'ios' }),
      { wrapper: harness.Wrapper },
    );
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.configure).toHaveBeenCalledWith({
      apiKey: 'k',
      appUserID: 'user-42',
    });
  });

  it('calls Purchases.logOut() then re-configures anonymous on sign-out', async () => {
    const harness = controllableAuthHarness({
      session: makeSession('user-42'),
      loading: false,
    });
    renderHook(
      () =>
        useBillingBootstrap({ iosKey: 'k', androidKey: undefined, platform: 'ios' }),
      { wrapper: harness.Wrapper },
    );
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);

    await act(async () => {
      harness.flip({ session: null, loading: false });
    });
    expect(mockPurchases.logOut).toHaveBeenCalledTimes(1);
    // Configure still ran once total (subsequent transitions go
    // through logIn / logOut instead of re-configure).
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
  });

  it('calls Purchases.logIn(newId) on user-id change', async () => {
    const harness = controllableAuthHarness({
      session: makeSession('user-1'),
      loading: false,
    });
    renderHook(
      () =>
        useBillingBootstrap({ iosKey: 'k', androidKey: undefined, platform: 'ios' }),
      { wrapper: harness.Wrapper },
    );

    await act(async () => {
      harness.flip({ session: makeSession('user-2'), loading: false });
    });
    expect(mockPurchases.logIn).toHaveBeenCalledWith('user-2');
  });

  it('is idempotent across re-renders with the same user', () => {
    const harness = controllableAuthHarness({
      session: makeSession('user-1'),
      loading: false,
    });
    const { rerender } = renderHook(
      () =>
        useBillingBootstrap({ iosKey: 'k', androidKey: undefined, platform: 'ios' }),
      { wrapper: harness.Wrapper },
    );
    rerender();
    rerender();
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).not.toHaveBeenCalled();
  });
});
