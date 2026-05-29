import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type {
  CardDto,
  CollectionItemDto,
  CompletionDto,
  PaginatedResponse,
  PerSetCompletionEntryDto,
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
    getSetBySlug: ReturnType<typeof vi.fn>;
    listCardsInSet: ReturnType<typeof vi.fn>;
    getCard: ReturnType<typeof vi.fn>;
    listPrintingsForCard: ReturnType<typeof vi.fn>;
    getPrinting: ReturnType<typeof vi.fn>;
  };
  collection: {
    getCompletion: ReturnType<typeof vi.fn>;
    listCollectionItems: ReturnType<typeof vi.fn>;
  };
}

function buildClient(): FakeClient {
  const listSets = vi.fn();
  // Default `getSetBySlug` mirrors the real api-client method: scan
  // the `listSets` page and match on `canonicalKey`, throwing
  // `ApiNotFoundError` on a miss. Tests seed the catalog via
  // `listSets.mockResolvedValue(...)` as before.
  const getSetBySlug = vi.fn(async ({ slug }: { slug: string }): Promise<SetDto> => {
    const page = (await listSets({ limit: 100 })) as PaginatedResponse<SetDto>;
    const match = page.items.find((set) => set.canonicalKey === slug);
    if (match === undefined) {
      throw new ApiNotFoundError(`No set found with canonical key "${slug}".`);
    }
    return match;
  });
  return {
    cards: {
      listSets,
      getSet: vi.fn(),
      getSetBySlug,
      listCardsInSet: vi.fn(),
      getCard: vi.fn(),
      listPrintingsForCard: vi.fn(),
      getPrinting: vi.fn(),
    },
    collection: {
      getCompletion: vi.fn(),
      listCollectionItems: vi.fn(),
    },
  };
}

function makePerSetEntry(
  partial: Partial<PerSetCompletionEntryDto> & {
    setId: string;
    setCode: string;
    setName: string;
  },
): PerSetCompletionEntryDto {
  return {
    setId: partial.setId,
    setCode: partial.setCode,
    setName: partial.setName,
    setPct: partial.setPct ?? 0,
    masterPct: partial.masterPct ?? 0,
    ownedNumbered: partial.ownedNumbered ?? 0,
    totalNumbered: partial.totalNumbered ?? 0,
    ownedMaster: partial.ownedMaster ?? 0,
    totalMaster: partial.totalMaster ?? 0,
  };
}

function makeCompletion(perSet: PerSetCompletionEntryDto[]): CompletionDto {
  const computedGlobal = perSet.reduce(
    (acc, row) => ({
      ownedNumbered: acc.ownedNumbered + row.ownedNumbered,
      totalNumbered: acc.totalNumbered + row.totalNumbered,
      ownedMaster: acc.ownedMaster + row.ownedMaster,
      totalMaster: acc.totalMaster + row.totalMaster,
    }),
    { ownedNumbered: 0, totalNumbered: 0, ownedMaster: 0, totalMaster: 0 },
  );
  const allPokemonPct =
    computedGlobal.totalNumbered > 0
      ? (computedGlobal.ownedNumbered / computedGlobal.totalNumbered) * 100
      : 0;
  const masterPct =
    computedGlobal.totalMaster > 0
      ? (computedGlobal.ownedMaster / computedGlobal.totalMaster) * 100
      : 0;
  return {
    global: {
      allPokemonPct,
      masterPct,
      uniqueCardsOwned: computedGlobal.ownedNumbered,
      uniqueCardsTotal: computedGlobal.totalNumbered,
      masterOwned: computedGlobal.ownedMaster,
      masterTotal: computedGlobal.totalMaster,
    },
    perSet,
    lastUpdatedAt: '2024-02-01T00:00:00Z',
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
  // Server completion math: 2/2 numbered cards, 2/3 master printings
  // (p1, p3 owned out of master-included p1/p2/p3 — p4 excluded).
  client.collection.getCompletion.mockResolvedValue(
    makeCompletion([
      makePerSetEntry({
        setId: 'set-1',
        setCode: 'set-1',
        setName: 'Base Set',
        ownedNumbered: 2,
        totalNumbered: 2,
        setPct: 100,
        masterPct: (2 / 3) * 100,
        ownedMaster: 2,
        totalMaster: 3,
      }),
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
    client.collection.getCompletion.mockResolvedValue(makeCompletion([]));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
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
    client.collection.getCompletion.mockResolvedValue(makeCompletion([]));
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
    client.collection.getCompletion.mockResolvedValue(makeCompletion([]));
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
    client.collection.getCompletion.mockResolvedValue(makeCompletion([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-set-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Catalog gone');
  });

  it('shows an error state when the V2 completion query rejects', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    client.collection.getCompletion.mockRejectedValue(new Error('Completion service down'));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-set-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Completion service down');
  });

  it('renders all-zero header progress when the set is absent from the completion perSet', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    // The server omits sets the user has no presence in. The
    // screen must render the header as all-zeros (not crash).
    client.collection.getCompletion.mockResolvedValue(makeCompletion([]));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-screen')).not.toBeNull(),
    );
    const setProgress = result.getByTestId('collection-set-set-progress');
    expect(setProgress.textContent).toContain('0%');
    expect(setProgress.textContent).toContain('0/0');
    const masterProgress = result.getByTestId('collection-set-master-progress');
    expect(masterProgress.textContent).toContain('0%');
  });

  it('reads the header tallies from the V2 completion endpoint, not the on-device set-completion math', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    seedHappyPath(client);
    // Override the server response with values that disagree with
    // what `computeCompletionForSet` would compute on-device — the
    // screen must trust the server.
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion([
        makePerSetEntry({
          setId: 'set-1',
          setCode: 'set-1',
          setName: 'Base Set',
          ownedNumbered: 7,
          totalNumbered: 12,
          setPct: 58.333,
          masterPct: 25,
          ownedMaster: 1,
          totalMaster: 4,
        }),
      ]),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-set-progress')).not.toBeNull(),
    );
    const setProgress = result.getByTestId('collection-set-set-progress');
    expect(setProgress.textContent).toContain('58%');
    expect(setProgress.textContent).toContain('7/12');
    const masterProgress = result.getByTestId('collection-set-master-progress');
    expect(masterProgress.textContent).toContain('25%');
    expect(masterProgress.textContent).toContain('1/4');
  });
});
