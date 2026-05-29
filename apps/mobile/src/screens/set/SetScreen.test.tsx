import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type { CardDto, PaginatedResponse, SetDto } from '@binderly/api-contracts';

import { SetScreen } from './SetScreen';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';


import type { ReactNode } from 'react';

// Stable router + search-params mocks. The global setup mock
// returns `useLocalSearchParams() === {}`, which means the screen
// would always hit the not-found branch — re-mock locally to seed
// the slug per test.
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

function makeSet(partial: Partial<SetDto> & { id: string }): SetDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-${partial.id}`,
    code: partial.code ?? partial.id,
    language: partial.language ?? 'en',
    name: partial.name ?? `Set ${partial.id}`,
    series: partial.series ?? 'Series',
    releaseDate: partial.releaseDate ?? '2024-01-01',
    printedTotal: partial.printedTotal ?? 100,
    total: partial.total ?? 110,
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
    canonicalKey: partial.canonicalKey ?? `en-base-${partial.id}`,
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
  };
}

function renderScreen(client: FakeClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client as unknown as BinderlyClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return renderWithProvider(<SetScreen />, { wrapper: Wrapper });
}

const SET: SetDto = makeSet({
  id: 'set-1',
  canonicalKey: 'en-base1',
  name: 'Base Set',
  releaseDate: '1999-01-09',
  language: 'en',
  total: 102,
});

function listSetsPage(items: SetDto[]): PaginatedResponse<SetDto> {
  return { items, nextCursor: null };
}

function listCardsPage(items: CardDto[]): PaginatedResponse<CardDto> {
  return { items, nextCursor: null };
}

describe('<SetScreen>', () => {
  it('renders the not-found surface when no slug is provided', () => {
    paramsHolder.current = {};
    const client = buildClient();
    const result = renderScreen(client);
    expect(result.getByTestId('set-not-found')).toBeDefined();
    expect(result.container.textContent).toContain('Set not found');
    expect(client.cards.listSets).not.toHaveBeenCalled();
  });

  it('renders the not-found surface when the slug does not match any known set', async () => {
    paramsHolder.current = { slug: 'en-unknown' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-not-found')).not.toBeNull());
    expect(result.container.textContent).toContain('en-unknown');
  });

  it('renders the header with formatted release date + card count + language', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.cards.listCardsInSet.mockResolvedValue(listCardsPage([]));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-header')).not.toBeNull());
    const header = result.getByTestId('set-header');
    expect(header.textContent).toContain('Base Set');
    expect(header.textContent).toContain('Jan 9, 1999');
    expect(header.textContent).toContain('EN');
  });

  it('renders the card grid when cards are available', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.cards.listCardsInSet.mockResolvedValue(
      listCardsPage([
        makeCard({ id: 'c1', setId: 'set-1', number: '1', name: 'Alakazam' }),
        makeCard({ id: 'c2', setId: 'set-1', number: '2', name: 'Blastoise' }),
      ]),
    );
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-cards-list')).not.toBeNull());
    expect(result.queryByTestId('card-tile-c1')).not.toBeNull();
    expect(result.queryByTestId('card-tile-c2')).not.toBeNull();
  });

  it('shows the empty grid state when the set has no cards yet', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.cards.listCardsInSet.mockResolvedValue(listCardsPage([]));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-empty')).not.toBeNull());
    expect(result.container.textContent).toContain('No cards in this set yet');
  });

  it('shows an error state when the cards query rejects', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.cards.listCardsInSet.mockRejectedValue(new Error('Cards down'));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Cards down');
  });

  it('navigates to /cards/{id} when a card tile is tapped', async () => {
    paramsHolder.current = { slug: 'en-base1' };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.cards.listCardsInSet.mockResolvedValue(
      listCardsPage([makeCard({ id: 'card-99', setId: 'set-1', number: '99', name: 'Test' })]),
    );
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-tile-card-99')).not.toBeNull());
    await act(async () => {
      fireEvent.click(result.getByTestId('card-tile-card-99'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/cards/card-99');
  });

  it('accepts a slug delivered as an array (deep-link fallback)', async () => {
    paramsHolder.current = { slug: ['en-base1', 'extra'] };
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage([SET]));
    client.cards.listCardsInSet.mockResolvedValue(listCardsPage([]));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-header')).not.toBeNull());
    expect(result.container.textContent).toContain('Base Set');
  });
});
