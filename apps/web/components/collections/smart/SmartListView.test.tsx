import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SmartListView } from './SmartListView';
import {
  createFakeSmartCollectionsApi,
  makeSmartCollection,
  makeSubscription,
} from '../../../lib/collections/smart/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/smart',
  useSearchParams: () => new URLSearchParams(),
}));

describe('SmartListView — free tier', () => {
  it('shows the upgrade prompt and hides the saved-list', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-upgrade')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('smart-list')).toBeNull();
    expect(screen.getByTestId('smart-list-subtitle').textContent).toContain('0 / 0');
  });

  it('renders the Try a smart query CTA pointing to /collections/smart/new', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-try-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-list-try-link').getAttribute('href')).toBe(
      '/collections/smart/new',
    );
  });

  it('renders the page title', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-list-title').textContent).toContain(
      'Smart collections',
    );
  });
});

describe('SmartListView — pro tier', () => {
  it('renders one row per saved smart collection', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('smart-list-row');
    expect(rows).toHaveLength(2);
  });

  it('renders the saved expression summary inline', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getAllByTestId('smart-list-row-summary').length).toBeGreaterThan(0);
    });
    const summaries = screen
      .getAllByTestId('smart-list-row-summary')
      .map((s) => s.textContent ?? '');
    expect(summaries.some((s) => s.includes('Charizard'))).toBe(true);
  });

  it('shows the saved-count header for the pro tier', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-subtitle')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-list-subtitle').textContent).toContain('2 / ∞');
  });

  it('shows the empty state when the user has no saved smart collections', async () => {
    const api = createFakeSmartCollectionsApi({
      collections: [],
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-empty')).toBeInTheDocument();
    });
  });

  it('routes each row to /collections/smart/[id]', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getAllByTestId('smart-list-row').length).toBeGreaterThan(0);
    });
    const hrefs = screen
      .getAllByTestId('smart-list-row-link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/collections/smart/cc-smart-1');
    expect(hrefs).toContain('/collections/smart/cc-smart-2');
  });

  it('fires onDelete with the row collection when the Delete button is clicked', async () => {
    const onDelete = vi.fn();
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartListView api={api} onDelete={onDelete} />);
    await waitFor(() => {
      expect(screen.getAllByTestId('smart-list-row-delete').length).toBeGreaterThan(0);
    });
    const firstDelete = screen.getAllByTestId('smart-list-row-delete')[0]!;
    fireEvent.click(firstDelete);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[0]?.id).toBe('cc-smart-1');
  });

  it('falls back to a placeholder summary when the rule fetch fails', async () => {
    const api = createFakeSmartCollectionsApi({
      collections: [makeSmartCollection({ id: 'cc-broken' })],
      rulesByCollectionId: {},
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-row-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-list-row-summary').textContent).toContain(
      'unable to load',
    );
  });
});

describe('SmartListView — error & loading', () => {
  it('renders the error state when the api throws', async () => {
    const api = createFakeSmartCollectionsApi({
      rejectAll: new Error('backend unavailable'),
    });
    renderWithProviders(<SmartListView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-list-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-list-error').textContent).toContain(
      'backend unavailable',
    );
  });

  it('renders a loading state until the read resolves', async () => {
    const api = createFakeSmartCollectionsApi();
    let resolve: (() => void) | null = null;
    api.listSmartCollections.mockImplementation(
      () =>
        new Promise<never[]>((r) => {
          resolve = (): void => r([]);
        }),
    );
    renderWithProviders(<SmartListView api={api} />);
    expect(screen.getByText(/loading smart collections/i)).toBeInTheDocument();
    resolve?.();
    await waitFor(() => {
      expect(
        within(screen.getByTestId('smart-list-page')).getByTestId('smart-list-upgrade'),
      ).toBeInTheDocument();
    });
  });
});
