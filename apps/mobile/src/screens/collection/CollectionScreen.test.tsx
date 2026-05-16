import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CollectionItemDto,
  PaginatedResponse,
  PrintingWithContextDto,
  SetDto,
} from '@binderly/api-contracts';

import { CollectionScreen } from './CollectionScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

// Stable router mock — follow-up #13 (T-M-AUTH precedent). The
// global setup mock returns a fresh router per call, so we re-mock
// locally to observe `router.push` / `router.replace`.
const { routerMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
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
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  usePathname: () => '/',
}));

beforeEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
});

afterEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
});

// ============================================================
// Fixtures
// ============================================================

function makeSet(partial: Partial<SetDto> & { id: string }): SetDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-${partial.id}`,
    code: partial.code ?? partial.id,
    language: partial.language ?? 'en',
    name: partial.name ?? `Set ${partial.id}`,
    series: partial.series ?? 'Series',
    releaseDate: partial.releaseDate ?? '2024-01-01',
    printedTotal: partial.printedTotal ?? null,
    total: 'total' in partial ? (partial.total ?? null) : 100,
    logoUrl: partial.logoUrl ?? null,
    symbolUrl: partial.symbolUrl ?? null,
    masterSetRules: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeCollectionItem(partial: Partial<CollectionItemDto> & { id: string; printingId: string }): CollectionItemDto {
  return {
    id: partial.id,
    userId: partial.userId ?? 'user-1',
    printingId: partial.printingId,
    quantity: partial.quantity ?? 1,
    condition: partial.condition ?? 'NEAR_MINT',
    gradeCompany: partial.gradeCompany ?? null,
    grade: partial.grade ?? null,
    acquiredAt: partial.acquiredAt ?? null,
    acquiredPrice: partial.acquiredPrice ?? null,
    acquiredCurrency: partial.acquiredCurrency ?? null,
    notes: partial.notes ?? null,
    photoUrls: partial.photoUrls ?? [],
    source: partial.source ?? 'manual',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makePrintingContext(
  partial: Omit<Partial<PrintingWithContextDto>, 'set'> & {
    id: string;
    cardId: string;
    set: { id: string };
  },
): PrintingWithContextDto {
  const set = makeSet({ id: partial.set.id });
  return {
    id: partial.id,
    variantKey: partial.variantKey ?? `${partial.cardId}-${partial.id}`,
    cardId: partial.cardId,
    variantClass: partial.variantClass ?? 'NON_HOLO',
    variantFlags: partial.variantFlags ?? [],
    variantCode: partial.variantCode ?? 'std',
    includeInMasterSet: partial.includeInMasterSet ?? true,
    imageSmallUrl: partial.imageSmallUrl ?? null,
    imageLargeUrl: partial.imageLargeUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    card: {
      id: partial.cardId,
      canonicalKey: `en-card-${partial.cardId}`,
      setId: partial.set.id,
      language: 'en',
      number: '1',
      name: `Card ${partial.cardId}`,
      nameLocalized: null,
      type: null,
      subtype: null,
      hp: null,
      illustrator: null,
      flavorText: null,
      attacks: null,
      weakness: null,
      resistance: null,
      retreatCost: null,
      rarity: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    set,
  };
}

function listCollectionPage(
  items: CollectionItemDto[],
): PaginatedResponse<CollectionItemDto> {
  return { items, nextCursor: null };
}

function listSetsPage(items: SetDto[]): PaginatedResponse<SetDto> {
  return { items, nextCursor: null };
}

interface FakeClient {
  cards: {
    listSets: ReturnType<typeof vi.fn>;
    getSet: ReturnType<typeof vi.fn>;
    listCardsInSet: ReturnType<typeof vi.fn>;
    getCard: ReturnType<typeof vi.fn>;
    listPrintingsForCard: ReturnType<typeof vi.fn>;
    getPrinting: ReturnType<typeof vi.fn>;
  };
  collection: {
    listCollectionItems: ReturnType<typeof vi.fn>;
  };
}

function buildClient(): FakeClient {
  return {
    cards: {
      listSets: vi.fn(),
      getSet: vi.fn(),
      listCardsInSet: vi.fn(),
      getCard: vi.fn(),
      listPrintingsForCard: vi.fn(),
      getPrinting: vi.fn(),
    },
    collection: {
      listCollectionItems: vi.fn(),
    },
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
  return renderWithProvider(<CollectionScreen />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

// ============================================================
// Tests
// ============================================================

describe('<CollectionScreen> — auth gate', () => {
  it('shows the sign-in prompt when no session is present', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('collection-sign-in-prompt')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('Sign in to see your collection');
    expect(client.collection.listCollectionItems).not.toHaveBeenCalled();
  });

  it('navigates to /auth/sign-in when the sign-in CTA is tapped', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('collection-sign-in-button')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-sign-in-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('<CollectionScreen> — signed in', () => {
  it('renders the global completion badge with the correct All Pokémon %', async () => {
    const client = buildClient();
    const setA = makeSet({ id: 'set-a', name: 'Alpha', total: 10 });
    const setB = makeSet({ id: 'set-b', name: 'Beta', total: 4 });
    client.cards.listSets.mockResolvedValue(listSetsPage([setA, setB]));
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([
        makeCollectionItem({ id: 'i1', printingId: 'p1' }),
        makeCollectionItem({ id: 'i2', printingId: 'p2' }),
      ]),
    );
    client.cards.getPrinting.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'p1') return makePrintingContext({ id: 'p1', cardId: 'c1', set: { id: 'set-a' } });
      return makePrintingContext({ id: 'p2', cardId: 'c2', set: { id: 'set-a' } });
    });
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-global-badge')).not.toBeNull(),
    );
    // 2 unique cards owned of 14 total (10 + 4) = 14% → rounds to 14%.
    const badge = result.getByTestId('collection-global-badge');
    expect(badge.textContent).toContain('14%');
    expect(badge.textContent).toContain('2/14');
  });

  it('renders the per-set list ordered by completion % desc', async () => {
    const client = buildClient();
    const setLow = makeSet({
      id: 'set-low',
      name: 'Low',
      total: 10,
      releaseDate: '2024-01-01',
    });
    const setHigh = makeSet({
      id: 'set-high',
      name: 'High',
      total: 2,
      releaseDate: '2023-01-01',
    });
    client.cards.listSets.mockResolvedValue(listSetsPage([setLow, setHigh]));
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([
        // 2/2 in setHigh = 100%, 1/10 in setLow = 10%.
        makeCollectionItem({ id: 'i1', printingId: 'p1' }),
        makeCollectionItem({ id: 'i2', printingId: 'p2' }),
        makeCollectionItem({ id: 'i3', printingId: 'p3' }),
      ]),
    );
    client.cards.getPrinting.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'p1') return makePrintingContext({ id: 'p1', cardId: 'c1', set: { id: 'set-high' } });
      if (id === 'p2') return makePrintingContext({ id: 'p2', cardId: 'c2', set: { id: 'set-high' } });
      return makePrintingContext({ id: 'p3', cardId: 'c3', set: { id: 'set-low' } });
    });
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-row-en-set-high')).not.toBeNull(),
    );
    const list = result.getByTestId('collection-list');
    const rows = Array.from(list.querySelectorAll('[data-testid^="collection-list-item-"]'));
    expect(rows[0]?.textContent).toContain('High');
    expect(rows[1]?.textContent).toContain('Low');
  });

  it('shows an empty-collection state with a Browse CTA when nothing is owned', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([makeSet({ id: 'set-a' })]));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-empty')).not.toBeNull());
    expect(result.container.textContent).toContain('Your collection is empty');
  });

  it('navigates to /(tabs)/browse when the Browse CTA is tapped', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([makeSet({ id: 'set-a' })]));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-empty-browse')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-empty-browse'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/(tabs)/browse');
  });

  it('shows the loading state while the queries are in flight', () => {
    const client = buildClient();
    client.cards.listSets.mockReturnValue(new Promise(() => undefined));
    client.collection.listCollectionItems.mockReturnValue(new Promise(() => undefined));
    const result = renderScreen({ client, session: SIGNED_IN });
    expect(result.getByTestId('collection-loading')).toBeDefined();
  });

  it('shows an error state when the collection items query rejects', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([makeSet({ id: 'set-a' })]));
    client.collection.listCollectionItems.mockRejectedValue(new Error('Network down'));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Network down');
  });

  it('shows an error state when the sets query rejects', async () => {
    const client = buildClient();
    client.cards.listSets.mockRejectedValue(new Error('Catalog unreachable'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Catalog unreachable');
  });

  it('triggers a refetch when pull-to-refresh fires', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(
      listSetsPage([makeSet({ id: 'set-a', total: 1 })]),
    );
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([makeCollectionItem({ id: 'i1', printingId: 'p1' })]),
    );
    client.cards.getPrinting.mockResolvedValue(
      makePrintingContext({ id: 'p1', cardId: 'c1', set: { id: 'set-a' } }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-refresh')).not.toBeNull());
    expect(client.collection.listCollectionItems).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-refresh'));
    });
    await waitFor(() =>
      expect(client.collection.listCollectionItems).toHaveBeenCalledTimes(2),
    );
  });

  it('navigates to the per-set drill-down when a row is tapped', async () => {
    const client = buildClient();
    const set = makeSet({ id: 'set-a', canonicalKey: 'en-set-a', total: 1 });
    client.cards.listSets.mockResolvedValue(listSetsPage([set]));
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([makeCollectionItem({ id: 'i1', printingId: 'p1' })]),
    );
    client.cards.getPrinting.mockResolvedValue(
      makePrintingContext({ id: 'p1', cardId: 'c1', set: { id: 'set-a' } }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-row-en-set-a')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-set-row-en-set-a'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/collection/sets/en-set-a');
  });

  it('renders a per-set Set % bar reflecting owned cards over set.total', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(
      listSetsPage([makeSet({ id: 'set-a', canonicalKey: 'en-set-a', total: 4 })]),
    );
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([
        makeCollectionItem({ id: 'i1', printingId: 'p1' }),
        makeCollectionItem({ id: 'i2', printingId: 'p2' }),
      ]),
    );
    client.cards.getPrinting.mockImplementation(async ({ id }: { id: string }) =>
      makePrintingContext({
        id,
        cardId: id === 'p1' ? 'c1' : 'c2',
        set: { id: 'set-a' },
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-row-en-set-a')).not.toBeNull(),
    );
    const setProgress = result.getByTestId('collection-set-row-en-set-a-set-progress');
    expect(setProgress.textContent).toContain('50%');
    expect(setProgress.textContent).toContain('2/4');
  });
});
