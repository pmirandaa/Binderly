import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CardDto,
  CollectionItemDto,
  PaginatedResponse,
  PrintingDto,
  SetDto,
} from '@binderly/api-contracts';

import { CollectionSetScreen } from './CollectionSetScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

// Stable router + search-params mocks. The global setup mock
// returns `useLocalSearchParams() === {}`, which makes the screen
// render the not-found branch on every test — re-mock locally so
// the slug + router calls are observable.
const { routerMocks, paramsHolder } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
  paramsHolder: {
    current: {} as Record<string, string | string[] | undefined>,
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
  useLocalSearchParams: () => paramsHolder.current,
  useSegments: () => [],
  usePathname: () => '/',
}));

beforeEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
  paramsHolder.current = {};
});

afterEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
  paramsHolder.current = {};
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

function makeCard(partial: Partial<CardDto> & { id: string; setId: string }): CardDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-card-${partial.id}`,
    setId: partial.setId,
    language: partial.language ?? 'en',
    number: partial.number ?? '1',
    name: partial.name ?? `Card ${partial.id}`,
    nameLocalized: partial.nameLocalized ?? null,
    type: partial.type ?? null,
    subtype: partial.subtype ?? null,
    hp: partial.hp ?? null,
    illustrator: partial.illustrator ?? null,
    flavorText: partial.flavorText ?? null,
    attacks: partial.attacks ?? null,
    weakness: partial.weakness ?? null,
    resistance: partial.resistance ?? null,
    retreatCost: partial.retreatCost ?? null,
    rarity: partial.rarity ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makePrinting(
  partial: Partial<PrintingDto> & { id: string; cardId: string },
): PrintingDto {
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
  };
}

function makeCollectionItem(
  partial: Partial<CollectionItemDto> & { id: string; printingId: string },
): CollectionItemDto {
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

function listSetsPage(items: SetDto[]): PaginatedResponse<SetDto> {
  return { items, nextCursor: null };
}

function listCardsPage(items: CardDto[]): PaginatedResponse<CardDto> {
  return { items, nextCursor: null };
}

function listCollectionPage(
  items: CollectionItemDto[],
): PaginatedResponse<CollectionItemDto> {
  return { items, nextCursor: null };
}

// ============================================================
// Wiring
// ============================================================

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
  return renderWithProvider(<CollectionSetScreen />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

const SET = makeSet({ id: 'set-1', canonicalKey: 'en-base1', name: 'Base Set', total: 4 });

function seedHappyPath(client: FakeClient): void {
  client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
  client.cards.listCardsInSet.mockResolvedValue(
    listCardsPage([
      makeCard({ id: 'c1', setId: 'set-1' }),
      makeCard({ id: 'c2', setId: 'set-1' }),
    ]),
  );
  client.cards.listPrintingsForCard.mockImplementation(
    async ({ cardId }: { cardId: string }) => {
      if (cardId === 'c1') {
        return [
          makePrinting({ id: 'p1', cardId: 'c1', variantClass: 'HOLO', includeInMasterSet: true }),
          makePrinting({ id: 'p2', cardId: 'c1', variantClass: 'NON_HOLO', includeInMasterSet: true }),
        ];
      }
      return [
        makePrinting({ id: 'p3', cardId: 'c2', variantClass: 'HOLO', includeInMasterSet: true }),
        makePrinting({ id: 'p4', cardId: 'c2', variantClass: 'REVERSE_HOLO', includeInMasterSet: false }),
      ];
    },
  );
  client.collection.listCollectionItems.mockResolvedValue(
    listCollectionPage([
      makeCollectionItem({ id: 'i1', printingId: 'p1' }),
      makeCollectionItem({ id: 'i2', printingId: 'p3' }),
    ]),
  );
}

// ============================================================
// Tests
// ============================================================

describe('<CollectionSetScreen> — auth gate', () => {
  it('shows the sign-in prompt for an unauthenticated user', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-sign-in-prompt')).not.toBeNull(),
    );
    expect(client.collection.listCollectionItems).not.toHaveBeenCalled();
  });

  it('routes to /auth/sign-in when the sign-in CTA is tapped', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-sign-in-button')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-set-sign-in-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('<CollectionSetScreen> — slug routing', () => {
  it('renders the not-found surface when no slug is supplied', async () => {
    paramsHolder.current = {};
    const client = buildClient();
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-not-found')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('Set not found');
  });

  it('renders the not-found surface when the slug is unknown', async () => {
    paramsHolder.current = { slug: 'en-unknown' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-not-found')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('en-unknown');
  });

  it('accepts a slug delivered as an array (deep-link fallback)', async () => {
    paramsHolder.current = { slug: ['en-base1', 'extra'] };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-screen')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('Base Set');
  });
});

describe('<CollectionSetScreen> — render', () => {
  it('renders the header with set name + accurate Set / Master percentages', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-screen')).not.toBeNull(),
    );
    const header = result.getByTestId('collection-set-header');
    expect(header.textContent).toContain('Base Set');
    // Drill-down has the precise per-set roster (2 cards: c1, c2) and
    // ignores `set.total` once it knows the real numbered count.
    // User owns ≥1 printing of each card → Set % = 2/2 = 100%.
    const setProgress = result.getByTestId('collection-set-set-progress');
    expect(setProgress.textContent).toContain('100%');
    expect(setProgress.textContent).toContain('2/2');
    // Owned master printings: p1 (master=true), p3 (master=true) of master-included
    // printings p1, p2, p3 = 3 → 2/3 = 66.66… → rounded 67%.
    const masterProgress = result.getByTestId('collection-set-master-progress');
    expect(masterProgress.textContent).toContain('67%');
    expect(masterProgress.textContent).toContain('2/3');
  });

  it('defaults to the Owned tab and lists the user’s owned printings', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-owned-list')).not.toBeNull(),
    );
    const ownedList = result.getByTestId('collection-set-owned-list');
    expect(ownedList.querySelectorAll('[data-testid^="collection-printing-tile-"]')).toHaveLength(
      2,
    );
    expect(ownedList.textContent).toContain('Owned');
  });

  it('switches to the Missing tab and lists not-owned printings', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-tab-missing')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-set-tab-missing'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-missing-list')).not.toBeNull(),
    );
    const missingList = result.getByTestId('collection-set-missing-list');
    // Two missing printings (p2, p4).
    expect(
      missingList.querySelectorAll('[data-testid^="collection-printing-tile-"]'),
    ).toHaveLength(2);
  });

  it('updates the active-tab visual state when a tab is tapped', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-tab-missing')).not.toBeNull(),
    );
    expect(
      result.getByTestId('collection-set-tab-owned').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      result.getByTestId('collection-set-tab-missing').getAttribute('aria-pressed'),
    ).toBe('false');
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-set-tab-missing'));
    });
    expect(
      result.getByTestId('collection-set-tab-missing').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      result.getByTestId('collection-set-tab-owned').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('shows the empty-owned state when the user owns nothing in the set', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-owned-empty')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('No owned printings yet');
  });

  it('shows the empty-missing state when the user owns every printing in the set', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([
        makeCollectionItem({ id: 'i1', printingId: 'p1' }),
        makeCollectionItem({ id: 'i2', printingId: 'p2' }),
        makeCollectionItem({ id: 'i3', printingId: 'p3' }),
        makeCollectionItem({ id: 'i4', printingId: 'p4' }),
      ]),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-tab-missing')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-set-tab-missing'));
    });
    expect(result.queryByTestId('collection-set-missing-empty')).not.toBeNull();
  });

  it('navigates to /cards/{cardId} when a printing tile is tapped', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-printing-tile-p1')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-printing-tile-p1'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/cards/c1');
  });

  it('shows an error state when the catalog query rejects', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.cards.listCardsInSet.mockRejectedValue(new Error('Catalog gone'));
    client.cards.listPrintingsForCard.mockResolvedValue([]);
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-set-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Catalog gone');
  });
});
