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
// `PublicSharePayload` was designed as exactly the seam the
// backend's `publicShareableDto` fills — same field set, same
// nullability rules. The runtime adapter now opts into the
// richer representation via `Accept:
// application/vnd.binderly.share+json` through
// `client.shareables.getPublicShareablePayload(...)` (V2 endpoint
// shipped by T-BE-EDGE-FUNCTIONS-V2 / PR #68; Q-012 closed). The
// fake-adapter tests (`createFakeShareApi`) keep passing
// unchanged — only the production adapter wiring changes.

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type {
  PublicShareableDto,
  ShareableDto,
} from '@binderly/api-contracts';

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
 * Calls `client.shareables.getPublicShareablePayload(...)` which
 * sends the `Accept: application/vnd.binderly.share+json`
 * representation negotiator — the V2 endpoint returns the full
 * envelope (owner + counts + member list + collection title) in
 * one round-trip. The DTO shape is structurally identical to
 * `PublicSharePayload`, so the cast is a one-line projection.
 *
 * 404 → `null` so the page can call `notFound()`; the previous
 * degraded-synthesis fallback (Q-012, iter 20) is gone — a 5xx
 * now propagates as an error so the page renders its error
 * state instead of a confusing half-broken header + empty grid.
 */
export function apiToShareApi(client: BinderlyClient): ShareApi {
  return {
    async getPublicSharePayload({ handle, slug, signal }): Promise<PublicSharePayload | null> {
      try {
        const dto = await client.shareables.getPublicShareablePayload({
          handle,
          slug,
          ...(signal !== undefined ? { signal } : {}),
        });
        return publicShareableDtoToPayload(dto);
      } catch (error) {
        if (error instanceof ApiNotFoundError) return null;
        throw error;
      }
    },
  };
}

/**
 * Project a `PublicShareableDto` (api-contracts) onto a
 * `PublicSharePayload` (web view contract). Field-for-field
 * pass-through — both shapes were designed to be the same.
 *
 * Returns a `readonly`-typed object that satisfies the
 * `PublicSharePayload` interface (which itself is read-only) so
 * downstream consumers can't mutate the payload by accident.
 */
function publicShareableDtoToPayload(dto: PublicShareableDto): PublicSharePayload {
  return {
    shareable: dto.shareable,
    owner: {
      handle: dto.owner.handle,
      displayName: dto.owner.displayName,
      avatarUrl: dto.owner.avatarUrl,
      bio: dto.owner.bio,
    },
    collectionTitle: dto.collectionTitle,
    description: dto.description,
    counts: {
      ownedUnique: dto.counts.ownedUnique,
      ownedTotalQuantity: dto.counts.ownedTotalQuantity,
      catalogTotal: dto.counts.catalogTotal,
      completionPct: dto.counts.completionPct,
    },
    members: dto.members.map((m) => ({
      printingId: m.printingId,
      cardId: m.cardId,
      cardName: m.cardName,
      cardNumber: m.cardNumber,
      setName: m.setName,
      setCode: m.setCode,
      variantLabel: m.variantLabel,
      imageUrl: m.imageUrl,
      quantity: m.quantity,
    })),
    lastUpdatedAt: dto.lastUpdatedAt,
  };
}
