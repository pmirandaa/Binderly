import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SmartDetailView } from './SmartDetailView';
import {
  createFakeSmartCollectionsApi,
  makeCollectionItem,
  makeSmartRule,
  makeSubscription,
} from '../../../lib/collections/smart/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/smart/cc-smart-1',
  useSearchParams: () => new URLSearchParams(),
}));

describe('SmartDetailView — pro tier', () => {
  it('renders the saved smart-collection name and re-runs the expression via the server preview', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-name')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-detail-name').textContent).toBe(
      'All English Charizards',
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-match-count')).toBeInTheDocument();
    });
    // SMART_FIXTURE_EXPRESSION: card.name=Charizard AND
    // card.language=en → 4 of 7 scanned (JP card has a different
    // localized name). The server-preview fake mirrors that count.
    expect(api.runServerPreview).toHaveBeenCalledTimes(1);
    expect(api.runServerPreview.mock.calls[0]?.[0]).toMatchObject({
      expression: { type: 'and' },
    });
    expect(screen.getByTestId('smart-detail-match-count').textContent).toContain(
      '4 matches',
    );
    expect(screen.getAllByTestId('smart-match-tile').length).toBe(4);
    expect(screen.queryByTestId('smart-detail-local-fallback')).toBeNull();
  });

  it('renders the rule summary and an empty grid when nothing matches', async () => {
    const api = createFakeSmartCollectionsApi({
      rulesByCollectionId: {
        'cc-smart-1': makeSmartRule({
          expression: { type: 'eq', field: 'card.name', value: 'Mew' },
        }),
      },
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-grid-empty')).toBeInTheDocument();
    });
  });

  it('falls back to the local evaluator when the server rejects a `collection.*` predicate', async () => {
    const { ApiValidationError } = await import('@binderly/api-client');
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
      rulesByCollectionId: {
        'cc-smart-1': makeSmartRule({
          expression: {
            type: 'and',
            children: [
              { type: 'eq', field: 'card.name', value: 'Charizard' },
              { type: 'eq', field: 'collection.isOwned', value: true },
            ],
          },
        }),
      },
      ownedItems: [
        makeCollectionItem({ printingId: 'p-base-charizard-holo', quantity: 1 }),
      ],
      rejectServerPreview: new ApiValidationError(
        'collection.* predicates are not supported by the server preview yet',
      ),
    });
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-local-fallback')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-detail-match-count').textContent).toContain(
      '1 match',
    );
    expect(screen.getAllByTestId('smart-match-tile').length).toBe(1);
  });

  it('renders the run-error state when a non-validation server preview fails', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
      rejectServerPreview: new Error('worker crashed'),
    });
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-run-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-detail-run-error').textContent).toContain(
      'worker crashed',
    );
    expect(screen.queryByTestId('smart-detail-match-count')).toBeNull();
  });

  it('routes the back link to /collections/smart', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-back-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-detail-back-link').getAttribute('href')).toBe(
      '/collections/smart',
    );
  });

  it('fires onDelete when the destructive button is clicked', async () => {
    const onDelete = vi.fn();
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(
      <SmartDetailView
        api={api}
        collectionId="cc-smart-1"
        onDelete={onDelete}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-delete')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-detail-delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[0]?.id).toBe('cc-smart-1');
  });
});

describe('SmartDetailView — free tier', () => {
  it('renders the upsell instead of the rule + match grid', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-upgrade')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('smart-detail-results')).toBeNull();
    expect(screen.queryByTestId('smart-detail-rule')).toBeNull();
  });

  it('still surfaces the header so the user can see the name', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-name')).toBeInTheDocument();
    });
  });
});

describe('SmartDetailView — not found / errors', () => {
  it('renders the not-found state and fires onNotFound for an unknown id', async () => {
    const onNotFound = vi.fn();
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(
      <SmartDetailView
        api={api}
        collectionId="does-not-exist"
        onNotFound={onNotFound}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-not-found')).toBeInTheDocument();
    });
    expect(onNotFound).toHaveBeenCalled();
  });

  it('renders the error state when a non-not-found read fails', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
      rejectGetRule: new Error('rule fetch failed'),
    });
    renderWithProviders(
      <SmartDetailView api={api} collectionId="cc-smart-1" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-detail-error').textContent).toContain(
      'rule fetch failed',
    );
  });
});
