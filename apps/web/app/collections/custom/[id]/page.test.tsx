import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';

import CustomCollectionDetailPage from './page';
import { createFakeCustomCollectionApi } from '../../../../lib/collections/custom/fixtures';
import { renderWithProviders } from '../../../../test-utils/render';
import { createFakeSupabase } from '../../../../test-utils/supabase-stub';

import type { Session } from '@supabase/supabase-js';

const notFoundSpy = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/custom/cc-charizards',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => notFoundSpy(),
}));

const fakeApi = createFakeCustomCollectionApi();

vi.mock('../../../../lib/collections/custom/api', async () => {
  const actual = await vi.importActual('../../../../lib/collections/custom/api');
  return {
    ...(actual as object),
    apiToCustomCollectionApi: (): typeof fakeApi => fakeApi,
  };
});

vi.mock('../../../../lib/api-client', () => ({
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

describe('/collections/custom/[id] route entrypoint', () => {
  it('shows the sign-in prompt for an unauthenticated visitor', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(<CustomCollectionDetailPage params={{ id: 'cc-charizards' }} />, {
      supabase: fake.client,
    });
    await waitFor(() => {
      expect(screen.getByTestId('collection-sign-in-prompt')).toBeInTheDocument();
    });
    expect(screen.getByTestId('collection-sign-in-link').getAttribute('href')).toContain(
      'next=%2Fcollections%2Fcustom%2Fcc-charizards',
    );
  });

  it('renders the detail surface for an authenticated visitor', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(<CustomCollectionDetailPage params={{ id: 'cc-charizards' }} />, {
      supabase: fake.client,
    });
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-page')).toBeInTheDocument();
    });
  });

  it('triggers Next.js notFound() when the api raises ApiNotFoundError', async () => {
    notFoundSpy.mockClear();
    fakeApi.getCustomCollection.mockRejectedValueOnce(new ApiNotFoundError('missing'));
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(<CustomCollectionDetailPage params={{ id: 'unknown' }} />, {
      supabase: fake.client,
    });
    await waitFor(() => {
      expect(notFoundSpy).toHaveBeenCalled();
    });
  });
});
