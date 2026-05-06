import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NotFound from './not-found';
import HomePage from './page';
import { renderWithProviders } from '../test-utils/render';

describe('app routes (top-level)', () => {
  it('home page renders the hero', () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.getByText('Binderly')).toBeInTheDocument();
  });

  it('not-found page renders the 404 copy', () => {
    renderWithProviders(<NotFound />);
    expect(screen.getByTestId('not-found')).toBeInTheDocument();
    expect(screen.getByText(/Page not found/)).toBeInTheDocument();
  });
});
