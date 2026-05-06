import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BrowsePage from './browse/page';
import CollectionPage from './collection/page';
import ProfilePage from './profile/page';
import ScannerPage from './scanner/page';
import { renderWithProviders } from '../../test-utils/render';

describe('placeholder tab routes', () => {
  it('browse page renders without crashing', () => {
    renderWithProviders(<BrowsePage />);
    expect(screen.getByTestId('browse-page')).toBeInTheDocument();
    expect(screen.getByText('Browse')).toBeInTheDocument();
  });

  it('collection page renders without crashing', () => {
    renderWithProviders(<CollectionPage />);
    expect(screen.getByTestId('collection-page')).toBeInTheDocument();
    expect(screen.getByText('Collection')).toBeInTheDocument();
  });

  it('scanner page renders the mobile-only stub', () => {
    renderWithProviders(<ScannerPage />);
    expect(screen.getByTestId('scanner-page')).toBeInTheDocument();
    expect(screen.getByText(/mobile-only feature/)).toBeInTheDocument();
  });

  it('profile page renders without crashing', () => {
    renderWithProviders(<ProfilePage />);
    expect(screen.getByTestId('profile-page')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });
});
