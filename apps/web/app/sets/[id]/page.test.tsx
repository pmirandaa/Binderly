import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';

import SetPage from './page';
import {
  createFakeBrowseApi,
  makeCardWithPrintings,
  makePrinting,
  makeSet,
} from '../../../lib/browse/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

// In real Next.js `notFound()` throws a sentinel error that the
// framework catches in its render boundary; we don't need to
// re-create that here — a plain spy is enough to assert the
// route forwarded the 404 signal correctly.
const notFoundSpy = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sets/abc',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => notFoundSpy(),
}));

const fakeApi = createFakeBrowseApi({
  setsBySetId: {
    'set-x': {
      set: makeSet({ id: 'set-x', name: 'Astral Radiance', releaseDate: '2022-05-27' }),
      cards: [
        makeCardWithPrintings({ id: 'c1', name: 'Pikachu', number: '1' }, [
          makePrinting({ id: 'p1' }),
        ]),
      ],
    },
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

describe('/sets/[id] route entrypoint', () => {
  it('renders the SetView wired to the (mocked) api-client', async () => {
    renderWithProviders(<SetPage params={{ id: 'set-x' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('set-header-name')).toHaveTextContent('Astral Radiance');
    });
  });

  it('triggers Next.js notFound() when the api-client raises ApiNotFoundError', async () => {
    notFoundSpy.mockClear();
    fakeApi.listPrintingsInSet.mockRejectedValueOnce(
      new ApiNotFoundError('set not found'),
    );
    renderWithProviders(<SetPage params={{ id: 'unknown' }} />);
    await waitFor(() => {
      expect(notFoundSpy).toHaveBeenCalled();
    });
  });
});
