// Unit tests for `requireUser` / `getSessionFromRequest` /
// `verifyAccessToken`. We mock the Supabase `createClient` factory so
// no network round-trip happens. The mock returns a configurable
// `auth.getUser` fn that simulates the SDK's data/error tuple.

import { describe, expect, it, vi } from 'vitest';

import { AuthError } from './errors.js';
import { getSessionFromRequest, requireUser, verifyAccessToken } from './session.js';

import type { AuthEnv } from './types.js';
import type { AuthError as SupabaseAuthError, SupabaseClient, User } from '@supabase/supabase-js';

const ENV: AuthEnv = {
  supabaseUrl: 'http://localhost:54321',
  supabaseAnonKey: 'anon-key',
  supabaseServiceRoleKey: 'service-role-key',
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature-not-verified-here`;
}

function freshToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({
    sub: '11111111-1111-1111-1111-111111111111',
    role: 'authenticated',
    email: 'verify@example.com',
    iat: now,
    exp: now + 3600,
    ...overrides,
  });
}

function expiredToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({
    sub: '11111111-1111-1111-1111-111111111111',
    role: 'authenticated',
    iat: now - 7200,
    exp: now - 3600,
  });
}

interface MockClientOptions {
  readonly user?: Partial<User>;
  readonly error?: Partial<SupabaseAuthError> | null;
}

function mockSupabaseClientFactory(opts: MockClientOptions = {}) {
  const getUser = vi.fn().mockResolvedValue({
    data: {
      user:
        opts.error !== undefined && opts.error !== null
          ? null
          : ({
              id: '11111111-1111-1111-1111-111111111111',
              email: 'verify@example.com',
              ...opts.user,
            } as User),
    },
    error: opts.error ?? null,
  });
  const stub = vi.fn().mockReturnValue({
    auth: { getUser },
  } as unknown as SupabaseClient);
  return { stub, getUser };
}

describe('verifyAccessToken (happy path)', () => {
  it('returns user + claims + supabase client when the token is valid', async () => {
    const token = freshToken();
    const { stub, getUser } = mockSupabaseClientFactory();
    const session = await verifyAccessToken(token, ENV, { createClient: stub });
    expect(getUser).toHaveBeenCalledWith(token);
    expect(session.user.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(session.claims.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(session.claims.role).toBe('authenticated');
    expect(session.supabase).toBeDefined();
  });
});

describe('verifyAccessToken (error paths)', () => {
  it('throws expired_token for a JWT past its exp', async () => {
    expect.assertions(2);
    const { stub } = mockSupabaseClientFactory();
    try {
      await verifyAccessToken(expiredToken(), ENV, { createClient: stub });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('expired_token');
    }
  });

  it('throws invalid_token when the role claim is wrong', async () => {
    expect.assertions(2);
    const { stub } = mockSupabaseClientFactory();
    const token = freshToken({ role: 'anon' });
    try {
      await verifyAccessToken(token, ENV, { createClient: stub });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('throws invalid_token when Supabase rejects the token (4xx error from SDK)', async () => {
    expect.assertions(2);
    const { stub } = mockSupabaseClientFactory({
      error: { message: 'jwt is bad', status: 401, code: 'bad_jwt' } as SupabaseAuthError,
    });
    try {
      await verifyAccessToken(freshToken(), ENV, { createClient: stub });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('throws expired_token when Supabase reports session_expired', async () => {
    expect.assertions(2);
    const { stub } = mockSupabaseClientFactory({
      error: {
        message: 'session expired',
        status: 401,
        code: 'session_expired',
      } as SupabaseAuthError,
    });
    try {
      await verifyAccessToken(freshToken(), ENV, { createClient: stub });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('expired_token');
    }
  });

  it('throws service_unavailable when Supabase returns a 5xx', async () => {
    expect.assertions(2);
    const { stub } = mockSupabaseClientFactory({
      error: {
        message: 'gotrue is down',
        status: 503,
        code: 'service_unavailable',
      } as SupabaseAuthError,
    });
    try {
      await verifyAccessToken(freshToken(), ENV, { createClient: stub });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('service_unavailable');
    }
  });
});

describe('requireUser', () => {
  it('returns a session for a request with Authorization: Bearer <token>', async () => {
    const token = freshToken();
    const { stub } = mockSupabaseClientFactory();
    const request = { headers: new Headers({ Authorization: `Bearer ${token}` }) };
    const session = await requireUser(request, ENV, {}, { createClient: stub });
    expect(session.user.id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('throws missing_token when no Authorization header is present', async () => {
    expect.assertions(2);
    const { stub } = mockSupabaseClientFactory();
    const request = { headers: new Headers() };
    try {
      await requireUser(request, ENV, {}, { createClient: stub });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('missing_token');
    }
  });

  it('respects a custom header name override', async () => {
    const token = freshToken();
    const { stub } = mockSupabaseClientFactory();
    const request = { headers: new Headers({ 'x-custom-auth': `Bearer ${token}` }) };
    const session = await requireUser(
      request,
      ENV,
      { headerName: 'x-custom-auth' },
      { createClient: stub },
    );
    expect(session.user.id).toBe('11111111-1111-1111-1111-111111111111');
  });
});

describe('getSessionFromRequest', () => {
  it('returns null instead of throwing when the token is missing', async () => {
    const { stub } = mockSupabaseClientFactory();
    const request = { headers: new Headers() };
    const session = await getSessionFromRequest(request, ENV, {}, { createClient: stub });
    expect(session).toBeNull();
  });

  it('still throws on invalid tokens (a malformed token is a bad client, not a public visitor)', async () => {
    expect.assertions(2);
    const { stub } = mockSupabaseClientFactory();
    const request = { headers: new Headers({ Authorization: 'Bearer notajwt' }) };
    try {
      await getSessionFromRequest(request, ENV, {}, { createClient: stub });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });
});
