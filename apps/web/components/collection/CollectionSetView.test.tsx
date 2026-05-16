import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';

import { CollectionSetView } from './CollectionSetView';
import {
  createFakeCollectionApi,
  FIXTURE_OWNED_ITEMS,
  fixtureRoster,
  fixtureSetContents,
} from '../../lib/collection/fixtures';
import { renderWithProviders } from '../../test-utils/render';

const replaceMock = vi.fn();
const currentSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: (...args: unknown[]) => replaceMock(...args),
    back: vi.fn(),
  }),
  usePathname: () => '/collection/sets/set-a',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

function renderSetView(
  props: Partial<Omit<React.ComponentProps<typeof CollectionSetView>, 'api'>> & {
    api?: ReturnType<typeof createFakeCollectionApi>;
  } = {},
): ReturnType<typeof createFakeCollectionApi> {
  const api = props.api ?? createFakeCollectionApi();
  renderWithProviders(<CollectionSetView api={api} setId="set-a" {...props} />);
  return api;
}

describe('CollectionSetView — header + progress', () => {
  it('renders the header name + release date + language', async () => {
    renderSetView();
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-header-name')).toBeInTheDocument();
    });
    expect(screen.getByTestId('collection-set-header-name')).toHaveTextContent(
      'Base Set',
    );
    expect(screen.getByTestId('collection-set-header-meta')).toHaveTextContent(
      /english/i,
    );
  });

  it('renders three large progress bars in the header', async () => {
    renderSetView();
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-progress')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('collection-set-progress-set-track'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('collection-set-progress-master-track'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('collection-set-progress-all-pokemon-track'),
    ).toBeInTheDocument();
  });

  it('renders set-a Set % at 50.0% with "1 / 2 owned"', async () => {
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-progress-set-value'),
      ).toBeInTheDocument();
    });
    const v = screen.getByTestId('collection-set-progress-set-value');
    expect(v.textContent).toContain('50.0%');
    expect(v.textContent).toContain('1 / 2 owned');
  });

  it('renders a back-to-collection breadcrumb', async () => {
    renderSetView();
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-back-link')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('collection-set-back-link').getAttribute('href'),
    ).toBe('/collection');
  });

  it('renders the value-coming-soon placeholder', async () => {
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-value-placeholder'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('collection-set-value-placeholder').textContent,
    ).toMatch(/total value coming soon/i);
  });
});

describe('CollectionSetView — tabs', () => {
  it('renders the Owned tab by default with the user\'s items', async () => {
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-owned-panel'),
      ).toBeInTheDocument();
    });
    // set-a fixture: user owns only p-a1-holo (Charizard holo).
    const links = within(screen.getByTestId('collection-set-owned-grid'))
      .getAllByTestId('printing-thumbnail-link')
      .map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/cards/p-a1-holo']);
  });

  it('renders condition and language badges on each owned printing', async () => {
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-owned-grid'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('collection-set-owned-condition'),
    ).toHaveTextContent('NM');
    expect(
      screen.getByTestId('collection-set-owned-language'),
    ).toHaveTextContent('EN');
  });

  it('clicking the Missing tab swaps the panel to the not-owned printings', async () => {
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-owned-panel'),
      ).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('collection-set-tab-missing'));
    });
    expect(
      screen.getByTestId('collection-set-missing-panel'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('collection-set-owned-panel')).toBeNull();
    // set-a missing = the printings NOT in FIXTURE_OWNED_ITEMS for set-a.
    // Owned in set-a: p-a1-holo only. Missing: p-a1-rh, p-a2-holo, p-a2-promo.
    const links = within(screen.getByTestId('collection-set-missing-grid'))
      .getAllByTestId('printing-thumbnail-link')
      .map((a) => a.getAttribute('href'));
    expect(links).toEqual(
      expect.arrayContaining([
        '/cards/p-a1-rh',
        '/cards/p-a2-holo',
        '/cards/p-a2-promo',
      ]),
    );
    expect(links).toHaveLength(3);
  });

  it('updates the URL query string when the tab changes', async () => {
    replaceMock.mockClear();
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-tab-missing'),
      ).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('collection-set-tab-missing'));
    });
    expect(replaceMock).toHaveBeenCalledWith('?tab=missing');
  });

  it('honours an initialTab prop overriding the default', async () => {
    const api = createFakeCollectionApi();
    renderWithProviders(
      <CollectionSetView api={api} setId="set-a" initialTab="missing" />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-missing-panel'),
      ).toBeInTheDocument();
    });
  });

  it('shows the owned-empty state when the user has nothing in this set', async () => {
    // set-c: nothing owned in the FIXTURE_OWNED_ITEMS.
    const api = createFakeCollectionApi();
    renderWithProviders(<CollectionSetView api={api} setId="set-c" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-owned-empty'),
      ).toBeInTheDocument();
    });
  });

  it('shows the missing-empty state when the user owns every printing', async () => {
    // set-b: all four printings are owned in the fixture.
    const api = createFakeCollectionApi();
    renderWithProviders(<CollectionSetView api={api} setId="set-b" initialTab="missing" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-missing-empty'),
      ).toBeInTheDocument();
    });
  });

  it('tab labels include the live counts', async () => {
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-tab-owned'),
      ).toBeInTheDocument();
    });
    // set-a: 1 owned printing, 3 missing.
    expect(
      screen.getByTestId('collection-set-tab-owned').textContent,
    ).toContain('Owned (1)');
    expect(
      screen.getByTestId('collection-set-tab-missing').textContent,
    ).toContain('Missing (3)');
  });
});

describe('CollectionSetView — 404 + error', () => {
  it('invokes onNotFound when the api-client raises ApiNotFoundError', async () => {
    const onNotFound = vi.fn();
    const api = createFakeCollectionApi();
    api.listSetContents.mockRejectedValue(new ApiNotFoundError('set missing'));
    renderWithProviders(
      <CollectionSetView api={api} setId="missing" onNotFound={onNotFound} />,
    );
    await waitFor(() => {
      expect(onNotFound).toHaveBeenCalledTimes(1);
    });
  });

  it('renders an inline 404 state when no onNotFound callback is provided', async () => {
    const api = createFakeCollectionApi();
    api.listSetContents.mockRejectedValue(new ApiNotFoundError('set missing'));
    renderWithProviders(
      <CollectionSetView api={api} setId="missing" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('collection-set-error')).toHaveTextContent(
      /set not found/i,
    );
  });

  it('renders the error state when the fetch rejects with a generic Error', async () => {
    const api = createFakeCollectionApi();
    api.listSetContents.mockRejectedValue(new Error('backend down'));
    renderWithProviders(<CollectionSetView api={api} setId="set-a" />);
    await waitFor(() => {
      expect(screen.getByTestId('collection-set-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('collection-set-error')).toHaveTextContent(
      'backend down',
    );
  });
});

describe('CollectionSetView — math against fixture', () => {
  it('Set % matches the @binderly/set-completion output for set-a', async () => {
    renderSetView();
    await waitFor(() => {
      expect(
        screen.getByTestId('collection-set-progress-master-value'),
      ).toBeInTheDocument();
    });
    const v = screen.getByTestId('collection-set-progress-master-value');
    // set-a master-set-included printings: p-a1-holo, p-a1-rh,
    // p-a2-holo — 3 of 3 master-included. User owns only
    // p-a1-holo → 1/3 ≈ 33.33%.
    expect(v.textContent).toContain('33.3%');
    expect(v.textContent).toContain('1 / 3 owned');
  });
});

// Touch fixtureRoster / FIXTURE_OWNED_ITEMS / fixtureSetContents
// imports so unused-imports lint doesn't trip when we narrow the
// suite later.
void fixtureRoster;
void FIXTURE_OWNED_ITEMS;
void fixtureSetContents;
