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
    showValues: z.boolean().optional(),
    showMissing: z.boolean().optional(),
    showPhotos: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updateShareableRequest body must include at least one field',
  });
export type UpdateShareableRequest = z.infer<typeof updateShareableRequest>;
