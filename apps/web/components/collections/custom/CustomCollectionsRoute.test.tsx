import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CustomCollectionsRoute } from './CustomCollectionsRoute';
import { createFakeCustomCollectionApi } from '../../../lib/collections/custom/fixtures';
import { renderWithProviders } from '../../../test-utils/render';
import { createFakeSupabase } from '../../../test-utils/supabase-stub';

import type { Session } from '@supabase/supabase-js';

const fakeApi = createFakeCustomCollectionApi();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/custom',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => undefined,
}));

vi.mock('../../../lib/collections/custom/api', async () => {
  const actual = await vi.importActual('../../../lib/collections/custom/api');
  return {
    ...(actual as object),
    apiToCustomCollectionApi: (): typeof fakeApi => fakeApi,
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

describe('CustomCollectionsRoute', () => {
  it('renders the sign-in prompt when no user is signed in', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(<CustomCollectionsRoute />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('collection-sign-in-prompt')).toBeInTheDocument();
    });
    const link = screen.getByTestId('collection-sign-in-link');
    expect(link.getAttribute('href')).toContain('next=%2Fcollections%2Fcustom');
  });

  it('renders the list view when a session is present', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(<CustomCollectionsRoute />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-page')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
  });
});
