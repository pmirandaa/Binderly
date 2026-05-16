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
  PaginatedResponse,
  PrintingWithContextDto,
  SmartCollectionRuleDto,
  SubscriptionDto,
} from '@binderly/api-contracts';

import { SmartCollectionDetailScreen } from './SmartCollectionDetailScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

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
  paramsRef.current = { id: 'sm-1' };
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
    name: partial.name ?? 'All Charizards',
    slug: partial.slug ?? 'all-charizards',
    kind: partial.kind ?? 'smart',
    description: partial.description ?? null,
    coverUrl: partial.coverUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeRule(expression: unknown): SmartCollectionRuleDto {
  return {
    customCollectionId: 'sm-1',
    expression,
    lastEvaluatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeSubscription(tier: 'free' | 'pro'): SubscriptionDto {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    tier,
    source: tier === 'pro' ? 'paddle' : null,
    externalCustomerId: null,
    expiresAt: null,
    lastEventAt: null,
  };
}

function makeOwnedItem(partial: { id: string; printingId: string }): CollectionItemDto {
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

function makePrintingContext(partial: {
  id: string;
  cardId: string;
  setId: string;
  cardName?: string;
}): PrintingWithContextDto {
  return {
    id: partial.id,
    variantKey: `en-card-${partial.cardId}-std`,
    cardId: partial.cardId,
    variantClass: 'NON_HOLO',
    variantFlags: [],
    variantCode: 'std',
    includeInMasterSet: true,
    imageSmallUrl: null,
    imageLargeUrl: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    card: {
      id: partial.cardId,
      canonicalKey: `en-card-${partial.cardId}`,
      setId: partial.setId,
      language: 'en',
      number: '1',
      name: partial.cardName ?? `Card ${partial.cardId}`,
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
    set: {
      id: partial.setId,
      canonicalKey: `en-${partial.setId}`,
      code: partial.setId,
      language: 'en',
      name: `Set ${partial.setId}`,
      series: 'Series',
      releaseDate: '2024-01-01',
      printedTotal: 100,
      total: 100,
      logoUrl: null,
      symbolUrl: null,
      masterSetRules: {},
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  };
}

interface FakeClient {
  collection: {
    listCustomCollections: ReturnType<typeof vi.fn>;
    createCustomCollection: ReturnType<typeof vi.fn>;
    deleteCustomCollection: ReturnType<typeof vi.fn>;
    listCustomCollectionItems: ReturnType<typeof vi.fn>;
    addPrintingToCustomCollection: ReturnType<typeof vi.fn>;
    removePrintingFromCustomCollection: ReturnType<typeof vi.fn>;
    getCustomCollection: ReturnType<typeof vi.fn>;
    getSmartCollectionRule: ReturnType<typeof vi.fn>;
    listCollectionItems: ReturnType<typeof vi.fn>;
    updateCustomCollection: ReturnType<typeof vi.fn>;
  };
  cards: { getPrinting: ReturnType<typeof vi.fn> };
  profile: { getMySubscription: ReturnType<typeof vi.fn> };
}

function buildClient(): FakeClient {
  return {
    collection: {
      listCustomCollections: vi.fn(),
      createCustomCollection: vi.fn(),
      deleteCustomCollection: vi.fn(),
      listCustomCollectionItems: vi.fn(),
      addPrintingToCustomCollection: vi.fn(),
      removePrintingFromCustomCollection: vi.fn(),
      getCustomCollection: vi.fn(),
      getSmartCollectionRule: vi.fn(),
      listCollectionItems: vi.fn(),
      updateCustomCollection: vi.fn(),
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
  return renderWithProvider(<SmartCollectionDetailScreen />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

// ============================================================
// Tests
// ============================================================

describe('<SmartCollectionDetailScreen> — auth gate', () => {
  it('shows the sign-in prompt when no session is present', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-sign-in-prompt')).not.toBeNull(),
    );
  });

  it('navigates to /auth/sign-in when the sign-in CTA is tapped', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-sign-in-button')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-collection-detail-sign-in-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('<SmartCollectionDetailScreen> — basic states', () => {
  it('renders not-found when id is missing', async () => {
    paramsRef.current = {};
    const client = buildClient();
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-not-found')).not.toBeNull(),
    );
  });

  it('renders not-found when the api 404s', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.getCustomCollection.mockRejectedValue(
      new ApiNotFoundError('Not Found'),
    );
    client.collection.getSmartCollectionRule.mockResolvedValue(
      makeRule({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-not-found')).not.toBeNull(),
    );
  });
});

describe('<SmartCollectionDetailScreen> — plan gate', () => {
  it('renders the upgrade banner for free users (defensive)', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'sm-1' }),
    );
    client.collection.getSmartCollectionRule.mockResolvedValue(
      makeRule({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-plan-gate')).not.toBeNull(),
    );
    expect(result.queryByTestId('smart-collection-detail-upgrade-banner')).not.toBeNull();
    // Members + match grid should NOT be rendered for free users.
    expect(result.queryByTestId('smart-collection-detail-members')).toBeNull();
  });
});

describe('<SmartCollectionDetailScreen> — paid + matches', () => {
  it('renders the header + match count + match grid', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'sm-1', name: 'All Charizards' }),
    );
    client.collection.getSmartCollectionRule.mockResolvedValue(
      makeRule({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([
        makeOwnedItem({ id: 'i1', printingId: 'p1' }),
        makeOwnedItem({ id: 'i2', printingId: 'p2' }),
      ]),
    );
    client.cards.getPrinting.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'p1')
        return makePrintingContext({
          id: 'p1',
          cardId: 'c1',
          setId: 'set-a',
          cardName: 'Charizard',
        });
      return makePrintingContext({
        id: 'p2',
        cardId: 'c2',
        setId: 'set-a',
        cardName: 'Bulbasaur',
      });
    });
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-header')).not.toBeNull(),
    );
    expect(result.getByTestId('smart-collection-detail-header').textContent).toContain(
      'All Charizards',
    );
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-member-p1')).not.toBeNull(),
    );
    expect(result.queryByTestId('smart-collection-detail-member-p2')).toBeNull();
    expect(result.getByTestId('smart-collection-detail-match-count').textContent).toContain(
      '1 match',
    );
  });

  it('two-step deletes + replaces back to the smart list', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'sm-1' }),
    );
    client.collection.getSmartCollectionRule.mockResolvedValue(
      makeRule({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    client.collection.deleteCustomCollection.mockResolvedValue(undefined);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-delete')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-collection-detail-delete'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-delete-confirm')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-collection-detail-delete-confirm'));
    });
    await waitFor(() =>
      expect(client.collection.deleteCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sm-1' }),
      ),
    );
    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith('/collections/smart'),
    );
  });

  it('routes Edit to the editor screen', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'sm-1' }),
    );
    client.collection.getSmartCollectionRule.mockResolvedValue(
      makeRule({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-edit')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-collection-detail-edit'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/collections/smart/new');
  });

  it('shows a parse-error notice for an unparseable saved rule', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'sm-1' }),
    );
    client.collection.getSmartCollectionRule.mockResolvedValue(
      makeRule({ type: 'banana' }),
    );
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(
        result.queryByTestId('smart-collection-detail-rule-parse-error'),
      ).not.toBeNull(),
    );
  });

  it('shows the "no matches" empty state for a paid collection that finds nothing', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'sm-1' }),
    );
    client.collection.getSmartCollectionRule.mockResolvedValue(
      makeRule({ type: 'eq', field: 'card.name', value: 'Mewtwo' }),
    );
    client.collection.listCollectionItems.mockResolvedValue(
      listCollectionPage([makeOwnedItem({ id: 'i1', printingId: 'p1' })]),
    );
    client.cards.getPrinting.mockResolvedValue(
      makePrintingContext({
        id: 'p1',
        cardId: 'c1',
        setId: 'set-a',
        cardName: 'Charizard',
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collection-detail-empty')).not.toBeNull(),
    );
  });

  it('surfaces a rule fetch error', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.getCustomCollection.mockResolvedValue(
      makeCollection({ id: 'sm-1' }),
    );
    client.collection.getSmartCollectionRule.mockRejectedValue(new Error('Rule down'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(
        result.queryByTestId('smart-collection-detail-rule-error'),
      ).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('Rule down');
  });
});
