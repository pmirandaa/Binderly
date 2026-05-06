import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetApiClientForTests, getApiClient } from './api-client';
import { __resetBrowserSupabaseForTests } from './supabase-browser';

describe('getApiClient', () => {
  const originalUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const originalKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  beforeEach(() => {
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://example.supabase.co';
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon-key';
    __resetApiClientForTests();
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
    __resetApiClientForTests();
    __resetBrowserSupabaseForTests();
  });

  it('returns a frozen client with all seven resource namespaces', () => {
    const client = getApiClient();
    expect(client).toBeDefined();
    expect(client.cards).toBeDefined();
    expect(client.collection).toBeDefined();
    expect(client.pricing).toBeDefined();
    expect(client.grading).toBeDefined();
    expect(client.shareables).toBeDefined();
    expect(client.profile).toBeDefined();
    expect(client.auth).toBeDefined();
  });

  it('returns the same singleton on repeat calls', () => {
    const a = getApiClient();
    const b = getApiClient();
    expect(a).toBe(b);
  });

  it('builds a fresh instance after reset', () => {
    const a = getApiClient();
    __resetApiClientForTests();
    __resetBrowserSupabaseForTests();
    const b = getApiClient();
    expect(a).not.toBe(b);
  });

  it('throws synchronously when env keys are missing', () => {
    delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
    __resetApiClientForTests();
    __resetBrowserSupabaseForTests();
    expect(() => getApiClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('exposes the underlying http client via the escape hatch', () => {
    const client = getApiClient();
    expect(client.http).toBeDefined();
    expect(typeof client.http.request).toBe('function');
  });
});
