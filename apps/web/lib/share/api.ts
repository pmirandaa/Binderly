// Public shareable data layer — typed read-side contract for the
// `/c/[handle]/[slug]` SSR page and its `opengraph-image` route.
//
// The view + OG-image components program against `ShareApi` (the
// narrow interface declared here) rather than the full
// `BinderlyClient`. Tests inject a `createFakeShareApi(...)` from
// `./fixtures.ts`; production wires `apiToShareApi(getApiClient())`
// inside a `useEffect` so the env-loading branch never runs during
// `next build` (matches the T-W-BROWSE / T-W-COLLECTION pattern).
//
// Why a richer `PublicSharePayload` than the api-client's bare
// `ShareableDto`: the SSR page needs the owner's handle / display
// name, a human title for the collection, a member list with
// names + images + set context, and ownership counts. None of
// that is on the api-client's `shareables.getPublicShareable`
// surface today — it returns the `shareable` row only.
// See `open-questions.md` § Q-011 for the proposed backend
// follow-up; this file declares the contract the page renders
// against so the backend follow-up has zero web-side churn.
//
// Until the richer endpoint lands the runtime adapter
// (`apiToShareApi`) calls `getPublicShareable` to obtain the
// metadata, synthesises the owner handle from the URL (`handle`
// is in the path), and returns an empty `members` list with zero
// counts. The page header + OG meta render correctly; the member
// grid renders an "owner hasn't synced yet" empty state. Once
// the backend lands `publicShareableDto`, swap one branch here.

import type { BinderlyClient } from '@binderly/api-client';
import type { ShareableDto } from '@binderly/api-contracts';

/**
 * Owner subset surfaced on a public shareable. Mirrors the
 * "public reads receive only `{ handle, displayName, avatarUrl,
 * bio }`" narrowing documented on `profileDto`.
 */
export interface PublicShareOwner {
  readonly handle: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
}

/**
 * One member of the shared collection — a single printing
 * displayed in the member grid.
 *
 * `cardId` is exposed alongside `printingId` because the link
 * surface (`/cards/[id]`) treats `[id]` as a printing id (the
 * T-W-BROWSE convention) — but tests sometimes assert the
 * underlying card id directly, so we surface both rather than
 * forcing every test to dereference the relationship.
 */
export interface PublicShareMember {
  readonly printingId: string;
  readonly cardId: string;
  readonly cardName: string;
  readonly cardNumber: string;
  readonly setName: string;
  readonly setCode: string;
  readonly variantLabel: string;
  readonly imageUrl: string | null;
  readonly quantity: number;
}

/**
 * Ownership counts displayed in the page header + OG image.
 *
 * `ownedUnique` = distinct printings the user owns inside the
 *   shared collection scope (full / custom).
 * `ownedTotalQuantity` = sum of `quantity` across owned items —
 *   useful when the shareable shows duplicates.
 * `catalogTotal` = denominator for "X / Y" copy. For the
 *   `full` target this is the catalog's master-set printing
 *   count; for `custom` it's the size of the custom collection's
 *   roster. The backend follow-up decides the exact rule;
 *   pages here treat it as opaque and render "X / Y" verbatim.
 * `completionPct` = `(ownedUnique / catalogTotal) * 100`,
 *   pre-computed server-side so the SSR HTML matches the OG
 *   image exactly (no client-side rounding drift).
 */
export interface PublicShareCounts {
  readonly ownedUnique: number;
  readonly ownedTotalQuantity: number;
  readonly catalogTotal: number;
  readonly completionPct: number;
}

/**
 * The full SSR payload. One round-trip resolves
 * `(handle, slug)` → this struct; the page reads exactly what it
 * renders.
 */
export interface PublicSharePayload {
  readonly shareable: ShareableDto;
  readonly owner: PublicShareOwner;
  /**
   * Human label rendered in the page title and the OG image
   * (e.g. "Pablo's collection" or "Pablo's Charizard binder").
   * Constructed server-side so SSR + OG agree.
   */
  readonly collectionTitle: string;
  /** Optional one-liner from the owner; nullable on free tier. */
  readonly description: string | null;
  readonly counts: PublicShareCounts;
  readonly members: ReadonlyArray<PublicShareMember>;
  /** ISO-8601 of the last update to the underlying collection. */
  readonly lastUpdatedAt: string;
}

/**
 * The narrow read surface the page + OG image program against.
 * `getPublicSharePayload` is the only method — fetches by
 * `(handle, slug)` and returns either the payload or `null`
 * (404 sentinel; the page calls `notFound()` on `null`).
 */
export interface ShareApi {
  readonly getPublicSharePayload: (
    input: { readonly handle: string; readonly slug: string; readonly signal?: AbortSignal },
  ) => Promise<PublicSharePayload | null>;
}

/**
 * Adapt a `BinderlyClient` to the narrow `ShareApi`.
 *
 * Today the adapter calls `client.shareables.getPublicShareable`
 * (returns the bare `ShareableDto`) and synthesises the rest of
 * `PublicSharePayload` — the owner handle from the URL, an empty
 * member list, zero counts. This is a degraded-but-renderable
 * payload: the page header + OG meta look right, the member grid
 * shows an empty state.
 *
 * When the backend lands the richer `publicShareableDto` endpoint
 * (`open-questions.md` § Q-011) this function swaps the synthesis
 * branch for a direct call. Nothing else changes — the page +
 * OG image are unaware of the seam.
 *
 * 404 mapping: the api-client throws `ApiNotFoundError` on 404;
 * we catch it inline and return `null`. Other errors propagate so
 * the page renders its error state instead of a confusing empty
 * shareable.
 */
export function apiToShareApi(client: BinderlyClient): ShareApi {
  return {
    async getPublicSharePayload({ handle, slug, signal }): Promise<PublicSharePayload | null> {
      try {
        const shareable = await client.shareables.getPublicShareable({
          handle,
          slug,
          ...(signal !== undefined ? { signal } : {}),
        });
        // Degraded synthesis until Q-011's richer endpoint lands.
        // The handle in the URL is the source of truth (the
        // backend resolves it before returning the shareable); we
        // surface it verbatim so the page header matches the URL.
        const collectionTitle =
          shareable.target.kind === 'full' ? 'Full collection' : 'Custom collection';
        return {
          shareable,
          owner: {
            handle,
            displayName: null,
            avatarUrl: null,
            bio: null,
          },
          collectionTitle,
          description: null,
          counts: {
            ownedUnique: 0,
            ownedTotalQuantity: 0,
            catalogTotal: 0,
            completionPct: 0,
          },
          members: [],
          lastUpdatedAt: shareable.updatedAt,
        };
      } catch (error) {
        // `ApiNotFoundError` is imported lazily to keep this
        // module's static import graph minimal. The api-client
        // re-exports the class from its barrel so the duck check
        // is a single property read.
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { name?: string }).name === 'ApiNotFoundError'
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}
