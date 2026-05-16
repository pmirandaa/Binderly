import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BrowsePage from './page';
import { SAMPLE_SETS, createFakeBrowseApi } from '../../lib/browse/fixtures';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/browse',
  useSearchParams: () => new URLSearchParams(),
}));

const fakeApi = createFakeBrowseApi({ sets: SAMPLE_SETS });

vi.mock('../../lib/browse/api', async () => {
  const actual = await vi.importActual('../../lib/browse/api');
  return {
    ...(actual as object),
    apiToBrowseApi: (): typeof fakeApi => fakeApi,
  };
});

vi.mock('../../lib/api-client', () => ({
  getApiClient: () => ({}),
}));

describe('/browse route entrypoint', () => {
  it('renders the BrowseView wired to the (mocked) api-client', async () => {
    renderWithProviders(<BrowsePage />);
    await waitFor(() => {
      expect(screen.getByTestId('browse-page')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('set-card')).toHaveLength(SAMPLE_SETS.length);
  });
});
