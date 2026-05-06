import { describe, expect, it } from 'vitest';

import { REQUIRED_ENV_KEYS, loadWebEnv } from './env';

describe('loadWebEnv', () => {
  it('returns a typed env object when all required keys are set', () => {
    const env = loadWebEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(env.supabaseUrl).toBe('https://example.supabase.co');
    expect(env.supabaseAnonKey).toBe('anon-key');
    expect(env.r2PublicBaseUrl).toBeUndefined();
    expect(env.appUrl).toBeUndefined();
  });

  it('strips trailing slash from supabaseUrl', () => {
    const env = loadWebEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co/',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(env.supabaseUrl).toBe('https://example.supabase.co');
  });

  it('strips trailing slash from r2PublicBaseUrl when provided', () => {
    const env = loadWebEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      NEXT_PUBLIC_R2_PUBLIC_BASE_URL: 'https://images.binderly.app/',
    });
    expect(env.r2PublicBaseUrl).toBe('https://images.binderly.app');
  });

  it('strips trailing slash from appUrl when provided', () => {
    const env = loadWebEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      NEXT_PUBLIC_APP_URL: 'https://binderly.app/',
    });
    expect(env.appUrl).toBe('https://binderly.app');
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    expect(() =>
      loadWebEnv({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    expect(() =>
      loadWebEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('throws listing every missing key when both are absent', () => {
    expect(() => loadWebEnv({})).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_ANON_KEY/s,
    );
  });

  it('treats empty strings as missing', () => {
    expect(() =>
      loadWebEnv({
        NEXT_PUBLIC_SUPABASE_URL: '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('treats empty optional R2 URL as undefined (no throw)', () => {
    const env = loadWebEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      NEXT_PUBLIC_R2_PUBLIC_BASE_URL: '',
    });
    expect(env.r2PublicBaseUrl).toBeUndefined();
  });

  it('exposes REQUIRED_ENV_KEYS for documentation', () => {
    expect(REQUIRED_ENV_KEYS).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]);
  });
});
