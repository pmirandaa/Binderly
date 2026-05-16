// TanStack Query wrappers around the catalog reads the browse
// surface needs. Centralising the keys + fetchers here keeps the
// three screens (Browse / Set / Card) trivially mockable in tests
// and gives every consumer the same cache hit when the same data
// is requested from different surfaces.
//
// We expose four hooks:
//
//   - `useSetsQuery()` — first page of `/v1/sets` (all languages).
//     The list is small enough (a few hundred rows) that we don't
//     paginate in MVP; "More results coming soon" is the documented
//     placeholder per the task scope.
//   - `useSetBySlugQuery(slug)` — resolves a `set.canonical_key`
//     slug to a `SetDto` by consulting the same `/v1/sets` cache.
//     Avoids a dedicated endpoint round-trip and keeps the
//     `/sets/[slug]` route human-readable.
//   - `useCardsInSetQuery(setId)` — first page of the per-set card
//     list, sorted by `card.number` ascending (the natural set
//     order).
//   - `useCardQuery(cardId)` — single card detail (with printings
//     inlined per `cardWithPrintingsDto`).
//
// Every hook keys its TanStack Query cache off the resource
// identifier so refetching `useSetsQuery()` invalidates a single
// well-known key.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type {
  CardDto,
  CardWithPrintingsDto,
  PaginatedResponse,
  SetDto,
} from '@binderly/api-contracts';

import { useApiClient } from '../api-client.js';
import { sortByReleaseDateDesc } from './filters.js';


/**
 * Page size we ask the catalog endpoints for. Comfortably larger
 * than the v1 catalog footprint (a few hundred sets, low-hundreds
 * of cards per set) so MVP renders without pagination juggling.
 */
const BROWSE_PAGE_LIMIT = 200;

/**
 * Cache keys for the four browse queries. Exported so tests can
 * pin or invalidate against the exact shape.
 */
export const BROWSE_QUERY_KEYS = {
  sets: () => ['browse', 'sets'] as const,
  setBySlug: (slug: string) => ['browse', 'set-by-slug', slug] as const,
  cardsInSet: (setId: string) => ['browse', 'cards-in-set', setId] as const,
  card: (cardId: string) => ['browse', 'card', cardId] as const,
};

export interface SetsQueryData {
  /** Sorted by `release_date` descending — caller-friendly default. */
  readonly items: SetDto[];
  /** Forwarded from the wire — `null` once we have the last page. */
  readonly nextCursor: string | null;
}

/** Helper — the discriminated `useQuery` result for the sets list. */
export type UseSetsQueryResult = UseQueryResult<SetsQueryData, Error>;

/**
 * First page of the catalog set list, sorted by release_date
 * descending. The BrowseScreen owns the secondary filter step
 * (`filterAndSortSets()` in `filters.ts`).
 */
export function useSetsQuery(): UseSetsQueryResult {
  const client = useApiClient();
  return useQuery<SetsQueryData, Error>({
    queryKey: BROWSE_QUERY_KEYS.sets(),
    queryFn: async () => {
      const page = await client.cards.listSets({ limit: BROWSE_PAGE_LIMIT });
      return toSortedSetsPage(page);
    },
  });
}

/** Helper — the discriminated `useQuery` result for set-by-slug. */
export type UseSetBySlugQueryResult = UseQueryResult<SetDto | null, Error>;

/**
 * Resolve a `set.canonical_key` slug (e.g. `en-base1`) to a
 * `SetDto`. We piggy-back on the same `/v1/sets` page rather than
 * minting a dedicated endpoint — keeps the wire surface small and
 * the data flow obvious. Returns `null` (not `undefined`) for
 * "not in the catalog" so callers can pattern-match.
 */
export function useSetBySlugQuery(slug: string | undefined): UseSetBySlugQueryResult {
  const client = useApiClient();
  return useQuery<SetDto | null, Error>({
    enabled: typeof slug === 'string' && slug.length > 0,
    queryKey: BROWSE_QUERY_KEYS.setBySlug(slug ?? ''),
    queryFn: async () => {
      const page = await client.cards.listSets({ limit: BROWSE_PAGE_LIMIT });
      const match = page.items.find((set) => set.canonicalKey === slug);
      return match ?? null;
    },
  });
}

/**
 * Local alias for the per-set card shape. Same wire shape as
 * `CardDto` — the alias just documents that this hook returns
 * the per-set list with the `card.number` ascending sort applied.
 */
export type CardInSetDto = CardDto;

/** Helper — the discriminated `useQuery` result for per-set cards. */
export type UseCardsInSetQueryResult = UseQueryResult<PaginatedResponse<CardInSetDto>, Error>;

/**
 * First page of the cards in a specific set, sorted by
 * `card.number` ascending (the natural set order — `1`, `2`, `3`,
 * ...). Comparator is collation-aware so promo numbers like
 * `SM01` sort intuitively after numeric cards.
 */
export function useCardsInSetQuery(setId: string | undefined): UseCardsInSetQueryResult {
  const client = useApiClient();
  return useQuery<PaginatedResponse<CardInSetDto>, Error>({
    enabled: typeof setId === 'string' && setId.length > 0,
    queryKey: BROWSE_QUERY_KEYS.cardsInSet(setId ?? ''),
    queryFn: async () => {
      const page = await client.cards.listCardsInSet({
        setId: setId as string,
        limit: BROWSE_PAGE_LIMIT,
      });
      return {
        ...page,
        items: sortCardsByNumber(page.items),
      };
    },
  });
}

/** Helper — the discriminated `useQuery` result for a card. */
export type UseCardQueryResult = UseQueryResult<CardWithPrintingsDto, Error>;

/**
 * Single card detail (with `printings` inlined). The api-client
 * surfaces `ApiNotFoundError` (subclass of `ApiError`) when the
 * id misses; we let it propagate so the CardScreen can render the
 * 404 surface.
 */
export function useCardQuery(cardId: string | undefined): UseCardQueryResult {
  const client = useApiClient();
  return useQuery<CardWithPrintingsDto, Error>({
    enabled: typeof cardId === 'string' && cardId.length > 0,
    queryKey: BROWSE_QUERY_KEYS.card(cardId ?? ''),
    // Card detail 404s should not auto-retry — the id is wrong, not
    // the network. Sets / cards-in-set still benefit from the
    // default retry posture (server flake, slow connection).
    retry: false,
    queryFn: async () => {
      return client.cards.getCard({ id: cardId as string });
    },
  });
}

function toSortedSetsPage(page: PaginatedResponse<SetDto>): SetsQueryData {
  return {
    items: sortByReleaseDateDesc(page.items),
    nextCursor: page.nextCursor,
  };
}

/**
 * Natural-order sort for card numbers. `Intl.Collator` with
 * `numeric: true` handles `'1' < '2' < '10' < 'SM01'`
 * out of the box.
 */
const NUMBER_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function sortCardsByNumber(cards: ReadonlyArray<CardInSetDto>): CardInSetDto[] {
  return [...cards].sort((a, b) => NUMBER_COLLATOR.compare(a.number, b.number));
}
