import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type { CardWithPrintingsDto, PrintingDto } from '@binderly/api-contracts';

import { CardScreen } from './CardScreen';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

// `<CardScreen>` now embeds `<BuyCta>` which imports
// `expo-web-browser`. The shell's global test setup does not stub
// that module (it's only used by auth + the new buy-cta), so we
// inline a minimal mock here — same pattern used by
// `SignInScreen.test.tsx` and friends.
vi.mock('expo-web-browser', () => ({
  openBrowserAsync: vi.fn(async () => ({ type: 'opened' })),
  openAuthSessionAsync: vi.fn(async () => ({ type: 'cancel' })),
}));

// `useLocalSearchParams()` returns whatever the holder is currently
// pointing at. The router isn't used by CardScreen (back is owned
// by the expo-router shell) but we keep the same posture as the
// SetScreen tests for consistency.
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

function makePrinting(partial: Partial<PrintingDto> & { id: string; cardId: string }): PrintingDto {
  return {
    id: partial.id,
    variantKey: partial.variantKey ?? `${partial.cardId}-${partial.id}`,
    cardId: partial.cardId,
    variantClass: partial.variantClass ?? 'NON_HOLO',
    variantFlags: partial.variantFlags ?? [],
    variantCode: partial.variantCode ?? 'non_holo',
    includeInMasterSet: partial.includeInMasterSet ?? true,
    imageSmallUrl: partial.imageSmallUrl ?? null,
    imageLargeUrl: partial.imageLargeUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeCardWithPrintings(
  partial: Partial<CardWithPrintingsDto> & { id: string; setId: string },
): CardWithPrintingsDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-base-${partial.id}`,
    setId: partial.setId,
    language: partial.language ?? 'en',
    number: partial.number ?? '4',
    name: partial.name ?? 'Charizard',
    nameLocalized: partial.nameLocalized ?? null,
    type: partial.type ?? 'FIRE',
    subtype: partial.subtype ?? 'POKEMON',
    hp: partial.hp ?? 120,
    illustrator: partial.illustrator ?? 'Mitsuhiro Arita',
    flavorText: partial.flavorText ?? null,
    attacks: partial.attacks ?? null,
    weakness: partial.weakness ?? null,
    resistance: partial.resistance ?? null,
    retreatCost: partial.retreatCost ?? null,
    rarity: partial.rarity ?? 'HOLO_RARE',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    printings: partial.printings ?? [],
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
  return renderWithProvider(<CardScreen />, { wrapper: Wrapper });
}

describe('<CardScreen>', () => {
  it('renders the not-found surface when no id is provided', () => {
    paramsHolder.current = {};
    const client = buildClient();
    const result = renderScreen(client);
    expect(result.getByTestId('card-not-found')).toBeDefined();
    expect(result.container.textContent).toContain('Card not found');
    expect(client.cards.getCard).not.toHaveBeenCalled();
  });

  it('renders the not-found surface when the api-client throws ApiNotFoundError', async () => {
    paramsHolder.current = { id: 'card-x' };
    const client = buildClient();
    client.cards.getCard.mockRejectedValue(new ApiNotFoundError('No such card', { status: 404 }));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-not-found')).not.toBeNull());
    expect(result.container.textContent).toContain('card-x');
  });

  it('renders the generic error state when the api-client throws a non-404 error', async () => {
    paramsHolder.current = { id: 'card-x' };
    const client = buildClient();
    client.cards.getCard.mockRejectedValue(new Error('Card service down'));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-error')).not.toBeNull());
    expect(result.container.textContent).toContain('Card service down');
  });

  it('renders the card detail page with name, metadata, and prices placeholder', async () => {
    paramsHolder.current = { id: 'card-1' };
    const client = buildClient();
    client.cards.getCard.mockResolvedValue(
      makeCardWithPrintings({
        id: 'card-1',
        setId: 'set-1',
        name: 'Charizard',
        number: '4',
        rarity: 'HOLO_RARE',
        illustrator: 'Mitsuhiro Arita',
        hp: 120,
        printings: [
          makePrinting({
            id: 'p1',
            cardId: 'card-1',
            variantClass: 'HOLO',
            imageLargeUrl: 'https://example.com/large.png',
          }),
        ],
      }),
    );
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-screen')).not.toBeNull());
    const title = result.getByTestId('card-title');
    expect(title.textContent).toContain('Charizard');
    expect(title.textContent).toContain('#4');
    const meta = result.getByTestId('card-metadata');
    expect(meta.textContent).toContain('Rarity');
    expect(meta.textContent).toContain('HOLO_RARE');
    expect(meta.textContent).toContain('Mitsuhiro Arita');
    expect(meta.textContent).toContain('120');
    expect(result.getByTestId('card-prices').textContent).toContain('Prices');
  });

  it('renders the BuyCta in a "card-buy" section', async () => {
    paramsHolder.current = { id: 'card-1' };
    const client = buildClient();
    client.cards.getCard.mockResolvedValue(
      makeCardWithPrintings({
        id: 'card-1',
        setId: 'set-1',
        name: 'Charizard',
        number: '4',
      }),
    );
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-buy')).not.toBeNull());
    // No EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID in jsdom env → disabled state.
    expect(result.queryByTestId('buy-cta-disabled')).not.toBeNull();
    expect(result.getByTestId('buy-cta-button').textContent).toContain('Buy on TCGplayer');
  });

  it('disables the Add to collection button and surfaces sign-in copy', async () => {
    paramsHolder.current = { id: 'card-1' };
    const client = buildClient();
    client.cards.getCard.mockResolvedValue(makeCardWithPrintings({ id: 'card-1', setId: 'set-1' }));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-screen')).not.toBeNull());
    const button = result.getByTestId('card-add-button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(result.getByTestId('card-add').textContent).toContain('Sign in to track');
  });

  it('renders the variants section listing each printing class', async () => {
    paramsHolder.current = { id: 'card-1' };
    const client = buildClient();
    client.cards.getCard.mockResolvedValue(
      makeCardWithPrintings({
        id: 'card-1',
        setId: 'set-1',
        printings: [
          makePrinting({ id: 'p1', cardId: 'card-1', variantClass: 'HOLO' }),
          makePrinting({ id: 'p2', cardId: 'card-1', variantClass: 'REVERSE_HOLO' }),
        ],
      }),
    );
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-variants')).not.toBeNull());
    const variants = result.getByTestId('card-variants');
    expect(variants.textContent).toContain('Holo');
    expect(variants.textContent).toContain('Reverse Holo');
  });

  it('renders the no-image placeholder when no printing has imagery', async () => {
    paramsHolder.current = { id: 'card-1' };
    const client = buildClient();
    client.cards.getCard.mockResolvedValue(
      makeCardWithPrintings({
        id: 'card-1',
        setId: 'set-1',
        printings: [makePrinting({ id: 'p1', cardId: 'card-1' })],
      }),
    );
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-hero')).not.toBeNull());
    expect(result.getByTestId('card-hero').textContent).toContain('No image available');
  });

  it('shows the loading state while the card query is in flight', () => {
    paramsHolder.current = { id: 'card-1' };
    const client = buildClient();
    client.cards.getCard.mockReturnValue(new Promise(() => undefined));
    const result = renderScreen(client);
    expect(result.getByTestId('card-loading')).toBeDefined();
  });

  it('renders gracefully when the id is provided as an array (deep-link)', async () => {
    paramsHolder.current = { id: ['card-1', 'extra'] };
    const client = buildClient();
    client.cards.getCard.mockResolvedValue(makeCardWithPrintings({ id: 'card-1', setId: 'set-1' }));
    const result = renderScreen(client);
    await waitFor(() => expect(result.queryByTestId('card-screen')).not.toBeNull());
    expect(client.cards.getCard).toHaveBeenCalledWith({ id: 'card-1' });
  });
});
