import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CollectionRoute } from './CollectionRoute';
import { createFakeCollectionApi } from '../../lib/collection/fixtures';
import { renderWithProviders } from '../../test-utils/render';
import { createFakeSupabase } from '../../test-utils/supabase-stub';

import type { Session } from '@supabase/supabase-js';

const fakeApi = createFakeCollectionApi();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collection',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../lib/collection/api', async () => {
  const actual = await vi.importActual('../../lib/collection/api');
  return {
    ...(actual as object),
    apiToCollectionApi: (): typeof fakeApi => fakeApi,
  };
});

vi.mock('../../lib/api-client', () => ({
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

describe('CollectionRoute', () => {
  it('renders the sign-in prompt when no user is signed in', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(<CollectionRoute />, { supabase: fake.client });
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-sign-in-prompt'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('collection-sign-in-link').getAttribute('href'),
    ).toContain('next=%2Fcollection');
  });

  it('renders the CollectionView when a session is present', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(<CollectionRoute />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('collection-page')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-list')).toBeInTheDocument();
    });
  });
});
