import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CompletionDto,
  PaginatedResponse,
  PerSetCompletionEntryDto,
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

function listSetsPage(items: SetDto[]): PaginatedResponse<SetDto> {
  return { items, nextCursor: null };
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

function makeCompletion(
  partial: Partial<CompletionDto> & { perSet: PerSetCompletionEntryDto[] },
): CompletionDto {
  const computedGlobal = partial.perSet.reduce(
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
    global: partial.global ?? {
      allPokemonPct,
      masterPct,
      uniqueCardsOwned: computedGlobal.ownedNumbered,
      uniqueCardsTotal: computedGlobal.totalNumbered,
      masterOwned: computedGlobal.ownedMaster,
      masterTotal: computedGlobal.totalMaster,
    },
    perSet: partial.perSet,
    lastUpdatedAt:
      partial.lastUpdatedAt !== undefined ? partial.lastUpdatedAt : '2024-02-01T00:00:00Z',
  };
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
    getCompletion: ReturnType<typeof vi.fn>;
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
      getCompletion: vi.fn(),
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
    expect(client.collection.getCompletion).not.toHaveBeenCalled();
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
  it('renders the global completion badge with the server-supplied All Pokémon %', async () => {
    const client = buildClient();
    const setA = makeSet({ id: 'set-a', name: 'Alpha', total: 10 });
    const setB = makeSet({ id: 'set-b', name: 'Beta', total: 4 });
    client.cards.listSets.mockResolvedValue(listSetsPage([setA, setB]));
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        global: {
          allPokemonPct: 14,
          masterPct: 10,
          uniqueCardsOwned: 2,
          uniqueCardsTotal: 14,
          masterOwned: 1,
          masterTotal: 10,
        },
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 2,
            totalNumbered: 10,
            setPct: 20,
            masterPct: 25,
            ownedMaster: 1,
            totalMaster: 4,
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-global-badge')).not.toBeNull(),
    );
    const badge = result.getByTestId('collection-global-badge');
    expect(badge.textContent).toContain('14%');
    expect(badge.textContent).toContain('2/14');
  });

  it('renders the real Master % on the global badge (no more parked placeholder)', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([makeSet({ id: 'set-a', total: 4 })]));
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        global: {
          allPokemonPct: 50,
          masterPct: 60,
          uniqueCardsOwned: 2,
          uniqueCardsTotal: 4,
          masterOwned: 3,
          masterTotal: 5,
        },
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 2,
            totalNumbered: 4,
            setPct: 50,
            masterPct: 60,
            ownedMaster: 3,
            totalMaster: 5,
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-global-badge')).not.toBeNull(),
    );
    const counters = result.getByTestId('collection-global-badge-counters');
    expect(counters.textContent).toContain('Master %');
    expect(counters.textContent).toContain('60%');
    expect(counters.textContent).toContain('3/5');
    expect(counters.textContent).not.toContain('full math soon');
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
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        perSet: [
          makePerSetEntry({
            setId: 'set-low',
            setCode: 'set-low',
            setName: 'Low',
            ownedNumbered: 1,
            totalNumbered: 10,
            setPct: 10,
          }),
          makePerSetEntry({
            setId: 'set-high',
            setCode: 'set-high',
            setName: 'High',
            ownedNumbered: 2,
            totalNumbered: 2,
            setPct: 100,
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-row-en-set-high')).not.toBeNull(),
    );
    const list = result.getByTestId('collection-list');
    const rows = Array.from(list.querySelectorAll('[data-testid^="collection-list-item-"]'));
    expect(rows[0]?.textContent).toContain('High');
    expect(rows[1]?.textContent).toContain('Low');
  });

  it('renders real Master % per row (no "Open set to compute" parked fallback)', async () => {
    const client = buildClient();
    const set = makeSet({ id: 'set-a', canonicalKey: 'en-set-a', total: 4 });
    client.cards.listSets.mockResolvedValue(listSetsPage([set]));
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 2,
            totalNumbered: 4,
            setPct: 50,
            masterPct: 40,
            ownedMaster: 2,
            totalMaster: 5,
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-row-en-set-a-master-progress')).not.toBeNull(),
    );
    const masterRow = result.getByTestId('collection-set-row-en-set-a-master-progress');
    expect(masterRow.textContent).toContain('40%');
    expect(masterRow.textContent).toContain('2/5');
    expect(masterRow.textContent).not.toContain('Open set to compute');
  });

  it('shows an empty-collection state with a Browse CTA when nothing is owned', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([makeSet({ id: 'set-a' })]));
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({ perSet: [], lastUpdatedAt: null }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-empty')).not.toBeNull());
    expect(result.container.textContent).toContain('Your collection is empty');
  });

  it('navigates to /(tabs)/browse when the Browse CTA is tapped', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([makeSet({ id: 'set-a' })]));
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({ perSet: [], lastUpdatedAt: null }),
    );
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
    client.collection.getCompletion.mockReturnValue(new Promise(() => undefined));
    const result = renderScreen({ client, session: SIGNED_IN });
    expect(result.getByTestId('collection-loading')).toBeDefined();
  });

  it('shows an error state when the completion query rejects', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([makeSet({ id: 'set-a' })]));
    client.collection.getCompletion.mockRejectedValue(new Error('Network down'));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Network down');
  });

  it('shows an error state when the sets query rejects', async () => {
    const client = buildClient();
    client.cards.listSets.mockRejectedValue(new Error('Catalog unreachable'));
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({ perSet: [], lastUpdatedAt: null }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Catalog unreachable');
  });

  it('triggers a refetch of the completion endpoint when pull-to-refresh fires', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(
      listSetsPage([makeSet({ id: 'set-a', total: 1 })]),
    );
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 1,
            totalNumbered: 1,
            setPct: 100,
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() => expect(result.queryByTestId('collection-refresh')).not.toBeNull());
    expect(client.collection.getCompletion).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(result.getByTestId('collection-refresh'));
    });
    await waitFor(() =>
      expect(client.collection.getCompletion).toHaveBeenCalledTimes(2),
    );
  });

  it('navigates to the per-set drill-down when a row is tapped', async () => {
    const client = buildClient();
    const set = makeSet({ id: 'set-a', canonicalKey: 'en-set-a', total: 1 });
    client.cards.listSets.mockResolvedValue(listSetsPage([set]));
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 1,
            totalNumbered: 1,
            setPct: 100,
          }),
        ],
      }),
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

  it('renders a per-set Set % bar reflecting the server-supplied tallies', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(
      listSetsPage([makeSet({ id: 'set-a', canonicalKey: 'en-set-a', total: 4 })]),
    );
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 2,
            totalNumbered: 4,
            setPct: 50,
          }),
        ],
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

  it('drops perSet rows whose setId is missing from the catalog (defensive join)', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(
      listSetsPage([
        makeSet({ id: 'set-a', canonicalKey: 'en-set-a', name: 'Alpha', total: 4 }),
      ]),
    );
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 1,
            totalNumbered: 4,
          }),
          // setId is not in the catalog response → must be dropped.
          makePerSetEntry({
            setId: 'set-ghost',
            setCode: 'set-ghost',
            setName: 'Ghost',
            ownedNumbered: 1,
            totalNumbered: 4,
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-row-en-set-a')).not.toBeNull(),
    );
    const list = result.getByTestId('collection-list');
    const rows = Array.from(list.querySelectorAll('[data-testid^="collection-list-item-"]'));
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('Alpha');
    expect(rows[0]?.textContent).not.toContain('Ghost');
  });

  it('does not call the legacy per-printing fanout (`getPrinting`) — completion comes from the V2 endpoint', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(
      listSetsPage([makeSet({ id: 'set-a', canonicalKey: 'en-set-a', total: 4 })]),
    );
    client.collection.getCompletion.mockResolvedValue(
      makeCompletion({
        perSet: [
          makePerSetEntry({
            setId: 'set-a',
            setCode: 'set-a',
            setName: 'Alpha',
            ownedNumbered: 2,
            totalNumbered: 4,
            setPct: 50,
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('collection-set-row-en-set-a')).not.toBeNull(),
    );
    expect(client.cards.getPrinting).not.toHaveBeenCalled();
    expect(client.collection.listCollectionItems).not.toHaveBeenCalled();
  });
});
