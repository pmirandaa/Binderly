import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';

import CardPage from './page';
import {
  createFakeBrowseApi,
  makeCard,
  makePrintingWithContext,
  makeSet,
} from '../../../lib/browse/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

// See `app/sets/[id]/page.test.tsx` — Next.js's real `notFound()`
// throws a sentinel error that's framework-handled; in tests we
// only need to assert the spy fired.
const notFoundSpy = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/cards/abc',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => notFoundSpy(),
}));

const fakeApi = createFakeBrowseApi({
  printingsById: {
    'pr-1': makePrintingWithContext({
      id: 'pr-1',
      card: makeCard({ name: 'Charizard', number: '4' }),
      set: makeSet({ id: 'set-base', name: 'Base Set' }),
    }),
  },
});

vi.mock('../../../lib/browse/api', async () => {
  const actual = await vi.importActual('../../../lib/browse/api');
  return {
    ...(actual as object),
    apiToBrowseApi: (): typeof fakeApi => fakeApi,
  };
});

vi.mock('../../../lib/api-client', () => ({
  getApiClient: () => ({}),
}));

describe('/cards/[id] route entrypoint', () => {
  it('renders the CardView wired to the (mocked) api-client', async () => {
    renderWithProviders(<CardPage params={{ id: 'pr-1' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-meta-name')).toHaveTextContent('Charizard');
    });
  });

  it('triggers Next.js notFound() when the api-client raises ApiNotFoundError', async () => {
    notFoundSpy.mockClear();
    fakeApi.getPrintingDetail.mockRejectedValueOnce(
      new ApiNotFoundError('printing not found'),
    );
    renderWithProviders(<CardPage params={{ id: 'unknown' }} />);
    await waitFor(() => {
      expect(notFoundSpy).toHaveBeenCalled();
    });
  });
});
