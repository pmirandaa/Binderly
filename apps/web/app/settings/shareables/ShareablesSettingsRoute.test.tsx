import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createFakeSettingsApi } from './fixtures';
import { ShareablesSettingsRoute } from './ShareablesSettingsRoute';
import { renderWithProviders } from '../../../test-utils/render';
import { createFakeSupabase } from '../../../test-utils/supabase-stub';

import type { Session } from '@supabase/supabase-js';

const fakeApi = createFakeSettingsApi();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings/shareables',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./api', async () => {
  const actual = (await vi.importActual('./api')) as Record<string, unknown>;
  return {
    ...actual,
    binderlyClientToSettingsApi: () => fakeApi,
  };
});

vi.mock('../../../lib/api-client', () => ({
  getApiClient: () => ({}),
}));

function fakeSession(): Session {
  return {
    access_token: 'tok',
    refresh_token: 'rt',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'user-1',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00.000Z',
      email: 'test@example.com',
    },
  } as Session;
}

describe('ShareablesSettingsRoute', () => {
  it('renders the sign-in prompt for anonymous visitors', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(<ShareablesSettingsRoute />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('collection-sign-in-prompt')).toBeInTheDocument();
    });
    const link = screen.getByTestId('collection-sign-in-link');
    expect(link.getAttribute('href')).toContain('next=%2Fsettings%2Fshareables');
  });

  it('renders the settings view when a session is present', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(<ShareablesSettingsRoute />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-page')).toBeInTheDocument();
    });
  });
});
