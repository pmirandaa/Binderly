import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShareableRoute } from './ShareableRoute';
import { createFakeShareApi } from '../../lib/share/fixtures';
import { renderWithProviders } from '../../test-utils/render';

const fakeApi = createFakeShareApi();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/c/pablo/my-binder',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
}));

vi.mock('../../lib/share/api', async () => {
  const actual = await vi.importActual('../../lib/share/api');
  return {
    ...(actual as object),
    apiToShareApi: (): typeof fakeApi => fakeApi,
  };
});

vi.mock('../../lib/api-client', () => ({
  getApiClient: () => ({}),
}));

describe('ShareableRoute', () => {
  it('renders the page-loading placeholder before the api-client is constructed', () => {
    renderWithProviders(<ShareableRoute handle="pablo" slug="my-binder" />);
    expect(screen.getByText(/loading shareable/i)).toBeInTheDocument();
  });

  it('renders the ShareableView once the api-client is wired', async () => {
    renderWithProviders(<ShareableRoute handle="pablo" slug="my-binder" />);
    await waitFor(() => {
      expect(screen.getByTestId('share-page')).toBeInTheDocument();
    });
  });

  it('routes 404 responses through next/navigation notFound()', async () => {
    const { notFound } = await import('next/navigation');
    const localApi = createFakeShareApi({ notFound: true });
    fakeApi.getPublicSharePayload.mockImplementationOnce(
      localApi.getPublicSharePayload as never,
    );
    renderWithProviders(<ShareableRoute handle="ghost" slug="missing" />);
    await waitFor(() => {
      expect(notFound).toHaveBeenCalled();
    });
  });
});
