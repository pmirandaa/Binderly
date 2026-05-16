import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type { CustomCollectionDto } from '@binderly/api-contracts';

import { CustomCollectionsScreen } from './CustomCollectionsScreen';
import { AuthProvider } from '../../components/providers/AuthProvider';
import { ApiClientProvider } from '../../lib/api-client';
import { renderWithProvider } from '../../test-utils/render';

import type { ReactNode } from 'react';

// Stable router mock — follow-up #13.
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

interface FakeClient {
  collection: {
    listCustomCollections: ReturnType<typeof vi.fn>;
    createCustomCollection: ReturnType<typeof vi.fn>;
    updateCustomCollection: ReturnType<typeof vi.fn>;
    deleteCustomCollection: ReturnType<typeof vi.fn>;
    listCustomCollectionItems: ReturnType<typeof vi.fn>;
    addPrintingToCustomCollection: ReturnType<typeof vi.fn>;
    removePrintingFromCustomCollection: ReturnType<typeof vi.fn>;
    getCustomCollection: ReturnType<typeof vi.fn>;
    getSmartCollectionRule: ReturnType<typeof vi.fn>;
    listCollectionItems: ReturnType<typeof vi.fn>;
  };
  cards: { getPrinting: ReturnType<typeof vi.fn> };
  profile: { getMySubscription: ReturnType<typeof vi.fn> };
}

function buildClient(): FakeClient {
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
  return renderWithProvider(<CustomCollectionsScreen />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

// ============================================================
// Tests
// ============================================================

describe('<CustomCollectionsScreen> — auth gate', () => {
  it('shows the sign-in prompt when no session is present', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-sign-in-prompt')).not.toBeNull(),
    );
    expect(client.collection.listCustomCollections).not.toHaveBeenCalled();
  });

  it('navigates to /auth/sign-in when the sign-in CTA is tapped', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-sign-in-button')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-sign-in-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('<CustomCollectionsScreen> — signed in', () => {
  it('renders the usage header with 0 / 3 used when empty', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-usage')).not.toBeNull(),
    );
    expect(result.getByTestId('custom-collections-usage').textContent).toContain('0 / 3 used');
  });

  it('shows the empty state with a Create CTA when no manual collections exist', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-empty')).not.toBeNull(),
    );
    expect(result.getByTestId('custom-collections-empty').textContent).toContain(
      'No custom collections yet',
    );
  });

  it('lists existing manual custom collections', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 'c1', name: 'Charizards', kind: 'manual' }),
      makeCollection({ id: 'c2', name: 'Bulbasaurs', kind: 'manual' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-row-c1')).not.toBeNull(),
    );
    expect(result.queryByTestId('custom-collection-row-c2')).not.toBeNull();
    expect(result.getByTestId('custom-collections-usage').textContent).toContain('2 / 3 used');
  });

  it('hides smart collections from the manual list', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 'c1', kind: 'manual' }),
      makeCollection({ id: 'c2', kind: 'smart' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-row-c1')).not.toBeNull(),
    );
    expect(result.queryByTestId('custom-collection-row-c2')).toBeNull();
    expect(result.getByTestId('custom-collections-usage').textContent).toContain('1 / 3 used');
  });

  it('keeps the create CTA enabled when count < 3', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 'c1', kind: 'manual' }),
      makeCollection({ id: 'c2', kind: 'manual' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create')).not.toBeNull(),
    );
    const cta = result.getByTestId('custom-collections-create');
    expect(cta.getAttribute('aria-disabled')).not.toBe('true');
    expect(cta.textContent).toContain('New custom collection');
    expect(result.queryByTestId('custom-collections-cap-hint')).toBeNull();
  });

  it('disables the create CTA + shows the upsell hint at the 3-cap', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 'c1', kind: 'manual' }),
      makeCollection({ id: 'c2', kind: 'manual' }),
      makeCollection({ id: 'c3', kind: 'manual' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create')).not.toBeNull(),
    );
    const cta = result.getByTestId('custom-collections-create');
    expect(cta.getAttribute('aria-disabled')).toBe('true');
    expect(cta.textContent).toContain('limit reached');
    expect(result.queryByTestId('custom-collections-cap-hint')).not.toBeNull();
    expect(result.getByTestId('custom-collections-cap-hint').textContent).toContain('Pro');
  });

  it('opens the create form when the CTA is tapped', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-empty')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-create'));
    });
    expect(result.queryByTestId('custom-collections-create-form')).not.toBeNull();
  });

  it('submits the create form, then navigates to the new collection', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([]);
    client.collection.createCustomCollection.mockResolvedValue(
      makeCollection({ id: 'new-1', name: 'My Charizards' }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-create'));
    });
    const nameInput = result.getByTestId('custom-collections-create-name') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'My Charizards' } });
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-create-submit'));
    });
    await waitFor(() => {
      expect(client.collection.createCustomCollection).toHaveBeenCalledTimes(1);
    });
    expect(client.collection.createCustomCollection).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual', name: 'My Charizards', slug: 'my-charizards' }),
    );
    await waitFor(() =>
      expect(routerMocks.push).toHaveBeenCalledWith('/collections/custom/new-1'),
    );
  });

  it('shows the validation error when the name is empty', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-create'));
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-create-submit'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create-error')).not.toBeNull(),
    );
    expect(result.getByTestId('custom-collections-create-error').textContent).toContain('required');
    expect(client.collection.createCustomCollection).not.toHaveBeenCalled();
  });

  it('surfaces a server error from the create mutation', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([]);
    client.collection.createCustomCollection.mockRejectedValue(new Error('Slug taken'));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-create'));
    });
    const nameInput = result.getByTestId('custom-collections-create-name') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Charizards' } });
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-create-submit'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-create-error')).not.toBeNull(),
    );
    expect(result.getByTestId('custom-collections-create-error').textContent).toContain(
      'Slug taken',
    );
  });

  it('navigates to the per-collection detail when a row is tapped', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([
      makeCollection({ id: 'c1' }),
    ]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collection-row-c1')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collection-row-c1'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/collections/custom/c1');
  });

  it('navigates to the smart-collections screen when the smart-link CTA is tapped', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockResolvedValue([]);
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-smart-link')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('custom-collections-smart-link'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/collections/smart');
  });

  it('shows the loading state while the list query is in flight', () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockReturnValue(new Promise(() => undefined));
    const result = renderScreen({ client, session: SIGNED_IN });
    expect(result.getByTestId('custom-collections-loading')).toBeDefined();
  });

  it('shows an error state with a Retry button when the list query fails', async () => {
    const client = buildClient();
    client.collection.listCustomCollections.mockRejectedValue(new Error('Network down'));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('custom-collections-error')).not.toBeNull(),
    );
    expect(result.container.textContent).toContain('Network down');
    expect(result.queryByTestId('custom-collections-error-retry')).not.toBeNull();
  });
});
