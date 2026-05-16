import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors.ts';
import {
  createServiceRoleClient,
  createUserScopedClient,
  requireUser,
  translatePostgrestError,
  type ClientFactoryDeps,
  type EdgeFunctionEnv,
} from './db.ts';
import { buildRequest, makeFakeJwt, makeFakeUser } from './test-helpers.ts';

import type { SupabaseClient } from '@supabase/supabase-js';

const ENV: EdgeFunctionEnv = {
  supabaseUrl: 'https://test.supabase.test',
  supabaseAnonKey: 'anon-key',
  supabaseServiceRoleKey: 'service-role-key',
  corsAllowOrigins: ['*'],
};

describe('createUserScopedClient', () => {
  it('passes Authorization Bearer header into the client config', () => {
    const factory = vi.fn().mockReturnValue({} as SupabaseClient);
    const deps: ClientFactoryDeps = { createClient: factory };
    createUserScopedClient(ENV, 'token-1', deps);
    expect(factory).toHaveBeenCalledTimes(1);
    const callArgs = factory.mock.calls[0]!;
    expect(callArgs[0]).toBe(ENV.supabaseUrl);
    expect(callArgs[1]).toBe(ENV.supabaseAnonKey);
    expect(callArgs[2]?.global?.headers?.Authorization).toBe('Bearer token-1');
  });

  it('disables session persistence', () => {
    const factory = vi.fn().mockReturnValue({} as SupabaseClient);
    createUserScopedClient(ENV, 'tok', { createClient: factory });
    const callArgs = factory.mock.calls[0]!;
    expect(callArgs[2]?.auth?.persistSession).toBe(false);
    expect(callArgs[2]?.auth?.autoRefreshToken).toBe(false);
  });

  it('throws when the jwt is empty', () => {
    expect(() => createUserScopedClient(ENV, '', { createClient: vi.fn() })).toThrow(/non-empty/);
  });
});

describe('createServiceRoleClient', () => {
  it('uses the service-role key, NOT the anon key', () => {
    const factory = vi.fn().mockReturnValue({} as SupabaseClient);
    createServiceRoleClient(ENV, { createClient: factory });
    const callArgs = factory.mock.calls[0]!;
    expect(callArgs[1]).toBe(ENV.supabaseServiceRoleKey);
    expect(callArgs[1]).not.toBe(ENV.supabaseAnonKey);
  });
});

describe('requireUser', () => {
  it('returns user + claims + supabase when getUser succeeds', async () => {
    const fakeUser = makeFakeUser();
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: fakeUser }, error: null }),
      },
    } as unknown as SupabaseClient;
    const factory = vi.fn().mockReturnValue(supabase);
    const request = buildRequest({
      url: 'http://localhost/v1/me/collection',
      method: 'GET',
      token: makeFakeJwt(),
    });
    const session = await requireUser(request, ENV, { createClient: factory });
    expect(session.user).toBe(fakeUser);
    expect(session.claims.role).toBe('authenticated');
    expect(session.token.length).toBeGreaterThan(0);
  });

  it('throws AUTH error when authorization header is missing', async () => {
    const supabase = {
      auth: { getUser: vi.fn() },
    } as unknown as SupabaseClient;
    const request = new Request('http://localhost/v1/me/collection');
    await expect(
      requireUser(request, ENV, { createClient: vi.fn().mockReturnValue(supabase) }),
    ).rejects.toThrow(ApiError);
  });

  it('throws AUTH when supabase returns an auth error', async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: 'bad_jwt', message: 'invalid jwt', status: 401 },
        }),
      },
    } as unknown as SupabaseClient;
    const request = buildRequest({
      url: 'http://localhost/v1/me/collection',
      method: 'GET',
      token: makeFakeJwt(),
    });
    await expect(
      requireUser(request, ENV, { createClient: vi.fn().mockReturnValue(supabase) }),
    ).rejects.toThrow(/invalid jwt/);
  });

  it('translates 5xx supabase errors into INTERNAL', async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: '', message: 'down', status: 503 },
        }),
      },
    } as unknown as SupabaseClient;
    const request = buildRequest({
      url: 'http://localhost/v1/me/collection',
      method: 'GET',
      token: makeFakeJwt(),
    });
    await expect(
      requireUser(request, ENV, { createClient: vi.fn().mockReturnValue(supabase) }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('throws AUTH when supabase returns no user and no error', async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as unknown as SupabaseClient;
    const request = buildRequest({
      url: 'http://localhost/v1/me/collection',
      method: 'GET',
      token: makeFakeJwt(),
    });
    await expect(
      requireUser(request, ENV, { createClient: vi.fn().mockReturnValue(supabase) }),
    ).rejects.toMatchObject({ code: 'AUTH' });
  });
});

describe('translatePostgrestError', () => {
  it('maps PGRST116 to NOT_FOUND', () => {
    const err = translatePostgrestError({ code: 'PGRST116', message: 'no rows' });
    expect(err.code).toBe('NOT_FOUND');
  });

  it('maps 23505 (unique violation) to CONFLICT', () => {
    const err = translatePostgrestError({ code: '23505', message: 'duplicate' });
    expect(err.code).toBe('CONFLICT');
  });

  it('maps 42501 (RLS denial) to AUTH 403', () => {
    const err = translatePostgrestError({ code: '42501', message: 'denied' });
    expect(err.code).toBe('AUTH');
    expect(err.status).toBe(403);
  });

  it('maps P0001 (raise) to VALIDATION', () => {
    const err = translatePostgrestError({ code: 'P0001', message: 'check fail' });
    expect(err.code).toBe('VALIDATION');
  });

  it('maps unrecognized codes to INTERNAL', () => {
    const err = translatePostgrestError({ code: 'XX999', message: 'mystery' });
    expect(err.code).toBe('INTERNAL');
  });

  it('threads details through to the ApiError', () => {
    const err = translatePostgrestError({
      code: '23505',
      message: 'dup',
      details: 'Key (printing_id)=(abc) already exists.',
    });
    expect(err.details).toEqual({ details: 'Key (printing_id)=(abc) already exists.' });
  });
});
