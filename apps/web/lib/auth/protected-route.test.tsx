import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Text } from '@binderly/ui';

import { ProtectedRoute } from './protected-route';
import { renderWithProviders } from '../../test-utils/render';
import { createFakeSupabase } from '../../test-utils/supabase-stub';

import type { Session } from '@supabase/supabase-js';

const replace = vi.fn();
const pathname = vi.fn(() => '/collection');
const searchParamsValue = { toString: () => '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname(),
  useSearchParams: () => searchParamsValue,
}));

afterEach(() => {
  replace.mockClear();
  pathname.mockReturnValue('/collection');
  searchParamsValue.toString = () => '';
});

function makeSession(): Session {
  return {
    access_token: 't',
    refresh_token: 'r',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'u',
      email: 'a@b.co',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2025-01-01T00:00:00Z',
    },
  } as unknown as Session;
}

describe('<ProtectedRoute>', () => {
  it('renders the default fallback while loading', () => {
    const fake = createFakeSupabase(null);
    fake.getSession.mockImplementation(() => new Promise(() => undefined));
    renderWithProviders(
      <ProtectedRoute>
        <Text data-testid="kid">private</Text>
      </ProtectedRoute>,
      { supabase: fake.client },
    );
    expect(screen.getByTestId('protected-route-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('kid')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders a custom fallback when supplied', () => {
    const fake = createFakeSupabase(null);
    fake.getSession.mockImplementation(() => new Promise(() => undefined));
    renderWithProviders(
      <ProtectedRoute fallback={<Text data-testid="custom-fb">wait</Text>}>
        <Text data-testid="kid">private</Text>
      </ProtectedRoute>,
      { supabase: fake.client },
    );
    expect(screen.getByTestId('custom-fb')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-route-loading')).toBeNull();
  });

  it('renders children once session resolves to authenticated', async () => {
    const fake = createFakeSupabase(makeSession());
    renderWithProviders(
      <ProtectedRoute>
        <Text data-testid="kid">private</Text>
      </ProtectedRoute>,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(screen.getByTestId('kid')).toBeInTheDocument();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to sign-in (with next=current path) when signed out', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(
      <ProtectedRoute>
        <Text data-testid="kid">private</Text>
      </ProtectedRoute>,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/auth/sign-in?next=%2Fcollection');
    });
    expect(screen.queryByTestId('kid')).toBeNull();
  });

  it('preserves query params in the next= round-trip', async () => {
    pathname.mockReturnValue('/collection');
    searchParamsValue.toString = () => 'tab=binders';
    const fake = createFakeSupabase(null);
    renderWithProviders(
      <ProtectedRoute>
        <Text data-testid="kid">private</Text>
      </ProtectedRoute>,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/auth/sign-in?next=%2Fcollection%3Ftab%3Dbinders');
    });
  });

  it('redirects when the session flips from authenticated to null', async () => {
    const fake = createFakeSupabase(makeSession());
    renderWithProviders(
      <ProtectedRoute>
        <Text data-testid="kid">private</Text>
      </ProtectedRoute>,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(screen.getByTestId('kid')).toBeInTheDocument();
    });
    act(() => fake.emit(null));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/auth/sign-in?next=%2Fcollection');
    });
  });
});
