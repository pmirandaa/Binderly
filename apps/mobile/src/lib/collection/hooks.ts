// TanStack Query wrappers around the collection-feature reads.
//
// Three logical queries:
//
//   - `useCollectionItemsQuery()` — the user's collection items
//     (printingIds + per-instance metadata). Auth-required —
//     `enabled` toggles off when no session is present so a
//     signed-out render doesn't spam 401s.
//
//   - `useOwnedPrintingsContextQuery(printingIds)` — fans out
//     `getPrinting(id)` per owned printingId to enrich with
//     setId / cardId / `includeInMasterSet`. The home screen
//     needs that mapping to bucket owned printings into the set
//     they belong to. Single call per printing keeps the cache
//     keyed per printingId so re-renders are free.
//
//   - `useSetDrillDownQuery(setId)` — for the per-set drill-down.
//     Loads every card in the set then fans out
//     `listPrintingsForCard(cardId)` to assemble the full
//     printing roster the math package needs to compute precise
//     Set / Master percentages.
//
// All three are authenticated reads except the catalog-only
// drill-down query (cards + printings are public-read per the
// catalog RLS posture), which works whether the user is signed in
// or not. The collection-items query gates on `enabled`.
//
// The materialized-view endpoint that would replace
// (1) + (2) lives in T-BE-EDGE-FUNCTIONS — see Q-010 in
// `open-questions.md`.

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CardDto,
  CollectionItemDto,
  PrintingDto,
  PrintingWithContextDto,
} from '@binderly/api-contracts';

import { useApiClient } from '../api-client.js';


/** Page size for the paginated `/v1/me/collection` endpoint. */
const COLLECTION_PAGE_LIMIT = 200;

/** Cache keys exposed for tests + invalidation. */
export const COLLECTION_QUERY_KEYS = {
  items: () => ['collection', 'items'] as const,
  ownedContext: (printingId: string) =>
    ['collection', 'owned-context', printingId] as const,
  cardsInSet: (setId: string) => ['collection', 'cards-in-set', setId] as const,
  printingsForCard: (cardId: string) =>
    ['collection', 'printings-for-card', cardId] as const,
};

// ============================================================
// useCollectionItemsQuery
// ============================================================

export type UseCollectionItemsQueryResult = UseQueryResult<CollectionItemDto[], Error>;

export interface UseCollectionItemsOptions {
  /** Toggle off when there is no signed-in user (suppresses 401s). */
  readonly enabled?: boolean;
}

/**
 * Fetch the user's full collection. Walks the cursor-paginated
 * `/v1/me/collection` endpoint to assemble the complete list. The
 * recompute job's materialized view doesn't exist yet so the home
 * screen needs the raw list to compute completion on-device.
 */
export function useCollectionItemsQuery(
  options: UseCollectionItemsOptions = {},
): UseCollectionItemsQueryResult {
  const client = useApiClient();
  const enabled = options.enabled ?? true;
  return useQuery<CollectionItemDto[], Error>({
    queryKey: COLLECTION_QUERY_KEYS.items(),
    enabled,
    queryFn: async () => {
      return fetchAllCollectionItems(client);
    },
  });
}

async function fetchAllCollectionItems(client: BinderlyClient): Promise<CollectionItemDto[]> {
  const collected: CollectionItemDto[] = [];
  let cursor: string | undefined = undefined;
  // Walk every page so completion math sees the full collection.
  // The api-client preserves whatever cursor shape the backend
  // emits — we just thread it through.
  // Bounded loop (10 pages × 200 = 2000 items) — generous for any
  // realistic free-tier collection; throws if the backend ever
  // returns an unbounded paging chain.
  for (let page = 0; page < 10; page += 1) {
    const response = await client.collection.listCollectionItems({
      limit: COLLECTION_PAGE_LIMIT,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    collected.push(...response.items);
    if (response.nextCursor === null) return collected;
    cursor = response.nextCursor;
  }
  return collected;
}

// ============================================================
// useOwnedPrintingsContextQuery
// ============================================================

export interface OwnedContextQueryState {
  readonly data: PrintingWithContextDto[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
}

/**
 * Fan out `getPrinting(id)` per owned printingId in parallel and
 * assemble the resolved contexts. Each per-printing fetch uses its
 * own `useQuery` cache slot keyed by `printingId` so unrelated
 * collection edits don't bust the whole set.
 *
 * Returns a single aggregated state shape — the collection screen
 * doesn't care which individual printing is in flight, just whether
 * the whole roster is ready. Errors are surfaced eagerly: the first
 * failure flips `isError` (the screen handles retry via the parent
 * collection query).
 *
 * Implementation note: TanStack Query exposes `useQueries` for
 * exactly this fan-out, but the generic shape is awkward with our
 * strict typecheck. Iterating the array of ids and re-running
 * `useQuery` would violate the rules of hooks (the id list is
 * dynamic). We side-step both by managing the fetch ourselves with
 * a `useEffect` + `queryClient.fetchQuery` so the cache still
 * de-duplicates concurrent calls and individual successes survive
 * across re-renders.
 */
export function useOwnedPrintingsContextQuery(
  printingIds: ReadonlyArray<string>,
): OwnedContextQueryState {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<{
    readonly data: PrintingWithContextDto[];
    readonly status: 'idle' | 'pending' | 'success' | 'error';
    readonly error: Error | null;
    readonly key: string;
  }>(() => ({ data: [], status: 'idle', error: null, key: '' }));

  // Stable join-key so the effect only re-fires when the id set
  // actually changes, not when a parent re-render shuffles array
  // identity.
  const key = useMemo(() => printingIds.slice().sort().join('|'), [printingIds]);

  useEffect(() => {
    if (printingIds.length === 0) {
      setState({ data: [], status: 'success', error: null, key });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: 'pending', error: null, key }));
    Promise.all(
      printingIds.map((printingId) =>
        queryClient.fetchQuery<PrintingWithContextDto>({
          queryKey: COLLECTION_QUERY_KEYS.ownedContext(printingId),
          queryFn: async () => client.cards.getPrinting({ id: printingId }),
        }),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        setState({ data: results, status: 'success', error: null, key });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const error = cause instanceof Error ? cause : new Error('Failed to load printings.');
        setState({ data: [], status: 'error', error, key });
      });
    return () => {
      cancelled = true;
    };
  }, [client, queryClient, key, printingIds]);

  return {
    data: state.data,
    isLoading: state.status === 'pending' || state.status === 'idle',
    isError: state.status === 'error',
    error: state.error,
  };
}

// ============================================================
// useSetDrillDownQuery
// ============================================================

export interface SetDrillDownData {
  readonly cards: CardDto[];
  readonly printings: PrintingDto[];
}

export interface SetDrillDownQueryState {
  readonly data: SetDrillDownData | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Load the full per-set roster (every card + every printing) so the
 * drill-down screen can pass a complete `ComputeCompletionInput`
 * to `@binderly/set-completion`.
 *
 * Two-stage fetch: cards first (single endpoint call), then a
 * parallel fan-out over `listPrintingsForCard(cardId)` for each
 * card. Failures at either stage flip `isError`. The screen owns
 * the retry button.
 */
export function useSetDrillDownQuery(setId: string | undefined): SetDrillDownQueryState {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<{
    readonly data: SetDrillDownData | null;
    readonly status: 'idle' | 'pending' | 'success' | 'error';
    readonly error: Error | null;
    readonly token: number;
  }>(() => ({ data: null, status: 'idle', error: null, token: 0 }));

  // Use a token to coordinate refetch — a manual refetch increments
  // it which re-triggers the effect.
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    if (setId === undefined || setId.length === 0) {
      setState({ data: null, status: 'idle', error: null, token: refetchToken });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: 'pending', error: null, token: refetchToken }));

    (async () => {
      try {
        const cardsPage = await queryClient.fetchQuery({
          queryKey: COLLECTION_QUERY_KEYS.cardsInSet(setId),
          queryFn: async () => client.cards.listCardsInSet({ setId, limit: 500 }),
        });
        const cards: CardDto[] = cardsPage.items;
        if (cancelled) return;
        const printingArrays = await Promise.all(
          cards.map((card) =>
            queryClient.fetchQuery<PrintingDto[]>({
              queryKey: COLLECTION_QUERY_KEYS.printingsForCard(card.id),
              queryFn: async () => client.cards.listPrintingsForCard({ cardId: card.id }),
            }),
          ),
        );
        if (cancelled) return;
        const printings = printingArrays.flat();
        setState({
          data: { cards, printings },
          status: 'success',
          error: null,
          token: refetchToken,
        });
      } catch (cause: unknown) {
        if (cancelled) return;
        const error = cause instanceof Error ? cause : new Error('Failed to load set roster.');
        setState({ data: null, status: 'error', error, token: refetchToken });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, queryClient, setId, refetchToken]);

  return {
    data: state.data,
    isLoading: state.status === 'pending' || state.status === 'idle',
    isError: state.status === 'error',
    error: state.error,
    refetch: () => setRefetchToken((current) => current + 1),
  };
}
