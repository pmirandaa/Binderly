import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';

import { SetView } from './SetView';
import {
  createFakeBrowseApi,
  makeCard,
  makeCardWithPrintings,
  makePrinting,
  makeSet,
} from '../../lib/browse/fixtures';
import { renderWithProviders } from '../../test-utils/render';

const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn() }),
  usePathname: () => '/sets/en-swsh10',
  useSearchParams: () => new URLSearchParams(),
}));

const set = makeSet({
  id: 'set-x',
  canonicalKey: 'en-swsh10',
  name: 'Astral Radiance',
  releaseDate: '2022-05-27',
  language: 'en',
  total: 189,
});

function basePrintingsForSet(): ReturnType<typeof createFakeBrowseApi>['listPrintingsInSet'] {
  return vi.fn();
}

describe('SetView — success path', () => {
  it('renders the header with name, release date, and counts', async () => {
    const api = createFakeBrowseApi({
      setsBySetId: {
        'set-x': {
          set,
          cards: [
            makeCardWithPrintings({ id: 'c1', name: 'Pikachu', number: '1' }, [
              makePrinting({ id: 'p1' }),
              makePrinting({ id: 'p2' }),
            ]),
          ],
        },
      },
    });
    renderWithProviders(<SetView api={api} slug="en-swsh10" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-header-name')).toBeInTheDocument();
    });
    expect(screen.getByTestId('set-header-name')).toHaveTextContent('Astral Radiance');
    expect(screen.getByTestId('set-header-meta')).toHaveTextContent('English');
    expect(screen.getByTestId('set-header-meta')).toHaveTextContent('2 printings');
  });

  it('renders one thumbnail per printing across all cards', async () => {
    const api = createFakeBrowseApi({
      setsBySetId: {
        'set-x': {
          set,
          cards: [
            makeCardWithPrintings({ id: 'c1', name: 'Pikachu', number: '1' }, [
              makePrinting({ id: 'p1' }),
              makePrinting({ id: 'p2', variantClass: 'REVERSE_HOLO' }),
            ]),
            makeCardWithPrintings({ id: 'c2', name: 'Charizard', number: '4' }, [
              makePrinting({ id: 'p3', variantClass: 'HOLO' }),
            ]),
          ],
        },
      },
    });
    renderWithProviders(<SetView api={api} slug="en-swsh10" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('printing-thumbnail')).toHaveLength(3);
    });
    const links = screen
      .getAllByTestId('printing-thumbnail-link')
      .map((a) => a.getAttribute('href'));
    expect(links).toContain('/cards/p1');
    expect(links).toContain('/cards/p2');
    expect(links).toContain('/cards/p3');
  });

  it('renders the back-to-browse breadcrumb pointing at /browse', async () => {
    const api = createFakeBrowseApi({
      setsBySetId: { 'set-x': { set, cards: [] } },
    });
    renderWithProviders(<SetView api={api} slug="en-swsh10" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-back-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('set-back-link').getAttribute('href')).toBe('/browse');
  });

  it('shows the empty state when the set has no cards yet', async () => {
    const api = createFakeBrowseApi({
      setsBySetId: { 'set-x': { set, cards: [] } },
    });
    renderWithProviders(<SetView api={api} slug="en-swsh10" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-empty')).toBeInTheDocument();
    });
  });
});

describe('SetView — 404 + error', () => {
  it('invokes onNotFound when the api-client raises ApiNotFoundError', async () => {
    const onNotFound = vi.fn();
    const api = createFakeBrowseApi();
    api.listPrintingsInSet = vi.fn().mockRejectedValue(
      new ApiNotFoundError('set not found'),
    );
    renderWithProviders(
      <SetView api={api} slug="en-missing" onNotFound={onNotFound} />,
    );
    await waitFor(() => {
      expect(onNotFound).toHaveBeenCalledTimes(1);
    });
  });

  it('falls back to an inline error when no onNotFound is provided', async () => {
    const api = createFakeBrowseApi();
    api.listPrintingsInSet = vi.fn().mockRejectedValue(
      new ApiNotFoundError('set not found'),
    );
    renderWithProviders(<SetView api={api} slug="en-missing" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-error')).toBeInTheDocument();
    });
  });

  it('renders an error state when the fetch rejects with a generic Error', async () => {
    // Seed the set so the slug resolves, then make the printings fetch
    // reject with a non-404 error.
    const api = createFakeBrowseApi({
      setsBySetId: { 'set-x': { set, cards: [] } },
    });
    api.listPrintingsInSet = basePrintingsForSet().mockRejectedValue(
      new Error('database unreachable'),
    );
    renderWithProviders(<SetView api={api} slug="en-swsh10" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-error')).toHaveTextContent('database unreachable');
    });
  });

  it('redirects a legacy UUID URL to the canonical slug', async () => {
    routerReplace.mockClear();
    const uuid = '11111111-1111-1111-1111-111111111111';
    const api = createFakeBrowseApi({
      sets: [makeSet({ id: uuid, canonicalKey: 'en-swsh10' })],
    });
    renderWithProviders(<SetView api={api} slug={uuid} />);
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith('/sets/en-swsh10');
    });
    expect(api.getSet).toHaveBeenCalledWith(uuid, expect.anything());
  });
});

describe('SetView — variant labels', () => {
  it('renders human-friendly variant labels in the grid', async () => {
    const api = createFakeBrowseApi({
      setsBySetId: {
        'set-x': {
          set,
          cards: [
            makeCardWithPrintings(makeCard({ name: 'Mew', number: '25' }), [
              makePrinting({ id: 'p-rh', variantClass: 'REVERSE_HOLO' }),
            ]),
          ],
        },
      },
    });
    renderWithProviders(<SetView api={api} slug="en-swsh10" />);
    await waitFor(() => {
      expect(screen.getByTestId('printing-thumbnail-variant')).toHaveTextContent(
        'reverse holo',
      );
    });
  });
});
