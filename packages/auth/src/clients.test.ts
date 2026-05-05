// Unit tests for the Supabase client factories.
//
// We don't exercise real PostgREST roundtrips here — that's what the
// verify-rls behavioral suite does end-to-end against a live
// Supabase. Here we assert the wiring: the factory passes the right
// URL + key + options shape to `createClient`.

import { describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient, createUserScopedClient } from './clients.js';

import type { AuthEnv } from './types.js';

const ENV: AuthEnv = {
  supabaseUrl: 'http://localhost:54321',
  supabaseAnonKey: 'anon-key',
  supabaseServiceRoleKey: 'service-role-key',
};

describe('createUserScopedClient', () => {
  it('passes the URL + anon key + Authorization header to createClient', () => {
    const stub = vi.fn().mockReturnValue({} as never);
    createUserScopedClient('user-jwt', ENV, { createClient: stub });
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, key, options] = stub.mock.calls[0]!;
    expect(url).toBe(ENV.supabaseUrl);
    expect(key).toBe(ENV.supabaseAnonKey);
    expect(options?.global?.headers).toEqual({ Authorization: 'Bearer user-jwt' });
  });

  it('disables session persistence + auto-refresh + URL detection (server-side posture)', () => {
    const stub = vi.fn().mockReturnValue({} as never);
    createUserScopedClient('user-jwt', ENV, { createClient: stub });
    const options = stub.mock.calls[0]?.[2];
    expect(options?.auth?.persistSession).toBe(false);
    expect(options?.auth?.autoRefreshToken).toBe(false);
    expect(options?.auth?.detectSessionInUrl).toBe(false);
  });

  it('throws on an empty JWT (refuses to build an unscoped "user" client)', () => {
    const stub = vi.fn().mockReturnValue({} as never);
    expect(() => createUserScopedClient('', ENV, { createClient: stub })).toThrowError(
      /jwt must be a non-empty string/,
    );
    expect(stub).not.toHaveBeenCalled();
  });
});

describe('createServiceRoleClient', () => {
  it('passes the URL + service-role key (no Authorization header) to createClient', () => {
    const stub = vi.fn().mockReturnValue({} as never);
    createServiceRoleClient(ENV, { createClient: stub });
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, key, options] = stub.mock.calls[0]!;
    expect(url).toBe(ENV.supabaseUrl);
    expect(key).toBe(ENV.supabaseServiceRoleKey);
    // Critically: no Authorization header — this would let a leaked
    // user token override the service-role key for that call.
    expect(options?.global?.headers).toBeUndefined();
  });

  it('uses a different key from the user-scoped client (no key reuse / leakage)', () => {
    const stub = vi.fn().mockReturnValue({} as never);
    createUserScopedClient('user-jwt', ENV, { createClient: stub });
    createServiceRoleClient(ENV, { createClient: stub });
    expect(stub.mock.calls[0]?.[1]).toBe(ENV.supabaseAnonKey);
    expect(stub.mock.calls[1]?.[1]).toBe(ENV.supabaseServiceRoleKey);
    expect(stub.mock.calls[0]?.[1]).not.toBe(stub.mock.calls[1]?.[1]);
  });
});
