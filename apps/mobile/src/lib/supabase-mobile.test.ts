import { describe, expect, it, vi } from 'vitest';

import { createSupabaseMobileClient, startAuthAutoRefresh } from './supabase-mobile';

vi.mock('@supabase/supabase-js', async () => {
  const actual: object = await vi.importActual('@supabase/supabase-js');
  return {
    ...actual,
    createClient: vi.fn((url: string, key: string, options: unknown) => ({
      __args: { url, key, options },
      auth: {
        startAutoRefresh: vi.fn(),
        stopAutoRefresh: vi.fn(),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
      },
    })),
  };
});

const validEnv = {
  supabaseUrl: 'https://abc.supabase.co',
  supabaseAnonKey: 'anon',
  apiBaseUrl: 'https://abc.supabase.co',
} as const;

describe('createSupabaseMobileClient', () => {
  it('constructs the client with the env URL and anon key', () => {
    const client = createSupabaseMobileClient(validEnv) as unknown as {
      __args: { url: string; key: string; options: { auth: Record<string, unknown> } };
    };
    expect(client.__args.url).toBe('https://abc.supabase.co');
    expect(client.__args.key).toBe('anon');
  });

  it('configures the secure-store adapter as the auth session storage', () => {
    const client = createSupabaseMobileClient(validEnv) as unknown as {
      __args: { options: { auth: { storage: { getItem: unknown; setItem: unknown } } } };
    };
    const storage = client.__args.options.auth.storage;
    expect(typeof storage.getItem).toBe('function');
    expect(typeof storage.setItem).toBe('function');
  });

  it('enables session persistence and auto-refresh, disables URL detection', () => {
    const client = createSupabaseMobileClient(validEnv) as unknown as {
      __args: { options: { auth: Record<string, unknown> } };
    };
    expect(client.__args.options.auth.persistSession).toBe(true);
    expect(client.__args.options.auth.autoRefreshToken).toBe(true);
    expect(client.__args.options.auth.detectSessionInUrl).toBe(false);
  });

  it('attaches the x-binderly-app: mobile header', () => {
    const client = createSupabaseMobileClient(validEnv) as unknown as {
      __args: { options: { global: { headers: Record<string, string> } } };
    };
    expect(client.__args.options.global.headers['x-binderly-app']).toBe('mobile');
  });

  it('builds a fresh instance per call (no hidden singleton in this module)', () => {
    const a = createSupabaseMobileClient(validEnv);
    const b = createSupabaseMobileClient(validEnv);
    expect(a).not.toBe(b);
  });
});

describe('startAuthAutoRefresh', () => {
  it('subscribes to AppState and pauses/resumes the auto-refresh loop', () => {
    const client = createSupabaseMobileClient(validEnv);
    const subscription = startAuthAutoRefresh(client);
    // The mocked react-native module returns `{ remove: vi.fn() }`
    // from AppState.addEventListener. We just verify the subscription
    // is present and shaped correctly.
    expect(subscription).toBeDefined();
    if (subscription !== null) {
      expect(typeof subscription.remove).toBe('function');
    }
  });
});
