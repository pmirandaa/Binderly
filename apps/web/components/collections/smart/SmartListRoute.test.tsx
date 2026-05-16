import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SmartListRoute } from './SmartListRoute';
import {
  createFakeSmartCollectionsApi,
  makeSubscription,
} from '../../../lib/collections/smart/fixtures';
import { renderWithProviders } from '../../../test-utils/render';
import { createFakeSupabase } from '../../../test-utils/supabase-stub';

import type { Session } from '@supabase/supabase-js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/smart',
  useSearchParams: () => new URLSearchParams(),
}));

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

describe('SmartListRoute', () => {
  it('renders the sign-in prompt when no user is signed in', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(<SmartListRoute />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('smart-sign-in-prompt')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('smart-sign-in-link').getAttribute('href'),
    ).toContain('next=%2Fcollections%2Fsmart');
  });

  it('renders the SmartListView for an authenticated free user', async () => {
    const fake = createFakeSupabase(fakeSession());
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartListRoute apiOverride={api} />, {
      supabase: fake.client,
    });
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-page')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-upgrade')).toBeInTheDocument();
    });
  });

  it('issues api.deleteSmartCollection when the user confirms the destructive flow', async () => {
    const fake = createFakeSupabase(fakeSession());
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderWithProviders(<SmartListRoute apiOverride={api} />, {
        supabase: fake.client,
      });
      await waitFor(() => {
        expect(screen.getAllByTestId('smart-list-row').length).toBeGreaterThan(0);
      });
      const firstDelete = screen.getAllByTestId('smart-list-row-delete')[0]!;
      fireEvent.click(firstDelete);
      await waitFor(() => {
        expect(api.deleteSmartCollection).toHaveBeenCalledWith('cc-smart-1');
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('does NOT call api.deleteSmartCollection when the user cancels the confirm', async () => {
    const fake = createFakeSupabase(fakeSession());
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      renderWithProviders(<SmartListRoute apiOverride={api} />, {
        supabase: fake.client,
      });
      await waitFor(() => {
        expect(screen.getAllByTestId('smart-list-row').length).toBeGreaterThan(0);
      });
      fireEvent.click(screen.getAllByTestId('smart-list-row-delete')[0]!);
      expect(api.deleteSmartCollection).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
