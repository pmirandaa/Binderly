// Unit tests for the typed env loader.

import { describe, expect, it } from 'vitest';

import { loadAuthEnv, REQUIRED_ENV_KEYS } from './env.js';

describe('loadAuthEnv', () => {
  it('returns the typed env when every required key is present + non-empty', () => {
    const env = loadAuthEnv({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      EXTRA_KEY: 'ignored',
    });
    expect(env).toEqual({
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'anon',
      supabaseServiceRoleKey: 'service-role',
    });
  });

  it('throws listing every missing key when the env source is empty', () => {
    expect.assertions(1 + REQUIRED_ENV_KEYS.length);
    try {
      loadAuthEnv({});
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/missing required env vars/);
      for (const key of REQUIRED_ENV_KEYS) {
        expect(message).toContain(key);
      }
    }
  });

  it('treats empty strings as missing (not "supplied with empty value")', () => {
    expect.assertions(2);
    try {
      loadAuthEnv({
        SUPABASE_URL: 'http://localhost:54321',
        SUPABASE_ANON_KEY: '',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/missing required env vars/);
      expect(message).toContain('SUPABASE_ANON_KEY');
    }
  });
});
