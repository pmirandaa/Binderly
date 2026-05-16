import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';

import { CustomCollectionDetailView } from './CustomCollectionDetailView';
import {
  createFakeCustomCollectionApi,
  makeCustomCollection,
  makeCustomCollectionItem,
  makePrintingWithContextLite,
} from '../../../lib/collections/custom/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/custom/cc-charizards',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => undefined,
}));

function renderDetail(
  api: ReturnType<typeof createFakeCustomCollectionApi>,
  collectionId = 'cc-charizards',
  onNotFound?: () => void,
): void {
  renderWithProviders(
    <CustomCollectionDetailView api={api} collectionId={collectionId} onNotFound={onNotFound} />,
  );
}

const sampleItems = [
  makeCustomCollectionItem({
    customCollectionId: 'cc-charizards',
    printingId: 'p-charizard-holo',
  }),
  makeCustomCollectionItem({
    customCollectionId: 'cc-charizards',
    printingId: 'p-charizard-rh',
    addedAt: '2024-04-12T08:00:00.000Z',
  }),
];

const samplePrintings = {
  'p-charizard-holo': makePrintingWithContextLite({ id: 'p-charizard-holo' }),
  'p-charizard-rh': makePrintingWithContextLite({
    id: 'p-charizard-rh',
    variantClass: 'REVERSE_HOLO',
    variantCode: 'reverse-holo',
  }),
};

describe('CustomCollectionDetailView — load + 404', () => {
  it('renders 404 fallback and fires onNotFound for an unknown id', async () => {
    const onNotFound = vi.fn();
    const api = createFakeCustomCollectionApi();
    api.getCustomCollection.mockRejectedValueOnce(new ApiNotFoundError('not found'));
    renderDetail(api, 'unknown', onNotFound);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-not-found')).toBeInTheDocument();
    });
    expect(onNotFound).toHaveBeenCalled();
  });

  it('renders members from the api-client (printingId resolution)', async () => {
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': sampleItems },
      printingsById: samplePrintings,
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-members')).toBeInTheDocument();
    });
    const tiles = screen.getAllByTestId('custom-collection-detail-member');
    expect(tiles).toHaveLength(2);
    expect(api.getPrintingsByIds).toHaveBeenCalledWith(
      ['p-charizard-holo', 'p-charizard-rh'],
      expect.anything(),
    );
  });

  it('renders the empty state when a collection has no members', async () => {
    const api = createFakeCustomCollectionApi();
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-empty')).toBeInTheDocument();
    });
    expect(api.getPrintingsByIds).not.toHaveBeenCalled();
  });

  it('renders an error state when the api-client throws', async () => {
    const api = createFakeCustomCollectionApi({
      rejectAll: new Error('backend down'),
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('custom-collection-detail-error')).toHaveTextContent('backend down');
  });

  it('treats a smart-kind row at the manual URL as 404', async () => {
    const api = createFakeCustomCollectionApi({
      collections: [
        makeCustomCollection({
          id: 'cc-smart',
          name: 'Smart',
          kind: 'smart',
        }),
      ],
    });
    const onNotFound = vi.fn();
    renderDetail(api, 'cc-smart', onNotFound);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-not-found')).toBeInTheDocument();
    });
    expect(onNotFound).toHaveBeenCalled();
  });
});

describe('CustomCollectionDetailView — rename (inline edit)', () => {
  it('fires PATCH on blur and optimistically updates the header', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': [] },
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-name-input')).toBeInTheDocument();
    });
    const input = screen.getByTestId('custom-collection-detail-name-input');
    await user.clear(input);
    await user.type(input, 'Renamed');
    fireEvent.blur(input);
    await waitFor(() => {
      expect(api.updateCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cc-charizards',
          patch: { name: 'Renamed' },
        }),
      );
    });
  });

  it('does not fire PATCH when the name is unchanged on blur', async () => {
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': [] },
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-name-input')).toBeInTheDocument();
    });
    fireEvent.blur(screen.getByTestId('custom-collection-detail-name-input'));
    expect(api.updateCustomCollection).not.toHaveBeenCalled();
  });

  it('reverts to the original name when the user clears it before blur', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': [] },
    });
    renderDetail(api);
    const input = await screen.findByTestId('custom-collection-detail-name-input');
    await user.clear(input);
    fireEvent.blur(input);
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('My Charizards');
    });
    expect(api.updateCustomCollection).not.toHaveBeenCalled();
  });

  it('fires PATCH on description blur with the new value', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': [] },
    });
    renderDetail(api);
    const desc = await screen.findByTestId('custom-collection-detail-description-input');
    await user.clear(desc);
    await user.type(desc, 'Brand new copy');
    fireEvent.blur(desc);
    await waitFor(() => {
      expect(api.updateCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cc-charizards',
          patch: { description: 'Brand new copy' },
        }),
      );
    });
  });
});

describe('CustomCollectionDetailView — add cards', () => {
  it('opens the picker, multi-selects, and fires POST per printing', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': [] },
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-empty')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('custom-collection-detail-add-cards'));
    await waitFor(() => {
      expect(screen.getByTestId('add-cards-modal')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('add-cards-set-select')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('add-cards-set-select'), {
      target: { value: 'set-base' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('add-cards-results')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('add-cards-row');
    expect(rows).toHaveLength(2);
    await user.click(within(rows[0]!).getByTestId('add-cards-row-checkbox'));
    await user.click(within(rows[1]!).getByTestId('add-cards-row-checkbox'));
    expect(screen.getByTestId('add-cards-selection-count')).toHaveTextContent('2 selected');
    await user.click(screen.getByTestId('add-cards-submit'));
    await waitFor(() => {
      expect(api.addPrintingToCustomCollection).toHaveBeenCalledTimes(2);
    });
    expect(api.addPrintingToCustomCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        customCollectionId: 'cc-charizards',
        printingId: 'p-charizard-holo',
      }),
    );
  });

  it('disables the checkbox for printings already in the collection', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: {
        'cc-charizards': [
          makeCustomCollectionItem({
            customCollectionId: 'cc-charizards',
            printingId: 'p-charizard-holo',
          }),
        ],
      },
      printingsById: samplePrintings,
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-members')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('custom-collection-detail-add-cards'));
    await waitFor(() => {
      expect(screen.getByTestId('add-cards-modal')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('add-cards-set-select')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('add-cards-set-select'), {
      target: { value: 'set-base' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('add-cards-results')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('add-cards-row');
    const charizardRow = rows.find(
      (row) => row.getAttribute('data-printing-id') === 'p-charizard-holo',
    );
    expect(charizardRow).toBeDefined();
    expect(within(charizardRow!).getByTestId('add-cards-row-already-added')).toBeInTheDocument();
    expect(within(charizardRow!).getByTestId('add-cards-row-checkbox')).toBeDisabled();
  });
});

describe('CustomCollectionDetailView — remove cards', () => {
  it('removes a member optimistically and fires DELETE', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': sampleItems },
      printingsById: samplePrintings,
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-members')).toBeInTheDocument();
    });
    const tiles = screen.getAllByTestId('custom-collection-detail-member');
    expect(tiles).toHaveLength(2);
    await user.click(within(tiles[0]!).getByTestId('custom-collection-detail-member-remove'));
    // Optimistic: tile is gone before DELETE resolves.
    await waitFor(() => {
      expect(screen.getAllByTestId('custom-collection-detail-member')).toHaveLength(1);
    });
    await waitFor(() => {
      expect(api.removePrintingFromCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          customCollectionId: 'cc-charizards',
          printingId: 'p-charizard-holo',
        }),
      );
    });
  });

  it('rolls back the tile and surfaces an error when DELETE fails', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': sampleItems },
      printingsById: samplePrintings,
    });
    api.removePrintingFromCustomCollection.mockRejectedValueOnce(new Error('transient'));
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-members')).toBeInTheDocument();
    });
    const tiles = screen.getAllByTestId('custom-collection-detail-member');
    await user.click(within(tiles[0]!).getByTestId('custom-collection-detail-member-remove'));
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-member-error')).toHaveTextContent(
        'transient',
      );
    });
    // Roll back: tile count should return to 2.
    await waitFor(() => {
      expect(screen.getAllByTestId('custom-collection-detail-member')).toHaveLength(2);
    });
  });
});

describe('CustomCollectionDetailView — delete via header button', () => {
  it('opens the delete confirm modal from the detail header', async () => {
    const user = userEvent.setup();
    const api = createFakeCustomCollectionApi({
      itemsByCollectionId: { 'cc-charizards': [] },
    });
    renderDetail(api);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collection-detail-empty')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('custom-collection-detail-delete'));
    expect(screen.getByTestId('delete-custom-collection-modal')).toBeInTheDocument();
  });
});
