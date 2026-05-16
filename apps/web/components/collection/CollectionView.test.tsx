import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { computeCompletion } from '@binderly/set-completion';

import { CollectionView } from './CollectionView';
import { createFakeCollectionApi, FIXTURE_OWNED_ITEMS, fixtureRoster } from '../../lib/collection/fixtures';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collection',
  useSearchParams: () => new URLSearchParams(),
}));

function renderView(api: ReturnType<typeof createFakeCollectionApi>): void {
  renderWithProviders(<CollectionView api={api} />);
}

describe('CollectionView — loading + error', () => {
  it('shows a loading state while reads resolve', async () => {
    let resolveItems: ((v: typeof FIXTURE_OWNED_ITEMS) => void) | null = null;
    const api = createFakeCollectionApi();
    api.listOwnedItems.mockImplementation(
      () =>
        new Promise((r) => {
          resolveItems = r as (v: typeof FIXTURE_OWNED_ITEMS) => void;
        }),
    );
    renderView(api);
    expect(screen.getByText(/loading your collection/i)).toBeInTheDocument();
    await act(async () => {
      resolveItems?.(FIXTURE_OWNED_ITEMS);
    });
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-list')).toBeInTheDocument();
    });
  });

  it('renders the error state when the api-client throws', async () => {
    const api = createFakeCollectionApi({ rejectAll: new Error('backend down') });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('collection-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('collection-error')).toHaveTextContent('backend down');
  });
});

describe('CollectionView — global completion badge', () => {
  it('renders both global progress bars with values from set-completion', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('collection-global-badge')).toBeInTheDocument();
    });
    const expected = computeCompletion({
      cards: fixtureRoster().cards,
      printings: fixtureRoster().printings,
      ownedPrintingIds: FIXTURE_OWNED_ITEMS.map((it) => it.printingId),
    });
    const allBar = screen.getByTestId('global-all-pokemon-value');
    expect(allBar.textContent).toContain(
      `${expected.global.allPokemonPct.toFixed(1)}%`,
    );
    expect(allBar.textContent).toContain(
      `${expected.global.uniqueCardsOwned} / ${expected.global.uniqueCardsTotal}`,
    );
    const masterBar = screen.getByTestId('global-master-value');
    expect(masterBar.textContent).toContain(
      `${expected.global.masterPct.toFixed(1)}%`,
    );
  });

  it('renders aria-valuenow on the global all-pokemon bar', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('global-all-pokemon-track')).toBeInTheDocument();
    });
    const track = screen.getByTestId('global-all-pokemon-track');
    expect(track.getAttribute('aria-valuenow')).not.toBeNull();
    expect(Number(track.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  });
});

describe('CollectionView — set list', () => {
  it('renders one row per set the user has at least one printing in', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-list')).toBeInTheDocument();
    });
    // The fixture has owned items in set-a and set-b only — set-c
    // is hidden because the user owns nothing from it.
    const rows = screen.getAllByTestId('collection-set-row');
    expect(rows).toHaveLength(2);
  });

  it('orders rows by completion % descending', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-list')).toBeInTheDocument();
    });
    // set-b is 100% (owns both cards' printings) → first.
    // set-a is 50% (owns one of two cards) → second.
    const names = screen
      .getAllByTestId('collection-set-row-name')
      .map((n) => n.textContent);
    expect(names).toEqual(['Astral Radiance', 'Base Set']);
  });

  it('routes each set row to /collection/sets/[id]', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getAllByTestId('collection-set-row-link').length).toBeGreaterThan(0);
    });
    const hrefs = screen
      .getAllByTestId('collection-set-row-link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/collection/sets/set-a');
    expect(hrefs).toContain('/collection/sets/set-b');
    expect(hrefs).not.toContain('/collection/sets/set-c');
  });

  it('renders three progress bars per set row (Set, Master, All Pokémon)', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getAllByTestId('collection-set-row').length).toBeGreaterThan(0);
    });
    const rows = screen.getAllByTestId('collection-set-row');
    for (const row of rows) {
      expect(
        within(row).getByTestId('collection-set-row-set-track'),
      ).toBeInTheDocument();
      expect(
        within(row).getByTestId('collection-set-row-master-track'),
      ).toBeInTheDocument();
      expect(
        within(row).getByTestId('collection-set-row-all-pokemon-track'),
      ).toBeInTheDocument();
    }
  });

  it('renders accurate Set % counts for known fixtures', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getAllByTestId('collection-set-row').length).toBeGreaterThan(0);
    });
    // set-b has owned 2 of 2 cards (Mew + Pikachu) — so Set %
    // should render 100.0% with "2 / 2 owned".
    const rows = screen.getAllByTestId('collection-set-row');
    const astralRow = rows.find((r) =>
      within(r).queryByText('Astral Radiance') !== null,
    )!;
    expect(
      within(astralRow).getByTestId('collection-set-row-set-value').textContent,
    ).toContain('100.0%');
    expect(
      within(astralRow).getByTestId('collection-set-row-set-value').textContent,
    ).toContain('2 / 2 owned');
  });

  it('renders the headline + helper copy', async () => {
    const api = createFakeCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByText('Your collection')).toBeInTheDocument();
    });
    expect(screen.getByText(/global all pokémon/i)).toBeInTheDocument();
  });
});

describe('CollectionView — empty state', () => {
  it('shows the empty state when the user has zero owned items', async () => {
    const api = createFakeCollectionApi({ ownedItems: [] });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('collection-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('collection-empty-browse-link')).toHaveAttribute(
      'href',
      '/browse',
    );
    expect(screen.queryByTestId('collection-set-list')).toBeNull();
  });

  it('still renders the global badge with zero totals when collection is empty', async () => {
    const api = createFakeCollectionApi({ ownedItems: [] });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('collection-global-badge')).toBeInTheDocument();
    });
    const allBar = screen.getByTestId('global-all-pokemon-value');
    expect(allBar.textContent).toContain('0.0%');
  });
});
