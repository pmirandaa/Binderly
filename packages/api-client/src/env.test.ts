// Unit tests for the typed env loader.

import { describe, expect, it } from 'vitest';

import { loadClientEnv, REQUIRED_ENV_KEYS } from './env.js';

describe('loadClientEnv', () => {
  it('returns the typed env when API_BASE_URL + SUPABASE_ANON_KEY are present', () => {
    const env = loadClientEnv({
      API_BASE_URL: 'https://api.binderly.app',
      SUPABASE_ANON_KEY: 'anon',
    });
    expect(env).toEqual({
      baseUrl: 'https://api.binderly.app',
      apiKey: 'anon',
    });
  });

  it('falls back to SUPABASE_URL when API_BASE_URL is missing', () => {
    const env = loadClientEnv({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'anon',
    });
    expect(env.baseUrl).toBe('http://localhost:54321');
  });

  it('prefers API_BASE_URL over SUPABASE_URL when both are present', () => {
    const env = loadClientEnv({
      API_BASE_URL: 'https://api.binderly.app',
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'anon',
    });
    expect(env.baseUrl).toBe('https://api.binderly.app');
  });

  it('strips a trailing slash from the base URL', () => {
    const env = loadClientEnv({
      API_BASE_URL: 'https://api.binderly.app/',
      SUPABASE_ANON_KEY: 'anon',
    });
    expect(env.baseUrl).toBe('https://api.binderly.app');
  });

  it('throws listing every missing key when the env source is empty', () => {
    expect.assertions(3);
    try {
      loadClientEnv({});
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/missing required env vars/);
      expect(message).toContain('API_BASE_URL or SUPABASE_URL');
      expect(message).toContain('SUPABASE_ANON_KEY');
    }
  });

  it('treats empty strings as missing (not "supplied with empty value")', () => {
    expect.assertions(2);
    try {
      loadClientEnv({
        API_BASE_URL: 'https://api.binderly.app',
        SUPABASE_ANON_KEY: '',
      });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/missing required env vars/);
      expect(message).toContain('SUPABASE_ANON_KEY');
    }
  });

  it('treats both base URL fallbacks as missing if both are empty', () => {
    expect.assertions(2);
    try {
      loadClientEnv({
        API_BASE_URL: '',
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: 'anon',
      });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/missing required env vars/);
      expect(message).toContain('API_BASE_URL or SUPABASE_URL');
    }
  });

  it('REQUIRED_ENV_KEYS lists SUPABASE_ANON_KEY (the always-required key)', () => {
    expect(REQUIRED_ENV_KEYS).toContain('SUPABASE_ANON_KEY');
  });

  it('ignores unknown keys in the source', () => {
    const env = loadClientEnv({
      API_BASE_URL: 'https://api.binderly.app',
      SUPABASE_ANON_KEY: 'anon',
      UNRELATED_KEY: 'whatever',
    });
    expect(env).toEqual({
      baseUrl: 'https://api.binderly.app',
      apiKey: 'anon',
    });
  });
});
