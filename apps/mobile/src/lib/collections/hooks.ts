// TanStack Query wrappers around the custom + smart collection
// reads/writes. Mirrors the posture of `lib/collection/hooks.ts`
// (T-M-COLLECTION) so feature screens program against an injectable
// `BinderlyClient` and drop tests can mock the client end-to-end.
//
// Read queries:
//
//   - `useCustomCollectionsQuery()` — full list of the signed-in
//     user's `custom_collection` rows (manual + smart). Auth-required;
//     gated via `enabled`.
//   - `useCustomCollectionQuery(id)` — single custom_collection row
//     for the detail screens.
//   - `useCustomCollectionItemsQuery(id)` — manual-collection
//     membership (the join rows). Used by the manual-detail screen
//     to render the member grid.
//   - `useSmartCollectionRuleQuery(id)` — smart rule expression for
//     the smart-detail screen (paid-only).
//   - `useSubscriptionQuery()` — the user's `subscription` row.
//     Powers free-vs-paid gating for the Save button on the smart
//     editor + the smart-detail plan gate.
//
// Mutations:
//
//   - `useCreateCustomCollectionMutation()` — POST a new manual or
//     smart collection. Invalidates the list query on success.
//   - `useUpdateCustomCollectionMutation()` — PATCH name/description.
//     Invalidates list + the per-id query.
//   - `useDeleteCustomCollectionMutation()` — DELETE. Invalidates
//     the list.
//   - `useAddPrintingToCustomCollectionMutation()` — POST a printing
//     into a manual collection's items. Invalidates the items query.
//   - `useRemovePrintingFromCustomCollectionMutation()` — DELETE.
//     Invalidates items.
//
// All mutations accept the per-call `id` (or other path bits) on the
// invocation argument so screens can keep a single hook handy and
// dispatch with the right resource on press.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  CreateCustomCollectionRequest,
  CustomCollectionDto,
  CustomCollectionItemDto,
  SmartCollectionRuleDto,
  SmartPreviewRequestDto,
  SmartPreviewResponseDto,
  SubscriptionDto,
  UpdateCustomCollectionRequest,
} from '@binderly/api-contracts';

import { useApiClient } from '../api-client.js';

/**
 * Cache keys exposed for tests + manual invalidation. Each key
 * includes the user-facing id so unrelated mutations don't bust
 * sibling caches.
 */
export const COLLECTIONS_QUERY_KEYS = {
  customCollections: () => ['collections', 'custom-collections'] as const,
  customCollection: (id: string) => ['collections', 'custom-collection', id] as const,
  customCollectionItems: (id: string) =>
    ['collections', 'custom-collection-items', id] as const,
  smartCollectionRule: (id: string) =>
    ['collections', 'smart-collection-rule', id] as const,
  subscription: () => ['collections', 'subscription'] as const,
};

// ============================================================
// Reads
// ============================================================

export interface UseCustomCollectionsOptions {
  /** Toggle off when there is no signed-in user (suppresses 401s). */
  readonly enabled?: boolean;
}

export type UseCustomCollectionsQueryResult = UseQueryResult<CustomCollectionDto[], Error>;

/**
 * Fetch every custom_collection row owned by the signed-in user.
 * Includes BOTH manual and smart kinds; consumers split with
 * `kind === 'manual'` / `kind === 'smart'` filters.
 */
export function useCustomCollectionsQuery(
  options: UseCustomCollectionsOptions = {},
): UseCustomCollectionsQueryResult {
  const client = useApiClient();
  const enabled = options.enabled ?? true;
  return useQuery<CustomCollectionDto[], Error>({
    queryKey: COLLECTIONS_QUERY_KEYS.customCollections(),
    enabled,
    queryFn: async () => client.collection.listCustomCollections(),
  });
}

export interface UseCustomCollectionOptions {
  readonly enabled?: boolean;
}

export type UseCustomCollectionQueryResult = UseQueryResult<CustomCollectionDto, Error>;

/**
 * Fetch a single custom_collection by id. The detail screen calls
 * this directly instead of cherry-picking from the list query so a
 * deeplink can resolve the row without first loading the list.
 */
export function useCustomCollectionQuery(
  id: string | undefined,
  options: UseCustomCollectionOptions = {},
): UseCustomCollectionQueryResult {
  const client = useApiClient();
  const enabled = (options.enabled ?? true) && id !== undefined && id.length > 0;
  return useQuery<CustomCollectionDto, Error>({
    queryKey: COLLECTIONS_QUERY_KEYS.customCollection(id ?? ''),
    enabled,
    queryFn: async () => {
      if (id === undefined) throw new Error('useCustomCollectionQuery: id is required');
      return client.collection.getCustomCollection({ id });
    },
  });
}

export type UseCustomCollectionItemsQueryResult = UseQueryResult<CustomCollectionItemDto[], Error>;

/**
 * Fetch the manual-collection membership join rows for a given
 * custom_collection. Returns an empty array for smart collections
 * (the server returns 404 for smart-on-items, so we leave the query
 * disabled at the call site instead).
 */
export function useCustomCollectionItemsQuery(
  customCollectionId: string | undefined,
  options: { readonly enabled?: boolean } = {},
): UseCustomCollectionItemsQueryResult {
  const client = useApiClient();
  const enabled =
    (options.enabled ?? true) &&
    customCollectionId !== undefined &&
    customCollectionId.length > 0;
  return useQuery<CustomCollectionItemDto[], Error>({
    queryKey: COLLECTIONS_QUERY_KEYS.customCollectionItems(customCollectionId ?? ''),
    enabled,
    queryFn: async () => {
      if (customCollectionId === undefined) {
        throw new Error('useCustomCollectionItemsQuery: id is required');
      }
      return client.collection.listCustomCollectionItems({ customCollectionId });
    },
  });
}

export type UseSmartCollectionRuleQueryResult = UseQueryResult<SmartCollectionRuleDto, Error>;

/**
 * Fetch the smart_collection_rule expression for a saved smart
 * collection. Used by the smart-detail screen to re-evaluate the
 * rule against the user's owned printings on every load.
 */
export function useSmartCollectionRuleQuery(
  customCollectionId: string | undefined,
  options: { readonly enabled?: boolean } = {},
): UseSmartCollectionRuleQueryResult {
  const client = useApiClient();
  const enabled =
    (options.enabled ?? true) &&
    customCollectionId !== undefined &&
    customCollectionId.length > 0;
  return useQuery<SmartCollectionRuleDto, Error>({
    queryKey: COLLECTIONS_QUERY_KEYS.smartCollectionRule(customCollectionId ?? ''),
    enabled,
    queryFn: async () => {
      if (customCollectionId === undefined) {
        throw new Error('useSmartCollectionRuleQuery: id is required');
      }
      return client.collection.getSmartCollectionRule({ customCollectionId });
    },
  });
}

export type UseSubscriptionQueryResult = UseQueryResult<SubscriptionDto, Error>;

/**
 * Fetch the signed-in user's subscription row. Powers all
 * paid-feature gating in this stack — the smart Save CTA, the
 * smart-detail plan gate, etc.
 *
 * On error (e.g. the row hasn't been seeded yet) callers should
 * default to free-tier behaviour, NOT block the UI behind a retry —
 * see the `isPaidTier` helper below.
 */
export function useSubscriptionQuery(
  options: { readonly enabled?: boolean } = {},
): UseSubscriptionQueryResult {
  const client = useApiClient();
  const enabled = options.enabled ?? true;
  return useQuery<SubscriptionDto, Error>({
    queryKey: COLLECTIONS_QUERY_KEYS.subscription(),
    enabled,
    queryFn: async () => client.profile.getMySubscription(),
  });
}

/**
 * Conservative paid-tier predicate. `true` only when the query
 * resolved AND `tier === 'pro'`. Loading / error / unknown all
 * collapse to `false` (free) so paid-only surfaces stay locked
 * down by default.
 */
export function isPaidTier(query: UseSubscriptionQueryResult): boolean {
  if (query.data === undefined) return false;
  return query.data.tier === 'pro';
}

// ============================================================
// Mutations
// ============================================================

/**
 * Create a new manual or smart custom_collection. The caller passes
 * the full request shape (including `kind`); the hook handles
 * cache invalidation on success.
 */
export function useCreateCustomCollectionMutation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<CustomCollectionDto, Error, CreateCustomCollectionRequest>({
    mutationFn: async (input) => client.collection.createCustomCollection(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: COLLECTIONS_QUERY_KEYS.customCollections(),
      });
    },
  });
}

export interface UpdateCustomCollectionInput {
  readonly id: string;
  readonly patch: UpdateCustomCollectionRequest;
}

/**
 * PATCH the metadata (name, description, slug) of a custom
 * collection. Invalidates both the list and the per-id detail
 * cache so a rename surfaces everywhere immediately.
 */
export function useUpdateCustomCollectionMutation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<CustomCollectionDto, Error, UpdateCustomCollectionInput>({
    mutationFn: async ({ id, patch }) =>
      client.collection.updateCustomCollection({ id, patch }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: COLLECTIONS_QUERY_KEYS.customCollections(),
      });
      void queryClient.invalidateQueries({
        queryKey: COLLECTIONS_QUERY_KEYS.customCollection(variables.id),
      });
    },
  });
}

/**
 * DELETE a custom collection. Invalidates the list query; per-id
 * queries are left in place because the screen typically navigates
 * away on success.
 */
export function useDeleteCustomCollectionMutation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, { readonly id: string }>({
    mutationFn: async ({ id }) => client.collection.deleteCustomCollection({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: COLLECTIONS_QUERY_KEYS.customCollections(),
      });
    },
  });
}

export interface AddPrintingInput {
  readonly customCollectionId: string;
  readonly printingId: string;
}

/**
 * Add a printing to a manual collection. Invalidates the items
 * query for that collection so the member grid re-renders with the
 * new row.
 */
export function useAddPrintingToCustomCollectionMutation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<CustomCollectionItemDto, Error, AddPrintingInput>({
    mutationFn: async ({ customCollectionId, printingId }) =>
      client.collection.addPrintingToCustomCollection({
        customCollectionId,
        body: { printingId },
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: COLLECTIONS_QUERY_KEYS.customCollectionItems(variables.customCollectionId),
      });
    },
  });
}

/**
 * Remove a printing from a manual collection. Same invalidation
 * posture as the add mutation.
 */
export function useRemovePrintingFromCustomCollectionMutation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, AddPrintingInput>({
    mutationFn: async ({ customCollectionId, printingId }) =>
      client.collection.removePrintingFromCustomCollection({
        customCollectionId,
        printingId,
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: COLLECTIONS_QUERY_KEYS.customCollectionItems(variables.customCollectionId),
      });
    },
  });
}

export type UseSmartPreviewMutationResult = UseMutationResult<
  SmartPreviewResponseDto,
  Error,
  SmartPreviewRequestDto
>;

/**
 * Compile + execute a smart-collection expression against the
 * catalog server-side via the V2 `/v1/smart-collections/preview`
 * endpoint (T-M-API-V2-WIRING). Replaces the iter-19 in-app
 * `evaluateAgainstCatalog(...)` Run preview (#FU-23 frontend
 * half).
 *
 * `useMutation` semantics rather than `useQuery` because the
 * preview is imperative — the user presses Run, the expression
 * is the body, and there's no natural cache key (every parse
 * iteration produces a different AST). The smart editor pulls
 * the result into local state on success so the match grid
 * survives subsequent edits to the input until the next Run.
 */
export function useSmartPreviewMutation(): UseSmartPreviewMutationResult {
  const client = useApiClient();
  return useMutation<SmartPreviewResponseDto, Error, SmartPreviewRequestDto>({
    mutationFn: async (input) => client.smartCollections.preview(input),
  });
}
