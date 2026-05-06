import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SignOutPage from './page';
import { renderWithProviders } from '../../../test-utils/render';
import { createFakeSupabase } from '../../../test-utils/supabase-stub';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/auth/sign-out',
  useSearchParams: () => new URLSearchParams(''),
}));

beforeEach(() => {
  replace.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SignOutPage', () => {
  it('renders the pending state on initial mount', () => {
    const fake = createFakeSupabase(null);
    fake.signOut.mockImplementation(() => new Promise(() => undefined));
    renderWithProviders(<SignOutPage />, { supabase: fake.client });
    expect(screen.getByTestId('sign-out-page')).toBeInTheDocument();
    expect(screen.getByTestId('sign-out-pending')).toBeInTheDocument();
  });

  it('calls supabase signOut once on mount', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(<SignOutPage />, { supabase: fake.client });
    await waitFor(() => {
      expect(fake.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the done state and eventually redirects to /', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(<SignOutPage />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('sign-out-done')).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(replace).toHaveBeenCalledWith('/');
      },
      { timeout: 2000 },
    );
  });

  it('surfaces an error if the SDK signOut rejects', async () => {
    const fake = createFakeSupabase(null);
    fake.signOut.mockRejectedValueOnce(new Error('network down'));
    renderWithProviders(<SignOutPage />, { supabase: fake.client });
    await waitFor(() => {
      expect(screen.getByTestId('sign-out-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sign-out-error-message')).toHaveTextContent('network down');
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect after unmount even if signOut resolves later', async () => {
    const resolveBox: { fn: (() => void) | null } = { fn: null };
    const fake = createFakeSupabase(null);
    fake.signOut.mockImplementation(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveBox.fn = () => resolve({ error: null });
        }),
    );
    const { unmount } = renderWithProviders(<SignOutPage />, { supabase: fake.client });
    unmount();
    resolveBox.fn?.();
    // Wait long enough that the post-redirect timer would have
    // fired had we not cleared it.
    await new Promise((r) => setTimeout(r, 800));
    expect(replace).not.toHaveBeenCalled();
  });
});
