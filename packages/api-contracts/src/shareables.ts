// Shareables DTOs (PROJECT.md § 14).
//
// A `shareable` row is a public-link configuration over a user's
// collection or one of their custom collections. The public URL
// surface is `/c/{profile.handle}/{slug}` rendered SSR by Next.js
// with proper Open Graph / Twitter card meta. Free tier: 1
// shareable per user; paid: unlimited and themable.
//
// Mirrors `packages/db/src/schema/shareables.ts`. The `target`
// column is `jsonb` storing a discriminated union
// `{kind: 'full'} | {kind: 'custom', custom_collection_id: <uuid>}`;
// the schema's CHECK constraint validates only the discriminator
// value, deferring deeper shape validation to the API layer.
// This contract is the API-layer enforcement surface.

import { z } from 'zod';

import { socialLinksSchema, subscriptionTierSchema } from './auth.js';
import { slugSchema } from './collection.js';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// ============================================================
// Target — the discriminated union over the shareable's source
// ============================================================

/**
 * `'full'` — share the user's entire collection.
 * `'custom'` — share one named custom collection. The
 * `custom_collection_id` must belong to the same user (the API
 * layer in T-BE-EDGE-FUNCTIONS verifies the ownership; the
 * schema-level CHECK in the DB only validates the kind value).
 */
export const shareableTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }).strict(),
  z
    .object({
      kind: z.literal('custom'),
      customCollectionId: uuidSchema,
    })
    .strict(),
]);
export type ShareableTarget = z.infer<typeof shareableTarget>;

// ============================================================
// Theme — the visual variant for the public page
// ============================================================

/**
 * Built-in theme tokens. The `'default'` theme is free; every
 * other theme is gated by Pro per PROJECT.md § 14 ("Free tier:
 * 1 shareable. Paid: unlimited and themable"). Adding a new
 * theme is additive and backward-compatible per the
 * contracts-evolution rules in the README.
 *
 * Adding more themes is a UI change, not a contracts change —
 * but the canonical list lives here so server-side gating can
 * reject `theme: 'gold'` from a free user without consulting
 * the UI package.
 */
export const SHAREABLE_THEMES = ['default', 'dark', 'paper', 'neon', 'gold'] as const;
export const shareableThemeSchema = z.enum(SHAREABLE_THEMES);
export type ShareableTheme = z.infer<typeof shareableThemeSchema>;

// ============================================================
// shareable — read DTO
// ============================================================

/**
 * Read-side wire shape for a `shareable` row. Same shape used
 * for both the owner's "my shareables" list (authenticated
 * read) and the public render path (anonymous read of an
 * active shareable by `(handle, slug)` lookup).
 *
 * The public render path resolves `(handle, slug)` →
 * `(user_id, shareable_id)` server-side; consumers never have
 * to dereference `userId` from a public page.
 */
export const shareableDto = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    slug: slugSchema,
    target: shareableTarget,
    theme: shareableThemeSchema,
    /**
     * Kill switch (#FU-50). When `false` the shareable is hidden
     * from public reads (the public render endpoint 404s) but the
     * owner still sees it in their settings list. Defaults to
     * `true` so rows read before the `is_active` column shipped
     * parse as active.
     */
    isActive: z.boolean().default(true),
    showValues: z.boolean(),
    showMissing: z.boolean(),
    showPhotos: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type ShareableDto = z.infer<typeof shareableDto>;

// ============================================================
// Write DTOs
// ============================================================

/**
 * Create a new shareable. Server-side enforces the free-tier
 * 1-per-user limit and the non-default-theme paid gate. `slug`
 * is supplied by the client; the create endpoint
 * (T-BE-EDGE-FUNCTIONS) may regenerate via CSPRNG when the
 * caller wants an unguessable slug — see `shareables.ts`'s
 * schema comment ("the slug doubles as an unguessable URL
 * token").
 */
export const createShareableRequest = z
  .object({
    slug: slugSchema,
    target: shareableTarget,
    theme: shareableThemeSchema.optional(),
    isActive: z.boolean().optional(),
    showValues: z.boolean().optional(),
    showMissing: z.boolean().optional(),
    showPhotos: z.boolean().optional(),
  })
  .strict();
export type CreateShareableRequest = z.infer<typeof createShareableRequest>;

/**
 * Patch an existing shareable. Every field is optional. The
 * `target.kind` is mutable in principle (full → custom or vice
 * versa) but in practice the UI exposes that as a "convert"
 * action; the contract permits it.
 */
export const updateShareableRequest = z
  .object({
    slug: slugSchema.optional(),
    target: shareableTarget.optional(),
    theme: shareableThemeSchema.optional(),
    isActive: z.boolean().optional(),
    showValues: z.boolean().optional(),
    showMissing: z.boolean().optional(),
    showPhotos: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updateShareableRequest body must include at least one field',
  });
export type UpdateShareableRequest = z.infer<typeof updateShareableRequest>;

// ============================================================
// Public shareable payload — `GET /v1/c/{handle}/{slug}`
// ============================================================

/**
 * Public-shareable owner subset. Mirrors the "anonymous reads
 * receive only `{ handle, displayName, avatarUrl, bio }`"
 * narrowing documented on `profileDto`. The fields are intentionally
 * the same shape as `PublicShareOwner` in
 * `apps/web/lib/share/api.ts` — the SSR page drops the
 * synthesised payload for this DTO 1:1.
 */
export const publicShareOwnerDto = z
  .object({
    handle: z.string().min(3).max(40),
    displayName: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
    bio: z.string().nullable(),
    /**
     * Owner social links rendered in the public page header
     * (#FU-51). Defaults to `[]` so older payloads (and the bare
     * `getPublicShareable` path) parse without the key.
     */
    socialLinks: socialLinksSchema.default([]),
    /**
     * Owner's subscription tier, surfaced so the public render path
     * can enforce the free-tier theme downgrade SERVER-SIDE (#FU-61 /
     * Q-024): a free owner's stored Pro theme is not honored on the
     * public page (`resolvePublicTheme`). The edge handler resolves
     * this fail-closed (RC down / unknown → `'free'`). Defaults to
     * `'free'` so older payloads parse and degrade safely closed.
     */
    tier: subscriptionTierSchema.default('free'),
  })
  .strict();
export type PublicShareOwnerDto = z.infer<typeof publicShareOwnerDto>;

/**
 * One member of the shared collection — a single printing the
 * member grid renders. Shape matches `PublicShareMember` in
 * `apps/web/lib/share/api.ts`.
 */
export const publicShareMemberDto = z
  .object({
    printingId: uuidSchema,
    cardId: uuidSchema,
    cardName: z.string().min(1),
    cardNumber: z.string().min(1),
    setName: z.string().min(1),
    setCode: z.string().min(1),
    variantLabel: z.string(),
    imageUrl: z.string().url().nullable(),
    quantity: z.number().int().nonnegative(),
  })
  .strict();
export type PublicShareMemberDto = z.infer<typeof publicShareMemberDto>;

/**
 * Counts the page header and OG image render. Shape matches
 * `PublicShareCounts` in `apps/web/lib/share/api.ts`. The server
 * pre-computes `completionPct` so SSR HTML and OG-image
 * rendering agree to the rounded percentage.
 */
export const publicShareCountsDto = z
  .object({
    ownedUnique: z.number().int().nonnegative(),
    ownedTotalQuantity: z.number().int().nonnegative(),
    catalogTotal: z.number().int().nonnegative(),
    completionPct: z.number().min(0).max(100),
  })
  .strict();
export type PublicShareCountsDto = z.infer<typeof publicShareCountsDto>;

/**
 * Public shareable DTO — the full envelope returned by
 * `GET /v1/c/{handle}/{slug}`. Shape matches `PublicSharePayload`
 * in `apps/web/lib/share/api.ts` so the runtime adapter
 * (`apiToShareApi`) swaps its degraded-synthesis branch for a
 * direct call with zero web-side churn.
 *
 * Anonymous endpoint — no JWT required, no auth header parsed.
 * Resolves `(handle, slug)` → `(profile, shareable)` server-side
 * via the service-role client; only public-shareable columns are
 * surfaced on the wire (no `user_id` leak, no `collection_item`
 * row internals).
 */
export const publicShareableDto = z
  .object({
    shareable: shareableDto,
    owner: publicShareOwnerDto,
    collectionTitle: z.string().min(1),
    description: z.string().nullable(),
    counts: publicShareCountsDto,
    members: z.array(publicShareMemberDto),
    lastUpdatedAt: isoDateTimeSchema,
  })
  .strict();
export type PublicShareableDto = z.infer<typeof publicShareableDto>;
