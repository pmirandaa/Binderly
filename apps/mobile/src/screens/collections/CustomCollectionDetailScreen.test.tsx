import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiNotFoundError,
  type BinderlyClient,
} from '@binderly/api-client';
import type {
  CollectionItemDto,
  CustomCollectionDto,
  CustomCollectionItemDto,
  PaginatedResponse,
} from '@binderly/api-contracts';

import { CustomCollectionDetailScreen } from './CustomCollectionDetailScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

// vi.hoisted is the only safe way to capture a stable params/router
// pair across the per-test re-mocks.
const { routerMocks, paramsRef } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
  paramsRef: { current: {} as Record<string, string | string[] | undefined> },
}));

vi.mock('expo-router', () => ({
  Slot: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Stack: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
    Screen: ({ children }: { children?: React.ReactNode }) => children ?? null,
  }),
  Tabs: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
    Screen: ({ children }: { children?: React.ReactNode }) => children ?? null,
  }),
  Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Redirect: () => null,
  router: routerMocks,
  useRouter: () => routerMocks,
  useLocalSearchParams: () => paramsRef.current,
  useSegments: () => [],
  usePathname: () => '/',
}));

beforeEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
  paramsRef.current = { id: 'cc-1' };
});

afterEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
});

// ============================================================
// Fixtures
// ============================================================

function makeCollection(
  partial: Partial<CustomCollectionDto> & { id: string },
): CustomCollectionDto {
  return {
    id: partial.id,
    userId: partial.userId ?? '00000000-0000-4000-8000-000000000001',
    name: partial.name ?? 'My Charizards',
    slug: partial.slug ?? 'my-charizards',
    kind: partial.kind ?? 'manual',
    description: partial.description ?? null,
    coverUrl: partial.coverUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeItem(
  partial: Partial<CustomCollectionItemDto> & { printingId: string },
): CustomCollectionItemDto {
  return {
    customCollectionId: partial.customCollectionId ?? 'cc-1',
    printingId: partial.printingId,
    addedAt: partial.addedAt ?? '2024-01-01T00:00:00Z',
  };
}

function makeOwnedItem(
  partial: { id: string; printingId: string },
): CollectionItemDto {
  return {
    id: partial.id,
    userId: '00000000-0000-4000-8000-000000000001',
    printingId: partial.printingId,
    quantity: 1,
    condition: 'NEAR_MINT',
    gradeCompany: null,
    grade: null,
    acquiredAt: null,
    acquiredPrice: null,
    acquiredCurrency: null,
    notes: null,
    photoUrls: [],
    source: 'manual',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function listCollectionPage(
  items: CollectionItemDto[],
): PaginatedResponse<CollectionItemDto> {
  return { items, nextCursor: null };
}

interface FakeClient {
  collection: {
    listCustomCollections: ReturnType<typeof vi.fn>;
    createCustomCollection: ReturnType<typeof vi.fn>;
    updateCustomCollection: ReturnType<typeof vi.fn>;
    deleteCustomCollection: ReturnType<typeof vi.fn>;
    listCustomCollectionItems: ReturnType<typeof vi.fn>;
    addPrintingToCustomCollection: ReturnType<typeof vi.fn>;
    removePrintingFromCustomCollection: ReturnType<typeof vi.fn>;
    getCustomCollection: ReturnType<typeof vi.fn>;
    getSmartCollectionRule: ReturnType<typeof vi.fn>;
    listCollectionItems: ReturnType<typeof vi.fn>;
  };
  cards: { getPrinting: ReturnType<typeof vi.fn> };
  profile: { getMySubscription: ReturnType<typeof vi.fn> };
}

function buildClient(): FakeClient {
  return {
    collection: {
      listCustomCollections: vi.fn(),
      createCustomCollection: vi.fn(),
      updateCustomCollection: vi.fn(),
      deleteCustomCollection: vi.fn(),
      listCustomCollectionItems: vi.fn(),
      addPrintingToCustomCollection: vi.fn(),
      removePrintingFromCustomCollection: vi.fn(),
      getCustomCollection: vi.fn(),
      getSmartCollectionRule: vi.fn(),
      listCollectionItems: vi.fn(),
    },
    cards: { getPrinting: vi.fn() },
    profile: { getMySubscription: vi.fn() },
  };
}

type FakeSession = {
  access_token: string;
  refresh_token: string;
  user: { id: string };
} | null;

function buildSupabase(initialSession: FakeSession = null) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: initialSession }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as Parameters<typeof AuthProvider>[0]['supabase'];
}

interface RenderOptions {
  readonly client: FakeClient;
  readonly session: FakeSession;
}

function renderScreen(opts: RenderOptions) {
  const supabase = buildSupabase(opts.session);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider supabase={supabase}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={opts.client as unknown as BinderlyClient}>
          {children}
        </ApiClientProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
  return renderWithProvider(<CustomCollectionDetailScreen />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

// ============================================================
// Tests
// ============================================================

describe('<CustomCollectionDetailScreen> — auth gate', () => {
  it('shows the sign-in prompt when no session is present', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(
        result.queryByTestId('custom-collection-detail-sign-in-prompt'),
      ).not.toBeNull(),
    );
    expect(client.collection.getCustomCollection).not.toHaveBeenCalled();
  });

  it('navigates to /auth/sign-in from the sign-in CTA', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(
        result.queryByTestId('custom-collection-detail-sign-in-button'),
      ).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-detail-sign-in-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('<CustomCollectionDetailScreen> — signed in', () => {
  it('renders the not-found state when id is missing', async () => {
    paramsRef.current = {};
    const client = buildClient();
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-detail-not-found')).not.toBeNull(),
    );
  });

  it('renders the not-found state when the api 404s', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockRejectedValue(
      new ApiNotFoundError('Not Found'),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-detail-not-found')).not.toBeNull(),
    );
  });

  it('renders the header (name + member count) for a manual collection', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1', name: 'Charizards', kind: 'manual' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([
      makeItem({ printingId: 'p1' }),
      makeItem({ printingId: 'p2' }),
    ]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-header')).not.toBeNull(),
    );
    expect(result.getByTestId('custom-collection-name-editor-display').textContent).toContain(
      'Charizards',
    );
    expect(result.getByTestId('custom-collection-member-count').textContent).toContain('2 cards');
  });

  it('rejects opening a smart collection on the manual route', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1', kind: 'smart' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-detail-error')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('smart collection');
  });

  it('inline-renames the collection on Save', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1', name: 'Charizards' }),
    );
    client.collection.updateCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1', name: 'My Charizards' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-name-editor-display')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-name-editor-display'));
    });
    const input = result.getByTestId('custom-collection-name-editor-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'My Charizards' } });
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-name-editor-save'));
    });
    await waitFor(() =>
      expect(client.collection.updateCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cc-1', patch: { name: 'My Charizards' } }),
      ),
    );
  });

  it('opens the picker, lists owned printings, and adds a printing on Add', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([]);
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([
        makeOwnedItem({ id: 'i1', printingId: '11111111-2222-4333-8444-555555555551' }),
      ]),
    );
    client.collection.addPrintingToCustomCollection.mockResolvedValue({
      customCollectionId: 'cc-1',
      printingId: '11111111-2222-4333-8444-555555555551',
      addedAt: '2024-01-01T00:00:00Z',
    });
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-add-cards')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-add-cards'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-picker')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(
        result.getByTestId(
          'custom-collection-picker-row-11111111-2222-4333-8444-555555555551-add',
        ),
      );
    });
    await waitFor(() =>
      expect(client.collection.addPrintingToCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          customCollectionId: 'cc-1',
          body: { printingId: '11111111-2222-4333-8444-555555555551' },
        }),
      ),
    );
  });

  it('navigates to /cards/[id] when a member tile is tapped', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([
      makeItem({ printingId: 'pr-1' }),
    ]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-member-pr-1')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-member-pr-1-open'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/cards/pr-1');
  });

  it('removes a member when the Remove button is tapped', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([
      makeItem({ printingId: 'pr-1' }),
    ]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    client.collection.removePrintingFromCustomCollection.mockResolvedValue(undefined);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-member-pr-1-remove')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-member-pr-1-remove'));
    });
    await waitFor(() =>
      expect(client.collection.removePrintingFromCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({ customCollectionId: 'cc-1', printingId: 'pr-1' }),
      ),
    );
  });

  it('two-step deletes the collection and replaces the route', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    client.collection.deleteCustomCollection.mockResolvedValue(undefined);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-delete')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-delete'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-delete-confirm')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-delete-confirm'));
    });
    await waitFor(() =>
      expect(client.collection.deleteCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cc-1' }),
      ),
    );
    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith('/collections'),
    );
  });

  it('cancels the delete confirmation when Cancel is tapped', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1' }),
    );
    client.collection.listCustomCollectionItems.mockResolvedValue([]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-delete')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-delete'));
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-delete-cancel'));
    });
    expect(client.collection.deleteCustomCollection).not.toHaveBeenCalled();
    expect(result.queryByTestId('custom-collection-delete-confirm')).toBeNull();
  });

  it('shows an error state when the items query fails', async () => {
    const client = buildClient();
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'cc-1' }),
    );
    client.collection.listCustomCollectionItems.mockRejectedValue(new Error('items down'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-detail-error')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('items down');
  });
});
