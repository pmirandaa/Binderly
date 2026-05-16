import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CustomCollectionsView } from './CustomCollectionsView';
import {
  createFakeCustomCollectionApi,
  FIXTURE_COLLECTIONS,
  makeCustomCollection,
} from '../../../lib/collections/custom/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/custom',
  useSearchParams: () => new URLSearchParams(),
}));

function renderView(api: ReturnType<typeof createFakeCustomCollectionApi>): void {
  renderWithProviders(<CustomCollectionsView api={api} />);
}

describe('CustomCollectionsView — list', () => {
  it('renders user collections from the api-client', async () => {
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('custom-collection-row');
    expect(rows).toHaveLength(FIXTURE_COLLECTIONS.length);
    expect(within(rows[0]!).getByText('My Charizards')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Tournament Promos')).toBeInTheDocument();
  });

  it('hides smart-kind rows from the manual list', async () => {
    const api = createFakeCustomCollectionApi({
      collections: [
        makeCustomCollection({ id: 'cc-manual', name: 'Manual one', kind: 'manual' }),
        makeCustomCollection({ id: 'cc-smart', name: 'Smart one', kind: 'smart' }),
      ],
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('custom-collection-row')).toHaveLength(1);
    expect(screen.queryByText('Smart one')).not.toBeInTheDocument();
  });

  it('shows the empty state when no manual collections exist', async () => {
    const api = createFakeCustomCollectionApi({ collections: [] });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('custom-collections-empty-create')).toBeInTheDocument();
  });

  it('renders an error state when the api-client throws', async () => {
    const api = createFakeCustomCollectionApi({
      rejectAll: new Error('backend exploded'),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('custom-collections-error')).toHaveTextContent('backend exploded');
  });

  it('shows member counts derived from listCustomCollectionItems', async () => {
    const api = createFakeCustomCollectionApi({
      collections: [makeCustomCollection({ id: 'cc-x', name: 'X', kind: 'manual' })],
      itemsByCollectionId: {
        'cc-x': [
          { customCollectionId: 'cc-x', printingId: 'p1', addedAt: '2024-01-01T00:00:00.000Z' },
          { customCollectionId: 'cc-x', printingId: 'p2', addedAt: '2024-01-02T00:00:00.000Z' },
        ],
      },
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-row-count')).toBeInTheDocument();
    });
    expect(screen.getByTestId('custom-collection-row-count')).toHaveTextContent('2 cards');
  });

  it('renders the row description when provided', async () => {
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getAllByTestId('custom-collection-row-description')[0]).toHaveTextContent(
        'Every Charizard',
      );
    });
  });
});

describe('CustomCollectionsView — free-tier 3-cap', () => {
  it('shows "X / 3 used" header counting only manual collections', async () => {
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-cap')).toHaveTextContent('2 / 3 used');
    });
  });

  it('enables the New button when under the 3-cap', async () => {
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-new-button')).toBeInTheDocument();
    });
    const btn = screen.getByTestId('custom-collections-new-button');
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByTestId('custom-collections-upgrade-link')).not.toBeInTheDocument();
  });

  it('disables the New button at the 3-cap with the upsell tooltip', async () => {
    const three = [
      makeCustomCollection({ id: 'cc-1', name: 'A' }),
      makeCustomCollection({ id: 'cc-2', name: 'B' }),
      makeCustomCollection({ id: 'cc-3', name: 'C' }),
    ];
    const api = createFakeCustomCollectionApi({ collections: three });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-cap')).toHaveTextContent('3 / 3 used');
    });
    const btn = screen.getByTestId('custom-collections-new-button');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    const tooltipWrapper = screen.getByTestId('custom-collections-new-tooltip');
    expect(tooltipWrapper.getAttribute('title')).toContain('Free plan limit');
    const upgradeLink = screen.getByTestId('custom-collections-upgrade-link');
    expect(upgradeLink.getAttribute('href')).toBe('/billing');
  });
});

describe('CustomCollectionsView — create flow', () => {
  it('opens the create modal, submits, refreshes the list, and closes the modal', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    expect(api.listCustomCollections).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('custom-collections-new-button'));
    expect(screen.getByTestId('new-custom-collection-modal')).toBeInTheDocument();

    const nameInput = screen.getByTestId('new-custom-collection-name');
    await user.type(nameInput, 'Cool deck');
    await user.click(screen.getByTestId('new-custom-collection-submit'));

    await waitFor(() => {
      expect(api.createCustomCollection).toHaveBeenCalledTimes(1);
    });
    expect(api.createCustomCollection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Cool deck', slug: 'cool-deck' }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId('new-custom-collection-modal')).not.toBeInTheDocument();
    });
    // The view re-fetches the list on success.
    await waitFor(() => {
      expect(api.listCustomCollections).toHaveBeenCalledTimes(2);
    });
  });

  it('blocks the submit button while the name is empty', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('custom-collections-new-button'));
    const submit = screen.getByTestId('new-custom-collection-submit');
    expect(submit.getAttribute('aria-disabled')).toBe('true');
  });

  it('surfaces an error and keeps the modal open when create fails', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi();
    api.createCustomCollection.mockRejectedValueOnce(new Error('quota exceeded'));
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('custom-collections-new-button'));
    await user.type(screen.getByTestId('new-custom-collection-name'), 'X');
    await user.click(screen.getByTestId('new-custom-collection-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('new-custom-collection-error')).toHaveTextContent('quota exceeded');
    });
    expect(screen.getByTestId('new-custom-collection-modal')).toBeInTheDocument();
  });
});

describe('CustomCollectionsView — delete flow', () => {
  it('opens the confirm modal, fires DELETE, refreshes the list', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    expect(api.listCustomCollections).toHaveBeenCalledTimes(1);
    const rows = screen.getAllByTestId('custom-collection-row');
    const firstRow = rows[0]!;
    await user.click(within(firstRow).getByTestId('custom-collection-row-delete'));
    expect(screen.getByTestId('delete-custom-collection-modal')).toBeInTheDocument();
    expect(screen.getByTestId('delete-custom-collection-name')).toHaveTextContent('My Charizards');
    await user.click(screen.getByTestId('delete-custom-collection-confirm'));
    await waitFor(() => {
      expect(api.deleteCustomCollection).toHaveBeenCalledWith('cc-charizards');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('delete-custom-collection-modal')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(api.listCustomCollections).toHaveBeenCalledTimes(2);
    });
  });

  it('cancels without firing DELETE when the user cancels', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('custom-collection-row');
    await user.click(within(rows[0]!).getByTestId('custom-collection-row-delete'));
    await user.click(screen.getByTestId('delete-custom-collection-cancel'));
    expect(api.deleteCustomCollection).not.toHaveBeenCalled();
  });

  it('surfaces an error if delete fails', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi();
    api.deleteCustomCollection.mockRejectedValueOnce(new Error('forbidden'));
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('custom-collection-row');
    await user.click(within(rows[0]!).getByTestId('custom-collection-row-delete'));
    await user.click(screen.getByTestId('delete-custom-collection-confirm'));
    await waitFor(() => {
      expect(screen.getByTestId('delete-custom-collection-error')).toHaveTextContent('forbidden');
    });
  });
});

describe('CustomCollectionsView — loading', () => {
  it('renders a loading state while reads resolve', async () => {
    let resolveList: (() => void) | null = null;
    const api = createFakeCustomCollectionApi();
    api.listCustomCollections.mockImplementationOnce(
      () =>
        new Promise<typeof FIXTURE_COLLECTIONS>((resolve) => {
          resolveList = () => resolve(FIXTURE_COLLECTIONS);
        }),
    );
    renderView(api);
    expect(screen.getByText(/Loading your custom collections/)).toBeInTheDocument();
    await act(async () => {
      resolveList?.();
    });
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
  });

  it('closes the create modal when the user presses Escape', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('custom-collections-new-button'));
    expect(screen.getByTestId('new-custom-collection-modal')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('new-custom-collection-modal')).not.toBeInTheDocument();
    });
  });
});
