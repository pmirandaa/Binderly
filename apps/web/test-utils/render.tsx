// Wraps RTL `render()` with the full app provider tree so
// component tests see the same context as a real Binderly route.
//
// Tests that want a stub Supabase client may pass `supabase` to
// override the AuthProvider's default singleton.

import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

import { AuthProvider } from '../components/providers/AuthProvider';
import { QueryProvider, createDefaultQueryClient } from '../components/providers/QueryProvider';
import { UIProvider } from '../components/providers/UIProvider';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

export interface RenderWithProvidersOptions extends RenderOptions {
  queryClient?: QueryClient;
  supabase?: SupabaseClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { queryClient = createDefaultQueryClient(), supabase, ...rest } = options;
  return render(
    <UIProvider>
      <QueryProvider client={queryClient}>
        <AuthProvider supabase={supabase}>{ui}</AuthProvider>
      </QueryProvider>
    </UIProvider>,
    rest,
  );
}

export * from '@testing-library/react';
