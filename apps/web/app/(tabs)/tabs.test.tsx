import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ProfilePage from './profile/page';
import ScannerPage from './scanner/page';
import { renderWithProviders } from '../../test-utils/render';

// Note: the `browse` placeholder previously co-located here was
// removed by T-W-BROWSE (see Q-009 in open-questions.md). The
// `collection` placeholder previously co-located here was removed
// by T-W-COLLECTION via the same Q-009 in-PR-resolve pattern —
// the real `/collection` route lives at
// `apps/web/app/collection/page.tsx` per T-W-COLLECTION's
// `owns_paths`; tests for it live alongside.

describe('placeholder tab routes', () => {
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
