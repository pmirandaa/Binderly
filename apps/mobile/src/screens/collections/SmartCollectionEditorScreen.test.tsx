import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CollectionItemDto,
  CustomCollectionDto,
  PaginatedResponse,
  SmartPreviewItemDto,
  SmartPreviewResponseDto,
  SubscriptionDto,
} from '@binderly/api-contracts';

import { SmartCollectionEditorScreen } from './SmartCollectionEditorScreen';
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

// ============================================================
// Fixtures
// ============================================================

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

function listCollectionPage(
  items: CollectionItemDto[],
): PaginatedResponse<CollectionItemDto> {
  return { items, nextCursor: null };
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
  smartCollections: { preview: ReturnType<typeof vi.fn> };
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
    smartCollections: { preview: vi.fn() },
  };
}

function makePreviewItem(
  partial: Partial<SmartPreviewItemDto> & {
    printingId: string;
    cardId: string;
    setId: string;
  },
): SmartPreviewItemDto {
  return {
    printingId: partial.printingId,
    cardId: partial.cardId,
    setId: partial.setId,
    cardName: partial.cardName ?? `Card ${partial.cardId}`,
    cardNumber: partial.cardNumber ?? '1',
    setName: partial.setName ?? `Set ${partial.setId}`,
    setCode: partial.setCode ?? partial.setId,
    variantLabel: partial.variantLabel ?? '',
    imageSmallUrl: partial.imageSmallUrl ?? null,
  };
}

function makePreviewResponse(
  partial: Partial<SmartPreviewResponseDto> & { items: SmartPreviewItemDto[] },
): SmartPreviewResponseDto {
  return {
    items: partial.items,
    totalCount: partial.totalCount ?? partial.items.length,
    nextOffset: partial.nextOffset !== undefined ? partial.nextOffset : null,
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
  return renderWithProvider(<SmartCollectionEditorScreen />, { wrapper: Wrapper });
}

const SIGNED_IN: FakeSession = {
  access_token: 'jwt',
  refresh_token: 'r',
  user: { id: 'user-1' },
};

function makeCollection(id: string): CustomCollectionDto {
  return {
    id,
    userId: '00000000-0000-4000-8000-000000000001',
    name: 'My Smart',
    slug: 'my-smart',
    kind: 'smart',
    description: null,
    coverUrl: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function setEditorText(result: ReturnType<typeof renderScreen>, text: string) {
  const input = result.getByTestId('smart-editor-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
}

// ============================================================
// Tests
// ============================================================

describe('<SmartCollectionEditorScreen> — auth gate', () => {
  it('shows the sign-in prompt when no session is present', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-sign-in-prompt')).not.toBeNull(),
    );
  });

  it('navigates to /auth/sign-in from the sign-in CTA', async () => {
    const client = buildClient();
    const result = renderScreen({ client, session: null });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-sign-in-button')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-sign-in-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/auth/sign-in');
  });
});

describe('<SmartCollectionEditorScreen> — parse status', () => {
  it('renders the empty hint when the input is whitespace', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    expect(result.queryByTestId('smart-editor-status-empty')).not.toBeNull();
  });

  it('renders a JSON-error hint for malformed JSON', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{ not json');
    });
    expect(result.queryByTestId('smart-editor-status-json-error')).not.toBeNull();
  });

  it('renders a DSL-error hint for valid JSON that fails the schema', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"banana"}');
    });
    expect(result.queryByTestId('smart-editor-status-dsl-error')).not.toBeNull();
  });

  it('renders an explanation when the DSL parses', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Charizard"}');
    });
    expect(result.queryByTestId('smart-editor-status-ok')).not.toBeNull();
    expect(result.getByTestId('smart-editor-status-ok').textContent).toContain('card name');
    expect(result.getByTestId('smart-editor-status-ok').textContent).toContain('Charizard');
  });
});

describe('<SmartCollectionEditorScreen> — Run', () => {
  it('disables Run while the parse is invalid', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-run')).not.toBeNull(),
    );
    expect(result.getByTestId('smart-editor-run').getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      setEditorText(result, '{"type":"banana"}');
    });
    expect(result.getByTestId('smart-editor-run').getAttribute('aria-disabled')).toBe('true');
  });

  it('runs the rule via the V2 server preview + renders the match grid', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.smartCollections.preview.mockResolvedValue(
      makePreviewResponse({
        items: [
          makePreviewItem({
            printingId: 'p1',
            cardId: 'c1',
            setId: 'set-a',
            cardName: 'Charizard',
            cardNumber: '4',
            setName: 'Base Set',
          }),
        ],
        totalCount: 1,
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Charizard"}');
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-run'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-match-count')).not.toBeNull(),
    );
    expect(client.smartCollections.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        expression: { type: 'eq', field: 'card.name', value: 'Charizard' },
      }),
    );
    expect(result.getByTestId('smart-editor-match-count').textContent).toContain('1 match');
    expect(result.queryByTestId('smart-editor-match-p1')).not.toBeNull();
  });

  it('renders catalog-wide matches the user does not own (closes #FU-22)', async () => {
    // The owned-only quirk goes away once Run uses the server
    // preview — the editor must render results regardless of
    // whether the user holds the printing. No "Owned" / "Not
    // owned" chip on the tiles either; the wire shape doesn't
    // carry it.
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.smartCollections.preview.mockResolvedValue(
      makePreviewResponse({
        items: [
          makePreviewItem({
            printingId: 'p-unknown',
            cardId: 'c-unknown',
            setId: 'set-z',
            cardName: 'Charizard',
            setName: 'Some Set',
          }),
        ],
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Charizard"}');
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-run'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-match-p-unknown')).not.toBeNull(),
    );
    const tile = result.getByTestId('smart-editor-match-p-unknown');
    expect(tile.textContent).not.toContain('Owned');
    expect(tile.textContent).not.toContain('Not owned');
  });

  it('renders the "showing M of N" caption when the server reports more matches than fit on a page', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.smartCollections.preview.mockResolvedValue(
      makePreviewResponse({
        items: [
          makePreviewItem({ printingId: 'p1', cardId: 'c1', setId: 'set-a' }),
          makePreviewItem({ printingId: 'p2', cardId: 'c2', setId: 'set-a' }),
        ],
        totalCount: 425,
        nextOffset: 200,
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Charizard"}');
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-run'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-match-count')).not.toBeNull(),
    );
    expect(result.getByTestId('smart-editor-match-count').textContent).toContain(
      'Showing 2 of 425',
    );
  });

  it('surfaces a server-side error via the run-error band', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.smartCollections.preview.mockRejectedValue(
      new Error('preview unsupported for user-state predicates'),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"collection.isOwned","value":true}');
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-run'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-run-error')).not.toBeNull(),
    );
    expect(result.getByTestId('smart-editor-run-error').textContent).toContain(
      'preview unsupported',
    );
    expect(result.queryByTestId('smart-editor-matches')).toBeNull();
  });

  it('renders the empty-matches state when the server returns zero items', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.smartCollections.preview.mockResolvedValue(
      makePreviewResponse({ items: [], totalCount: 0 }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Nope"}');
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-run'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-no-matches')).not.toBeNull(),
    );
  });

  it('does not call the legacy owned-printings fanout (getPrinting / listCollectionItems) on Run', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.smartCollections.preview.mockResolvedValue(
      makePreviewResponse({ items: [], totalCount: 0 }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Anything"}');
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-run'));
    });
    await waitFor(() => {
      expect(client.smartCollections.preview).toHaveBeenCalled();
    });
    expect(client.cards.getPrinting).not.toHaveBeenCalled();
    expect(client.collection.listCollectionItems).not.toHaveBeenCalled();
  });

  it('disables Run while the preview request is in flight', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    let resolvePreview: ((value: SmartPreviewResponseDto) => void) | undefined;
    client.smartCollections.preview.mockReturnValue(
      new Promise<SmartPreviewResponseDto>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-input')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Charizard"}');
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-run'));
    });
    await waitFor(() =>
      expect(result.getByTestId('smart-editor-run').getAttribute('aria-disabled')).toBe('true'),
    );
    expect(result.getByTestId('smart-editor-run').getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      resolvePreview?.(makePreviewResponse({ items: [], totalCount: 0 }));
    });
    await waitFor(() =>
      expect(result.getByTestId('smart-editor-run').getAttribute('aria-busy')).not.toBe('true'),
    );
  });
});

describe('<SmartCollectionEditorScreen> — Save gating', () => {
  it('disables Save + shows hint + upgrade banner for free users', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-save')).not.toBeNull(),
    );
    expect(result.getByTestId('smart-editor-save').getAttribute('aria-disabled')).toBe('true');
    expect(result.getByTestId('smart-editor-save').textContent).toContain('Pro only');
    expect(result.queryByTestId('smart-editor-save-hint')).not.toBeNull();
    expect(result.queryByTestId('smart-editor-upgrade-banner')).not.toBeNull();
  });

  it('keeps Save disabled for paid users until the parse succeeds', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-save')).not.toBeNull(),
    );
    // Subscription resolves resolves async — wait for the
    // banner / hint to disappear (paid users shouldn't see them).
    await waitFor(() => {
      expect(result.queryByTestId('smart-editor-save-hint')).toBeNull();
    });
    expect(result.getByTestId('smart-editor-save').getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Charizard"}');
    });
    expect(result.getByTestId('smart-editor-save').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('opens the save modal, submits, and replaces to the new smart-detail route', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('pro'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    client.collection.createCustomCollection.mockResolvedValue(makeCollection('s-new'));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-save')).not.toBeNull(),
    );
    await act(async () => {
      setEditorText(result, '{"type":"eq","field":"card.name","value":"Charizard"}');
    });
    await waitFor(() => {
      expect(result.getByTestId('smart-editor-save').getAttribute('aria-disabled')).not.toBe(
        'true',
      );
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-save'));
    });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-save-modal')).not.toBeNull(),
    );
    const nameInput = result.getByTestId('smart-editor-save-name') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'All Charizards' } });
    });
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-save-submit'));
    });
    await waitFor(() =>
      expect(client.collection.createCustomCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'smart',
          name: 'All Charizards',
          slug: 'all-charizards',
          expression: { type: 'eq', field: 'card.name', value: 'Charizard' },
        }),
      ),
    );
    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith('/collections/smart/s-new'),
    );
  });

  it('routes Cancel back to the previous screen', async () => {
    const client = buildClient();
    client.profile.getMySubscription.mockResolvedValue(makeSubscription('free'));
    client.collection.listCollectionItems.mockResolvedValue(listCollectionPage([]));
    const result = renderScreen({ client, session: SIGNED_IN });
    await waitFor(() =>
      expect(result.queryByTestId('smart-editor-cancel')).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('smart-editor-cancel'));
    });
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
  });
});
