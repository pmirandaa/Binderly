import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CustomCollectionDto,
  SubscriptionDto,
} from '@binderly/api-contracts';

import { SmartCollectionsScreen } from './SmartCollectionsScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

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

function makeCollection(
  partial: Partial<CustomCollectionDto> & { id: string },
): CustomCollectionDto {
  return {
    id: partial.id,
    userId: partial.userId ?? '00000000-0000-4000-8000-000000000001',
    name: partial.name ?? `Smart ${partial.id}`,
    slug: partial.slug ?? `smart-${partial.id}`,
    kind: partial.kind ?? 'smart',
    description: partial.description ?? null,
    coverUrl: partial.coverUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
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
  return renderWithProvider(<SmartCollectionsScreen />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

// ============================================================
// Tests
// ============================================================

describe('<SmartCollectionsScreen> — auth gate', () => {
  it('shows the sign-in prompt when no session is present', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collections-sign-in-prompt')).not.toBeNull(),
    );
    expect(client.collection.listCustomCollections).not.toHaveBeenCalled();
    expect(client.profile.getMySubscription).not.toHaveBeenCalled();
  });

  it('navigates to /auth/sign-in from the CTA', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collections-sign-in-button')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-collections-sign-in-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('<SmartCollectionsScreen> — free tier', () => {
  it('shows the upgrade banner + 0 saved + free plan tag', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 's1', kind: 'smart' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collections-upgrade-banner')).not.toBeNull(),
    );
    expect(result.getByTestId('smart-collections-saved-count').textContent).toContain('Saved: 0');
    expect(result.queryByTestId('smart-collections-plan-tag')).not.toBeNull();
    // The saved-list FlatList isn't rendered for free users; smart
    // rows live behind the paid gate.
    expect(result.queryByTestId('custom-collection-row-s1')).toBeNull();
  });

  it('routes the editor CTA regardless of plan', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCustomCollections.mockResolvedValue([]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collections-editor-cta')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-collections-editor-cta'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/collections/smart/new');
  });
});

describe('<SmartCollectionsScreen> — paid tier', () => {
  it('renders saved smart collections in the list', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 's1', kind: 'smart', name: 'All Charizards' }),
      makeCollection({ id: 's2', kind: 'smart', name: 'Holos' }),
      // Manual collections never appear on this screen.
      makeCollection({ id: 'm1', kind: 'manual' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-row-s1')).not.toBeNull(),
    );
    expect(result.queryByTestId('custom-collection-row-s2')).not.toBeNull();
    expect(result.queryByTestId('custom-collection-row-m1')).toBeNull();
    expect(result.getByTestId('smart-collections-saved-count').textContent).toContain('Saved: 2');
    expect(result.queryByTestId('smart-collections-upgrade-banner')).toBeNull();
  });

  it('navigates to /collections/smart/[id] when a row is tapped', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 's1', kind: 'smart' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-row-s1')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-row-s1'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/collections/smart/s1');
  });

  it('shows the empty state when paid + no smart collections exist', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.listCustomCollections.mockResolvedValue([]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collections-empty-paid')).not.toBeNull(),
    );
  });
});

describe('<SmartCollectionsScreen> — error / loading', () => {
  it('shows the loading state while the list query is in flight', () => {
    const client = buildClient();
    client.profile.getMySubscription.mockReturnValue(new Promise(() => undefined));
    client.collection.listCustomCollections.mockReturnValue(new Promise(() => undefined));
    const result = renderScreen({ client, session: SIGNED_IN });
    expect(result.getByTestId('smart-collections-loading')).toBeDefined();
  });

  it('shows the error state when the list query fails', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCustomCollections.mockRejectedValue(new Error('Boom'));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-collections-error')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('Boom');
  });
});
