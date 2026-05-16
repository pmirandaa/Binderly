import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CollectionPage from './collection/page';
import ProfilePage from './profile/page';
import ScannerPage from './scanner/page';
import { renderWithProviders } from '../../test-utils/render';

// Note: the `browse` placeholder previously co-located here was
// removed by T-W-BROWSE (see Q-009 in open-questions.md). The
// real `/browse` route lives at `apps/web/app/browse/page.tsx`
// per T-W-BROWSE's `owns_paths`; tests for it live alongside.

describe('placeholder tab routes', () => {
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
