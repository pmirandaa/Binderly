import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AuthCallbackPage from './callback/page';
import SignInPage from './sign-in/page';
import SignOutPage from './sign-out/page';
import { renderWithProviders } from '../../test-utils/render';

describe('placeholder auth routes', () => {
  it('sign-in page renders without crashing', () => {
    renderWithProviders(<SignInPage />);
    expect(screen.getByTestId('sign-in-page')).toBeInTheDocument();
  });

  it('callback page renders without crashing', () => {
    renderWithProviders(<AuthCallbackPage />);
    expect(screen.getByTestId('auth-callback-page')).toBeInTheDocument();
  });

  it('sign-out page renders without crashing', () => {
    renderWithProviders(<SignOutPage />);
    expect(screen.getByTestId('sign-out-page')).toBeInTheDocument();
  });
});
