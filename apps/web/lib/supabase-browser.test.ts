import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetBrowserSupabaseForTests, getBrowserSupabase } from './supabase-browser';

describe('getBrowserSupabase', () => {
  const originalUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const originalKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  beforeEach(() => {
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://example.supabase.co';
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon-key';
    __resetBrowserSupabaseForTests();
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
    } else {
      process.env['NEXT_PUBLIC_SUPABASE_URL'] = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    } else {
      process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = originalKey;
    }
    __resetBrowserSupabaseForTests();
  });

  it('returns a SupabaseClient with an auth namespace', () => {
    const client = getBrowserSupabase();
    expect(client).toBeDefined();
    expect(client.auth).toBeDefined();
    expect(typeof client.auth.getSession).toBe('function');
  });

  it('returns the same instance on repeat calls (singleton)', () => {
    const a = getBrowserSupabase();
    const b = getBrowserSupabase();
    expect(a).toBe(b);
  });

  it('builds a fresh instance after reset', () => {
    const a = getBrowserSupabase();
    __resetBrowserSupabaseForTests();
    const b = getBrowserSupabase();
    expect(a).not.toBe(b);
  });
});
