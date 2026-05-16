import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SignInPrompt } from './SignInPrompt';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collection',
  useSearchParams: () => new URLSearchParams(),
}));

describe('SignInPrompt', () => {
  it('renders heading + body and a sign-in link', () => {
    renderWithProviders(<SignInPrompt nextPath="/collection" />);
    expect(screen.getByTestId('collection-sign-in-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('collection-sign-in-heading')).toHaveTextContent(
      /sign in/i,
    );
    expect(screen.getByTestId('collection-sign-in-link').getAttribute('href')).toBe(
      '/auth/sign-in?next=%2Fcollection',
    );
  });

  it('encodes the next path properly when it contains slashes + ids', () => {
    renderWithProviders(<SignInPrompt nextPath="/collection/sets/set-abc" />);
    expect(screen.getByTestId('collection-sign-in-link').getAttribute('href')).toBe(
      '/auth/sign-in?next=%2Fcollection%2Fsets%2Fset-abc',
    );
  });

  it('accepts heading + body overrides', () => {
    renderWithProviders(
      <SignInPrompt
        nextPath="/collection"
        heading="Sign in to see Set X"
        body="Just for this set."
      />,
    );
    expect(screen.getByTestId('collection-sign-in-heading')).toHaveTextContent(
      'Sign in to see Set X',
    );
    expect(screen.getByTestId('collection-sign-in-body')).toHaveTextContent(
      'Just for this set.',
    );
  });
});
