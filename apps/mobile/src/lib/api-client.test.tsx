import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientProvider, createMobileApiClient, useApiClient } from './api-client';

import type { ReactNode } from 'react';

vi.mock('@binderly/api-client', () => ({
  createClient: vi.fn((config: Record<string, unknown>) => ({
    __config: config,
    cards: {},
    collection: {},
    pricing: {},
    grading: {},
    shareables: {},
    profile: {},
    auth: {},
    http: {},
  })),
}));

const validEnv = {
  supabaseUrl: 'https://abc.supabase.co',
  supabaseAnonKey: 'anon-key',
  apiBaseUrl: 'https://abc.supabase.co',
} as const;

const mockSupabase = {
  auth: {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'jwt-from-supabase' } },
      error: null,
    })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn(async () => ({ error: null })),
  },
} as unknown as Parameters<typeof createMobileApiClient>[1];

describe('createMobileApiClient', () => {
  it('passes the env URL as baseUrl', () => {
    const client = createMobileApiClient(validEnv, mockSupabase) as unknown as {
      __config: { baseUrl: string; apiKey: string };
    };
    expect(client.__config.baseUrl).toBe('https://abc.supabase.co');
    expect(client.__config.apiKey).toBe('anon-key');
  });

  it('uses apiBaseUrl over supabaseUrl when both are set', () => {
    const client = createMobileApiClient(
      { ...validEnv, apiBaseUrl: 'https://api.binderly.app' },
      mockSupabase,
    ) as unknown as { __config: { baseUrl: string } };
    expect(client.__config.baseUrl).toBe('https://api.binderly.app');
  });

  it('reads the JWT from the supplied Supabase session', async () => {
    const client = createMobileApiClient(validEnv, mockSupabase) as unknown as {
      __config: { getJwt: () => Promise<string | null> };
    };
    const token = await client.__config.getJwt();
    expect(token).toBe('jwt-from-supabase');
  });

  it('returns null when no Supabase session is active', async () => {
    const supabaseNoSession = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      },
    } as unknown as Parameters<typeof createMobileApiClient>[1];
    const client = createMobileApiClient(validEnv, supabaseNoSession) as unknown as {
      __config: { getJwt: () => Promise<string | null> };
    };
    const token = await client.__config.getJwt();
    expect(token).toBeNull();
  });

  it('forwards the Supabase JS client as supabaseAuth', () => {
    const client = createMobileApiClient(validEnv, mockSupabase) as unknown as {
      __config: { supabaseAuth: unknown };
    };
    expect(client.__config.supabaseAuth).toBe(mockSupabase);
  });

  it('attaches the x-binderly-app: mobile default header', () => {
    const client = createMobileApiClient(validEnv, mockSupabase) as unknown as {
      __config: { defaultHeaders: Record<string, string> };
    };
    expect(client.__config.defaultHeaders['x-binderly-app']).toBe('mobile');
  });
});

describe('useApiClient', () => {
  it('returns the client when wrapped in ApiClientProvider', () => {
    const client = createMobileApiClient(validEnv, mockSupabase);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    );
    const { result } = renderHook(() => useApiClient(), { wrapper });
    expect(result.current).toBe(client);
  });

  it('throws when no provider is mounted', () => {
    expect(() => renderHook(() => useApiClient())).toThrowError(/<ApiClientProvider>/);
  });
});
