import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type { PaginatedResponse, SetDto } from '@binderly/api-contracts';

import { BrowseScreen } from './BrowseScreen';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';


import type { ReactNode } from 'react';

// Stable router mock — follow-up #13 (T-M-AUTH precedent). The
// global setup mock returns a fresh object per call so we need to
// re-mock locally to observe `router.push` / `router.replace` calls.
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

function makeSet(partial: Partial<SetDto> & { id: string }): SetDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-${partial.id}`,
    code: partial.code ?? partial.id,
    language: partial.language ?? 'en',
    name: partial.name ?? `Set ${partial.id}`,
    series: partial.series ?? 'Original',
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

interface FakeClient {
  cards: {
    listSets: ReturnType<typeof vi.fn>;
    getSet: ReturnType<typeof vi.fn>;
    listCardsInSet: ReturnType<typeof vi.fn>;
    getCard: ReturnType<typeof vi.fn>;
    listPrintingsForCard: ReturnType<typeof vi.fn>;
    getPrinting: ReturnType<typeof vi.fn>;
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
  return renderWithProvider(<BrowseScreen />, { wrapper: Wrapper });
}

const SETS: SetDto[] = [
  makeSet({
    id: 'a',
    name: 'Base Set',
    code: 'base1',
    canonicalKey: 'en-base1',
    language: 'en',
    series: 'Original',
    releaseDate: '1999-01-09',
  }),
  makeSet({
    id: 'b',
    name: 'Jungle',
    code: 'base2',
    canonicalKey: 'en-base2',
    language: 'en',
    series: 'Original',
    releaseDate: '1999-06-16',
  }),
  makeSet({
    id: 'c',
    name: 'Brilliant Stars',
    code: 'swsh9',
    canonicalKey: 'en-swsh9',
    language: 'en',
    series: 'Sword & Shield',
    releaseDate: '2022-02-25',
  }),
  makeSet({
    id: 'd',
    name: 'VSTAR Universe',
    code: 's12a',
    canonicalKey: 'jp-s12a',
    language: 'jp',
    series: 'Sword & Shield JP',
    releaseDate: '2022-12-02',
  }),
];

function listSetsPage(items: SetDto[]): PaginatedResponse<SetDto> {
  return { items, nextCursor: null };
}

describe('<BrowseScreen>', () => {
  it('renders the heading, search input, and filter chips after data loads', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('browse-list')).not.toBeNull());
    expect(result.container.textContent).toContain('Browse');
    expect(result.getByTestId('browse-search')).toBeDefined();
    expect(result.getByTestId('browse-language-all')).toBeDefined();
    expect(result.getByTestId('browse-language-en')).toBeDefined();
    expect(result.getByTestId('browse-language-jp')).toBeDefined();
  });

  it('shows the loading skeleton while the sets query is in flight', () => {
    const client = buildClient();
    client.cards.listSets.mockReturnValue(new Promise(() => undefined));
    const result = renderScreen(client);
    expect(result.getByTestId('browse-loading')).toBeDefined();
  });

  it('renders sets ordered by release_date descending', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-row-en-base1')).not.toBeNull());

    const list = result.getByTestId('browse-list');
    const rows = Array.from(list.querySelectorAll('[data-testid^="browse-list-item-"]'));
    // Each row contains the set name; first item should be VSTAR Universe (Dec 2022).
    expect(rows[0]?.textContent).toContain('VSTAR Universe');
    expect(rows[1]?.textContent).toContain('Brilliant Stars');
    expect(rows[2]?.textContent).toContain('Jungle');
    expect(rows[3]?.textContent).toContain('Base Set');
  });

  it('narrows the list to JP when the JP language chip is tapped', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-row-en-base1')).not.toBeNull());
    await act(async () => {
      fireEvent.click(result.getByTestId('browse-language-jp'));
    });
    const list = result.getByTestId('browse-list');
    const rows = Array.from(list.querySelectorAll('[data-testid^="browse-list-item-"]'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('VSTAR Universe');
  });

  it('narrows the list when typing into the search input', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-row-en-base1')).not.toBeNull());

    const input = result.container.querySelector('input[id^="binderly-input-"]');
    if (input === null) throw new Error('search input missing');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'brilliant' } });
    });
    const list = result.getByTestId('browse-list');
    const rows = Array.from(list.querySelectorAll('[data-testid^="browse-list-item-"]'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Brilliant Stars');
  });

  it('shows the empty state when the filter set is non-empty and nothing matches', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-row-en-base1')).not.toBeNull());

    const input = result.container.querySelector('input[id^="binderly-input-"]');
    if (input === null) throw new Error('search input missing');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'nonexistent-set' } });
    });
    expect(result.getByTestId('browse-empty')).toBeDefined();
    expect(result.container.textContent).toContain('No sets match your filters');
  });

  it('refetches the sets query when pull-to-refresh is triggered', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    // Wait for the FlatList (and its refresh-control child) to render.
    await waitFor(() => expect(result.queryByTestId('browse-refresh')).not.toBeNull());
    expect(client.cards.listSets).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(result.getByTestId('browse-refresh'));
    });
    await waitFor(() => expect(client.cards.listSets).toHaveBeenCalledTimes(2));
  });

  it('navigates to /sets/{canonicalKey} when a set row is tapped', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('set-row-en-base1')).not.toBeNull());
    await act(async () => {
      fireEvent.click(result.getByTestId('set-row-en-base1'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/sets/en-base1');
  });

  it('shows the error state when the sets query rejects', async () => {
    const client = buildClient();
    client.cards.listSets.mockRejectedValue(new Error('Network down'));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('browse-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Network down');
  });

  it('exposes the series chips collected from the loaded sets', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('browse-series-chips')).not.toBeNull());
    expect(result.container.textContent).toContain('Original');
    expect(result.container.textContent).toContain('Sword & Shield');
  });

  it('selects a series chip on press and narrows the list', async () => {
    const client = buildClient();
    client.cards.listSets.mockResolvedValue(listSetsPage(SETS));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('browse-series-chips')).not.toBeNull());
    await act(async () => {
      fireEvent.click(result.getByTestId('browse-series-original'));
    });
    const list = result.getByTestId('browse-list');
    const rows = Array.from(list.querySelectorAll('[data-testid^="browse-list-item-"]'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Jungle');
    expect(rows[1]?.textContent).toContain('Base Set');
  });
});
