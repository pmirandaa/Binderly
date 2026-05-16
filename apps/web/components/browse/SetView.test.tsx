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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sets/abc',
  useSearchParams: () => new URLSearchParams(),
}));

const set = makeSet({
  id: 'set-x',
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
    renderWithProviders(<SetView api={api} setId="set-x" />);
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
    renderWithProviders(<SetView api={api} setId="set-x" />);
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
    renderWithProviders(<SetView api={api} setId="set-x" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-back-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('set-back-link').getAttribute('href')).toBe('/browse');
  });

  it('shows the empty state when the set has no cards yet', async () => {
    const api = createFakeBrowseApi({
      setsBySetId: { 'set-x': { set, cards: [] } },
    });
    renderWithProviders(<SetView api={api} setId="set-x" />);
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
      <SetView api={api} setId="missing" onNotFound={onNotFound} />,
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
    renderWithProviders(<SetView api={api} setId="missing" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-error')).toBeInTheDocument();
    });
  });

  it('renders an error state when the fetch rejects with a generic Error', async () => {
    const api = createFakeBrowseApi();
    api.listPrintingsInSet = basePrintingsForSet().mockRejectedValue(
      new Error('database unreachable'),
    );
    renderWithProviders(<SetView api={api} setId="set-x" />);
    await waitFor(() => {
      expect(screen.getByTestId('set-error')).toHaveTextContent('database unreachable');
    });
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
    renderWithProviders(<SetView api={api} setId="set-x" />);
    await waitFor(() => {
      expect(screen.getByTestId('printing-thumbnail-variant')).toHaveTextContent(
        'reverse holo',
      );
    });
  });
});
