// Tests for the auth resource. We don't run the real Supabase
// SDK — we inject a fake `SupabaseClient` whose `auth` namespace
// is a hand-rolled stub. This keeps the tests deterministic and
// dependency-free while still exercising every branch in the
// adapter (success, SDK-reported error, missing-data, decode).

import { describe, expect, it, vi } from 'vitest';

import { ApiAuthError } from '../error.js';
import { makeAuthResource } from './auth.js';

import type { SupabaseClient } from '@supabase/supabase-js';

interface FakeAuthOps {
  signInWithOAuth?: (...args: unknown[]) => Promise<unknown>;
  signInWithOtp?: (...args: unknown[]) => Promise<unknown>;
  exchangeCodeForSession?: (...args: unknown[]) => Promise<unknown>;
  signOut?: () => Promise<unknown>;
  getSession?: () => Promise<unknown>;
  getUser?: () => Promise<unknown>;
}

function makeAuth(ops: FakeAuthOps = {}): {
  auth: ReturnType<typeof makeAuthResource>;
  ops: FakeAuthOps;
} {
  const supabase = { auth: ops } as unknown as SupabaseClient;
  return {
    auth: makeAuthResource({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      supabaseAuth: supabase,
    }),
    ops,
  };
}

const FIXTURE_SESSION = {
  user: { id: '11111111-1111-4111-8111-111111111111' },
  expires_at: Math.floor(new Date('2026-05-05T12:00:00Z').getTime() / 1000),
};

const FIXTURE_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'pablo@binderly.app',
  created_at: '2026-01-01T00:00:00.000Z',
};

// ============================================================
// signInWithOAuth
// ============================================================

describe('auth.signInWithOAuth', () => {
  it('returns the redirect URL on happy path', async () => {
    const { auth } = makeAuth({
      signInWithOAuth: vi.fn(() =>
        Promise.resolve({
          data: { url: 'https://accounts.google.com/o/oauth2/auth?...' },
          error: null,
        }),
      ),
    });
    const result = await auth.signInWithOAuth({
      provider: 'google',
      redirectTo: 'https://app.binderly.app/auth/callback',
    });
    expect(result.url).toContain('accounts.google.com');
  });

  it('passes provider + options through to the SDK', async () => {
    const spy = vi.fn(() => Promise.resolve({ data: { url: 'https://x' }, error: null }));
    const { auth } = makeAuth({ signInWithOAuth: spy });
    await auth.signInWithOAuth({
      provider: 'apple',
      redirectTo: 'https://app/cb',
      scopes: 'email name',
    });
    expect(spy).toHaveBeenCalledWith({
      provider: 'apple',
      options: { redirectTo: 'https://app/cb', scopes: 'email name' },
    });
  });

  it('throws ApiAuthError when the SDK reports an error', async () => {
    const { auth } = makeAuth({
      signInWithOAuth: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'provider unreachable' } }),
      ),
    });
    await expect(auth.signInWithOAuth({ provider: 'google' })).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('throws ApiAuthError when the SDK returns no URL', async () => {
    const { auth } = makeAuth({
      signInWithOAuth: vi.fn(() => Promise.resolve({ data: { url: null }, error: null })),
    });
    await expect(auth.signInWithOAuth({ provider: 'google' })).rejects.toBeInstanceOf(ApiAuthError);
  });
});

// ============================================================
// signInWithMagicLink
// ============================================================

describe('auth.signInWithMagicLink', () => {
  it('resolves on happy path', async () => {
    const { auth } = makeAuth({
      signInWithOtp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
    });
    await expect(
      auth.signInWithMagicLink({ email: 'pablo@binderly.app' }),
    ).resolves.toBeUndefined();
  });

  it('passes email + emailRedirectTo through', async () => {
    const spy = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    const { auth } = makeAuth({ signInWithOtp: spy });
    await auth.signInWithMagicLink({
      email: 'pablo@binderly.app',
      redirectTo: 'https://app/cb',
      shouldCreateUser: false,
    });
    expect(spy).toHaveBeenCalledWith({
      email: 'pablo@binderly.app',
      options: { emailRedirectTo: 'https://app/cb', shouldCreateUser: false },
    });
  });

  it('throws ApiAuthError when the SDK reports an error', async () => {
    const { auth } = makeAuth({
      signInWithOtp: vi.fn(() => Promise.resolve({ data: null, error: { message: 'rate limit' } })),
    });
    await expect(auth.signInWithMagicLink({ email: 'x@y.com' })).rejects.toBeInstanceOf(
      ApiAuthError,
    );
  });
});

// ============================================================
// exchangeCodeForSession
// ============================================================

describe('auth.exchangeCodeForSession', () => {
  it('returns a SessionDto on happy path', async () => {
    const { auth } = makeAuth({
      exchangeCodeForSession: vi.fn(() =>
        Promise.resolve({ data: { session: FIXTURE_SESSION }, error: null }),
      ),
    });
    const session = await auth.exchangeCodeForSession({ code: 'oauth-code' });
    expect(session.userId).toBe(FIXTURE_SESSION.user.id);
    expect(session.expiresAt).toBe('2026-05-05T12:00:00.000Z');
  });

  it('throws ApiAuthError when the SDK reports an error', async () => {
    const { auth } = makeAuth({
      exchangeCodeForSession: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'invalid code' } }),
      ),
    });
    await expect(auth.exchangeCodeForSession({ code: 'bad' })).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('throws ApiAuthError when the SDK returns no session', async () => {
    const { auth } = makeAuth({
      exchangeCodeForSession: vi.fn(() =>
        Promise.resolve({ data: { session: null }, error: null }),
      ),
    });
    await expect(auth.exchangeCodeForSession({ code: 'x' })).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('throws ApiAuthError when the session is missing expires_at', async () => {
    const { auth } = makeAuth({
      exchangeCodeForSession: vi.fn(() =>
        Promise.resolve({
          data: { session: { user: { id: FIXTURE_SESSION.user.id } } },
          error: null,
        }),
      ),
    });
    await expect(auth.exchangeCodeForSession({ code: 'x' })).rejects.toBeInstanceOf(ApiAuthError);
  });
});

// ============================================================
// signOut
// ============================================================

describe('auth.signOut', () => {
  it('resolves on happy path', async () => {
    const { auth } = makeAuth({ signOut: vi.fn(() => Promise.resolve({ error: null })) });
    await expect(auth.signOut()).resolves.toBeUndefined();
  });

  it('throws ApiAuthError when the SDK reports an error', async () => {
    const { auth } = makeAuth({
      signOut: vi.fn(() => Promise.resolve({ error: { message: 'broke' } })),
    });
    await expect(auth.signOut()).rejects.toBeInstanceOf(ApiAuthError);
  });
});

// ============================================================
// getSession
// ============================================================

describe('auth.getSession', () => {
  it('returns the SessionDto on happy path', async () => {
    const { auth } = makeAuth({
      getSession: vi.fn(() => Promise.resolve({ data: { session: FIXTURE_SESSION }, error: null })),
    });
    const session = await auth.getSession();
    expect(session?.userId).toBe(FIXTURE_SESSION.user.id);
  });

  it('returns null when there is no session', async () => {
    const { auth } = makeAuth({
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    });
    expect(await auth.getSession()).toBeNull();
  });

  it('throws ApiAuthError when the SDK reports an error', async () => {
    const { auth } = makeAuth({
      getSession: vi.fn(() => Promise.resolve({ data: null, error: { message: 'broke' } })),
    });
    await expect(auth.getSession()).rejects.toBeInstanceOf(ApiAuthError);
  });
});

// ============================================================
// getCurrentUser
// ============================================================

describe('auth.getCurrentUser', () => {
  it('returns the UserDto on happy path', async () => {
    const { auth } = makeAuth({
      getUser: vi.fn(() => Promise.resolve({ data: { user: FIXTURE_USER }, error: null })),
    });
    const user = await auth.getCurrentUser();
    expect(user?.id).toBe(FIXTURE_USER.id);
    expect(user?.email).toBe(FIXTURE_USER.email);
  });

  it('returns null when the SDK errors with "session" in the message', async () => {
    const { auth } = makeAuth({
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: null }, error: { message: 'no session' } }),
      ),
    });
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it('returns null when the SDK errors with "not logged" in the message', async () => {
    const { auth } = makeAuth({
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: null }, error: { message: 'user not logged in' } }),
      ),
    });
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it('throws ApiAuthError on other SDK errors', async () => {
    const { auth } = makeAuth({
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: null }, error: { message: 'network failure' } }),
      ),
    });
    await expect(auth.getCurrentUser()).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('returns null when the SDK returns no user', async () => {
    const { auth } = makeAuth({
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    });
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it('throws ApiAuthError when user payload fails dto validation', async () => {
    const { auth } = makeAuth({
      getUser: vi.fn(() =>
        Promise.resolve({
          data: { user: { id: 'not-a-uuid', email: 'x', created_at: 'bad-date' } },
          error: null,
        }),
      ),
    });
    await expect(auth.getCurrentUser()).rejects.toBeInstanceOf(ApiAuthError);
  });
});

// ============================================================
// raw
// ============================================================

describe('auth.raw', () => {
  it('returns the underlying supabase client', () => {
    const fakeSb = { auth: {} } as unknown as SupabaseClient;
    const auth = makeAuthResource({
      baseUrl: 'http://localhost:54321',
      apiKey: 'anon',
      supabaseAuth: fakeSb,
    });
    expect(auth.raw()).toBe(fakeSb);
  });
});
