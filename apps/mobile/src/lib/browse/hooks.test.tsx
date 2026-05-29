import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type {
  CardDto,
  CardWithPrintingsDto,
  PaginatedResponse,
  PrintingDto,
  SetDto,
} from '@binderly/api-contracts';

import {
  BROWSE_QUERY_KEYS,
  useCardQuery,
  useCardsInSetQuery,
  useSetBySlugQuery,
  useSetsQuery,
} from './hooks';
import { ApiClientProvider } from '../api-client';


import type { ReactNode } from 'react';

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
    masterSetRules: partial.masterSetRules ?? {},
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

function makePrinting(partial: Partial<PrintingDto> & { id: string; cardId: string }): PrintingDto {
  return {
    id: partial.id,
    variantKey: partial.variantKey ?? `${partial.cardId}-${partial.id}`,
    cardId: partial.cardId,
    variantClass: partial.variantClass ?? 'HOLO',
    variantFlags: partial.variantFlags ?? [],
    variantCode: partial.variantCode ?? 'holo',
    includeInMasterSet: partial.includeInMasterSet ?? true,
    imageSmallUrl: partial.imageSmallUrl ?? null,
    imageLargeUrl: partial.imageLargeUrl ?? null,
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
  return {
    cards: {
      listSets: vi.fn(),
      getSet: vi.fn(),
      getSetBySlug: vi.fn(),
      listCardsInSet: vi.fn(),
      getCard: vi.fn(),
      listPrintingsForCard: vi.fn(),
      getPrinting: vi.fn(),
    },
  };
}

function makeWrapper(client: FakeClient): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client as unknown as BinderlyClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

describe('BROWSE_QUERY_KEYS', () => {
  it('returns stable keys for each resource', () => {
    expect(BROWSE_QUERY_KEYS.sets()).toEqual(['browse', 'sets']);
    expect(BROWSE_QUERY_KEYS.setBySlug('en-base1')).toEqual(['browse', 'set-by-slug', 'en-base1']);
    expect(BROWSE_QUERY_KEYS.cardsInSet('set-1')).toEqual(['browse', 'cards-in-set', 'set-1']);
    expect(BROWSE_QUERY_KEYS.card('card-1')).toEqual(['browse', 'card', 'card-1']);
  });
});

describe('useSetsQuery', () => {
  it('fetches sets and sorts them by release_date descending', async () => {
    const client = buildClient();
    const sets: SetDto[] = [
      makeSet({ id: 'a', releaseDate: '2020-01-01' }),
      makeSet({ id: 'b', releaseDate: '2024-09-09' }),
      makeSet({ id: 'c', releaseDate: '2022-06-01' }),
    ];
    client.cards.listSets.mockResolvedValue({ items: sets, nextCursor: null } satisfies PaginatedResponse<SetDto>);
    const { result } = renderHook(() => useSetsQuery(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(result.current.data?.nextCursor).toBeNull();
  });

  it('surfaces errors thrown by the api-client', async () => {
    const client = buildClient();
    client.cards.listSets.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSetsQuery(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});

describe('useSetBySlugQuery', () => {
  it('resolves a set via cards.getSetBySlug', async () => {
    const client = buildClient();
    client.cards.getSetBySlug.mockResolvedValue(makeSet({ id: 'b', canonicalKey: 'en-base2' }));
    const { result } = renderHook(() => useSetBySlugQuery('en-base2'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('b');
    expect(client.cards.getSetBySlug).toHaveBeenCalledWith({ slug: 'en-base2' });
  });

  it('maps an ApiNotFoundError miss to null', async () => {
    const client = buildClient();
    client.cards.getSetBySlug.mockRejectedValue(
      new ApiNotFoundError('no set', { status: 404 }),
    );
    const { result } = renderHook(() => useSetBySlugQuery('en-unknown'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('does not fire the query when the slug is undefined', () => {
    const client = buildClient();
    renderHook(() => useSetBySlugQuery(undefined), { wrapper: makeWrapper(client) });
    expect(client.cards.getSetBySlug).not.toHaveBeenCalled();
  });
});

describe('useCardsInSetQuery', () => {
  it('returns cards sorted by number ascending (natural / numeric order)', async () => {
    const client = buildClient();
    const cards: CardDto[] = [
      makeCard({ id: 'a', setId: 'set-1', number: '10' }),
      makeCard({ id: 'b', setId: 'set-1', number: '2' }),
      makeCard({ id: 'c', setId: 'set-1', number: '1' }),
    ];
    client.cards.listCardsInSet.mockResolvedValue({ items: cards, nextCursor: null });
    const { result } = renderHook(() => useCardsInSetQuery('set-1'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not fire when setId is undefined', () => {
    const client = buildClient();
    renderHook(() => useCardsInSetQuery(undefined), { wrapper: makeWrapper(client) });
    expect(client.cards.listCardsInSet).not.toHaveBeenCalled();
  });
});

describe('useCardQuery', () => {
  it('returns the card with its printings', async () => {
    const client = buildClient();
    const card: CardWithPrintingsDto = {
      ...makeCard({ id: 'card-1', setId: 'set-1' }),
      printings: [makePrinting({ id: 'p1', cardId: 'card-1' })],
    };
    client.cards.getCard.mockResolvedValue(card);
    const { result } = renderHook(() => useCardQuery('card-1'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('card-1');
    expect(result.current.data?.printings).toHaveLength(1);
  });

  it('does not retry on errors so 404s propagate immediately', async () => {
    const client = buildClient();
    client.cards.getCard.mockRejectedValue(new Error('Card not found'));
    const { result } = renderHook(() => useCardQuery('card-x'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.cards.getCard).toHaveBeenCalledTimes(1);
  });

  it('does not fire when id is undefined', () => {
    const client = buildClient();
    renderHook(() => useCardQuery(undefined), { wrapper: makeWrapper(client) });
    expect(client.cards.getCard).not.toHaveBeenCalled();
  });
});
