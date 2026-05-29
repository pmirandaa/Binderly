// Gate-presence regression tests for the mobile custom-collections create
// gate (T-PB-GATING). The base suite exercises the free path via the real
// `useLimitGate` (entitlement read defaults to free in tests); this file
// mocks the gate so we can assert the Pro-unlimited path (create stays
// enabled past the free cap) and the free-at-cap block independently of
// the RC entitlement read.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type { CustomCollectionDto } from '@binderly/api-contracts';

import { CustomCollectionsScreen } from './CustomCollectionsScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { GateState } from '../../lib/gating/index.js';
import type { ReactNode } from 'react';

const { routerMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
}));

const hoisted = vi.hoisted(() => ({
  gateState: { result: { allowed: true }, isLoading: false } as GateState,
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

vi.mock('../../lib/gating/index.js', () => ({
  useLimitGate: () => hoisted.gateState,
}));


function makeCollection(
  partial: Partial<CustomCollectionDto> & { id: string },
): CustomCollectionDto {
  return {
    id: partial.id,
    userId: partial.userId ?? '00000000-0000-4000-8000-000000000001',
    name: partial.name ?? `Collection ${partial.id}`,
    slug: partial.slug ?? `collection-${partial.id}`,
    kind: partial.kind ?? 'manual',
    description: partial.description ?? null,
    coverUrl: partial.coverUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function buildClient() {
  return {
    collection: {
      listCustomCollections: vi.fn(),
      createCustomCollection: vi.fn(),
      updateCustomCollection: vi.fn(),
      deleteCustomCollection: vi.fn(),
      listCustomCollectionItems: vi.fn(),
      addPrintingToCustomCollection: vi.fn(),
      removePrintingFromCustomCollection: vi.fn(),
      getCustomCollection: vi.fn(),
      getSmartCollectionRule: vi.fn(),
      listCollectionItems: vi.fn(),
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

function buildSupabase(initialSession: FakeSession) {
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

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

function renderScreen(client: ReturnType<typeof buildClient>) {
  const supabase = buildSupabase(SIGNED_IN);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider supabase={supabase}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client as unknown as BinderlyClient}>
          {children}
        </ApiClientProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
  return renderWithProvider(<CustomCollectionsScreen />, { wrapper: Wrapper });
}

describe('<CustomCollectionsScreen> — entitlement-aware create gate', () => {
  it('pro user past the free cap keeps the create CTA enabled (no upsell hint)', async () => {
    hoisted.gateState = { result: { allowed: true }, isLoading: false };
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 'c1', kind: 'manual' }),
      makeCollection({ id: 'c2', kind: 'manual' }),
      makeCollection({ id: 'c3', kind: 'manual' }),
      makeCollection({ id: 'c4', kind: 'manual' }),
    ]);
    const result = renderScreen(client);
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create')).not.toBeNull(),
    );
    const cta = result.getByTestId('custom-collections-create');
    expect(cta.getAttribute('aria-disabled')).not.toBe('true');
    expect(cta.textContent).toContain('New custom collection');
    expect(result.queryByTestId('custom-collections-cap-hint')).toBeNull();
  });

  it('free user at the cap is blocked (CTA disabled + upsell hint)', async () => {
    hoisted.gateState = {
      result: {
        allowed: false,
        reason: 'free_limit_reached',
        feature: 'unlimited_custom_collections',
        limit: 3,
      },
      isLoading: false,
    };
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 'c1', kind: 'manual' }),
      makeCollection({ id: 'c2', kind: 'manual' }),
      makeCollection({ id: 'c3', kind: 'manual' }),
    ]);
    const result = renderScreen(client);
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create')).not.toBeNull(),
    );
    const cta = result.getByTestId('custom-collections-create');
    expect(cta.getAttribute('aria-disabled')).toBe('true');
    expect(result.queryByTestId('custom-collections-cap-hint')).not.toBeNull();
  });
});
