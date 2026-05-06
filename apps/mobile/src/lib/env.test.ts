import { describe, expect, it } from 'vitest';

import { MobileEnvError, REQUIRED_ENV_KEYS, loadMobileEnv, tryLoadMobileEnv } from './env';

const validSource = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
} as const;

describe('loadMobileEnv', () => {
  it('returns a typed env when every required key is set', () => {
    const env = loadMobileEnv(validSource);
    expect(env).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-key',
      apiBaseUrl: 'https://abc.supabase.co',
    });
  });

  it('strips trailing slashes from the supabase url and api base url', () => {
    const env = loadMobileEnv({
      EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co/',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      EXPO_PUBLIC_API_URL: 'https://api.binderly.app/',
    });
    expect(env.supabaseUrl).toBe('https://abc.supabase.co');
    expect(env.apiBaseUrl).toBe('https://api.binderly.app');
  });

  it('falls back to supabase url when EXPO_PUBLIC_API_URL is unset', () => {
    const env = loadMobileEnv(validSource);
    expect(env.apiBaseUrl).toBe(env.supabaseUrl);
  });

  it('uses EXPO_PUBLIC_API_URL when both are set', () => {
    const env = loadMobileEnv({
      ...validSource,
      EXPO_PUBLIC_API_URL: 'https://api.binderly.app',
    });
    expect(env.apiBaseUrl).toBe('https://api.binderly.app');
    expect(env.supabaseUrl).toBe('https://abc.supabase.co');
  });

  it('throws MobileEnvError listing every missing required key', () => {
    expect(() => loadMobileEnv({})).toThrowError(MobileEnvError);
    try {
      loadMobileEnv({});
    } catch (error) {
      expect(error).toBeInstanceOf(MobileEnvError);
      const e = error as MobileEnvError;
      expect(e.missing).toEqual([...REQUIRED_ENV_KEYS]);
      expect(e.message).toMatch(/EXPO_PUBLIC_SUPABASE_URL/);
      expect(e.message).toMatch(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
      expect(e.name).toBe('MobileEnvError');
    }
  });

  it('lists only the missing key when one is set', () => {
    expect.assertions(2);
    try {
      loadMobileEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' });
    } catch (error) {
      const e = error as MobileEnvError;
      expect(e.missing).toEqual(['EXPO_PUBLIC_SUPABASE_ANON_KEY']);
      expect(e.message).toMatch(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    }
  });

  it('treats empty strings as missing', () => {
    expect(() =>
      loadMobileEnv({
        EXPO_PUBLIC_SUPABASE_URL: '',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
      }),
    ).toThrowError(MobileEnvError);
  });

  it('treats whitespace as a present value (caller-side validation only)', () => {
    // We do not trim — the loader's job is presence + type check.
    // Caller code (the api-client, supabase) will reject malformed
    // URLs at use time. Documenting this boundary explicitly.
    const env = loadMobileEnv({
      EXPO_PUBLIC_SUPABASE_URL: ' ',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: ' ',
    });
    expect(env.supabaseUrl).toBe(' ');
    expect(env.supabaseAnonKey).toBe(' ');
  });

  it('reads from process.env by default', () => {
    const original = process.env['EXPO_PUBLIC_SUPABASE_URL'];
    const originalKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
    try {
      process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'https://default.supabase.co';
      process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'default-anon';
      const env = loadMobileEnv();
      expect(env.supabaseUrl).toBe('https://default.supabase.co');
      expect(env.supabaseAnonKey).toBe('default-anon');
    } finally {
      if (original === undefined) delete process.env['EXPO_PUBLIC_SUPABASE_URL'];
      else process.env['EXPO_PUBLIC_SUPABASE_URL'] = original;
      if (originalKey === undefined) delete process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
      else process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = originalKey;
    }
  });
});

describe('REQUIRED_ENV_KEYS', () => {
  it('lists exactly the two required Expo public keys', () => {
    expect([...REQUIRED_ENV_KEYS]).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    ]);
  });
});

describe('tryLoadMobileEnv', () => {
  it('returns ok: true on a valid source', () => {
    const result = tryLoadMobileEnv(validSource);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.supabaseUrl).toBe('https://abc.supabase.co');
    }
  });

  it('returns ok: false with the typed error on a missing key', () => {
    const result = tryLoadMobileEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(MobileEnvError);
      expect(result.error.missing.length).toBeGreaterThan(0);
    }
  });

  it('rethrows non-MobileEnvError causes', () => {
    // Pass a Proxy that throws something else. Demonstrates we don't
    // swallow unexpected errors as `{ ok: false }` — only typed env
    // problems get the soft path.
    const throwingSource = new Proxy({} as Record<string, string>, {
      get() {
        throw new TypeError('proxy explosion');
      },
    });
    expect(() => tryLoadMobileEnv(throwingSource)).toThrow(TypeError);
  });
});

describe('MobileEnvError', () => {
  it('preserves the missing-key list and name', () => {
    const err = new MobileEnvError(['EXPO_PUBLIC_SUPABASE_URL']);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MobileEnvError);
    expect(err.name).toBe('MobileEnvError');
    expect(err.missing).toEqual(['EXPO_PUBLIC_SUPABASE_URL']);
  });
});
