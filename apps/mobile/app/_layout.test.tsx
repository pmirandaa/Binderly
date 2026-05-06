// Provider tree composition smoke test.
//
// We don't render the live RootLayout here (it pulls expo-router
// + the system supabase client). Instead we re-implement the same
// composition order against the same provider modules and assert
// it mounts a child without throwing. If a provider's contract
// changes (a new required prop, a missing context) this test will
// catch it before feature tasks integrate.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ErrorBoundary } from '../src/components/error/ErrorBoundary';
import {
  AuthProvider,
  EnvGate,
  QueryProvider,
  ThemeOverrideProvider,
} from '../src/components/providers';
import { ApiClientProvider, createMobileApiClient } from '../src/lib/api-client';
import { createInMemorySecureStorage } from '../src/lib/secure-storage';
import { createSupabaseMobileClient } from '../src/lib/supabase-mobile';

const validSource = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
} as const;

describe('provider tree composition (RootLayout-equivalent)', () => {
  it('mounts every provider and renders the inner child', () => {
    const storage = createInMemorySecureStorage();
    const result = render(
      <ThemeOverrideProvider storage={storage} initialOverride="light">
        <ErrorBoundary>
          <EnvGate source={validSource}>
            {(env) => {
              const supabase = createSupabaseMobileClient(env);
              const apiClient = createMobileApiClient(env, supabase);
              return (
                <AuthProvider supabase={supabase}>
                  <QueryProvider>
                    <ApiClientProvider client={apiClient}>
                      <span data-testid="leaf">leaf</span>
                    </ApiClientProvider>
                  </QueryProvider>
                </AuthProvider>
              );
            }}
          </EnvGate>
        </ErrorBoundary>
      </ThemeOverrideProvider>,
    );
    expect(result.getByTestId('leaf').textContent).toBe('leaf');
  });

  it('does not render the inner tree when env is missing', () => {
    const storage = createInMemorySecureStorage();
    const result = render(
      <ThemeOverrideProvider storage={storage} initialOverride="light">
        <ErrorBoundary>
          <EnvGate source={{}}>{() => <span data-testid="leaf">leaf</span>}</EnvGate>
        </ErrorBoundary>
      </ThemeOverrideProvider>,
    );
    expect(result.queryByTestId('leaf')).toBeNull();
    expect(result.container.textContent).toMatch(/Configuration error/);
  });
});
