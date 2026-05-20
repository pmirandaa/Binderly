// Auth-adjacent DTOs — the WIRE SHAPES of `auth.users`, the
// active session, the `profile` table, and the `subscription`
// table.
//
// Per the dispatch's parallel-sibling note: T-BE-AUTH owns the
// runtime mechanics of Supabase Auth (OAuth callbacks, JWT
// verification, session refresh). This file owns the DTO shapes
// only — what comes back over the wire from a profile read,
// what a session looks like to the client, etc.
//
// The DB sources are:
//
//   - `auth.users` — Supabase-managed; we never alter it.
//     Surfaced as `userDto` with the public-safe subset of
//     columns (id, email, app metadata).
//   - `packages/db/src/schema/profiles.ts` — `profile` table.
//     `profile.preferences` is `jsonb` whose shape is
//     contractually owned by this file (per
//     `context/data-model.md` § "profile.preferences shape":
//     "the shape is contractual and validated by zod schema in
//     packages/shared-types/src/profile-preferences.ts" — the
//     orchestrator's iter-12 dispatch renamed the package to
//     `@binderly/api-contracts`, so the canonical profile
//     preferences schema lives here now).
//   - `packages/db/src/schema/subscriptions.ts` —
//     `subscription` table.

import { z } from 'zod';

import { currencyCodeSchema, isoDateTimeSchema, languageSchema, uuidSchema } from './common.js';

// ============================================================
// User — the public-safe subset of `auth.users`
// ============================================================

/**
 * Read-side wire shape for `auth.users`. We expose a small,
 * stable subset:
 *
 * - `id` — the canonical user id; foreign-keyed by every user
 *   table.
 * - `email` — required for the magic-link flow; null if the
 *   user signed up via OAuth and the provider didn't emit one.
 * - `createdAt` — useful for "member since" badges and the
 *   account-deletion grace period.
 *
 * `app_metadata` (provider, role) and `user_metadata` (display
 * name, avatar from OAuth) are *not* on this DTO — display
 * fields belong on `profileDto` so the application owns the
 * display layer rather than relying on whatever the OAuth
 * provider happened to emit. Server-side code that needs the
 * raw `app_metadata` reaches into the Supabase client directly.
 */
export const userDto = z
  .object({
    id: uuidSchema,
    email: z.string().email().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type UserDto = z.infer<typeof userDto>;

// ============================================================
// Session — the wire shape of an authenticated session
// ============================================================

/**
 * Wire shape for the client-side authenticated session. Mirrors
 * the relevant subset of supabase-js's `Session` type — but we
 * keep the contract minimal: `userId` plus the access-token
 * expiry. The actual JWT is held by the supabase-js client and
 * not exposed via this DTO; auth-protected endpoints read the
 * JWT from the request headers, not from a `sessionDto` payload.
 *
 * Endpoints that ONLY need to know "is the caller signed in?"
 * receive a `sessionDto` from the api-client; endpoints that
 * need elevated checks (e.g. service-role operations) read the
 * raw JWT in T-BE-EDGE-FUNCTIONS.
 */
export const sessionDto = z
  .object({
    userId: uuidSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();
export type SessionDto = z.infer<typeof sessionDto>;

// ============================================================
// Profile preferences — contractual jsonb shape
// ============================================================

/**
 * Default-grade-tier-view enum from
 * `context/data-model.md` § "profile.preferences shape".
 * `'auto'` picks from the user's collection condition.
 */
export const DEFAULT_GRADE_TIER_VIEWS = [
  'auto',
  'raw_nm',
  'psa_10',
  'psa_9',
  'bgs_10',
  'bgs_9_5',
] as const;
export const defaultGradeTierViewSchema = z.enum(DEFAULT_GRADE_TIER_VIEWS);
export type DefaultGradeTierView = z.infer<typeof defaultGradeTierViewSchema>;

/**
 * UI theme preference. `'system'` follows the OS theme.
 */
export const PROFILE_THEMES = ['system', 'light', 'dark'] as const;
export const profileThemeSchema = z.enum(PROFILE_THEMES);
export type ProfileTheme = z.infer<typeof profileThemeSchema>;

/**
 * `profile.preferences` is `jsonb` in Postgres but the shape is
 * contractual per `context/data-model.md` § "profile.preferences
 * shape". All keys are optional; missing keys fall back to
 * documented defaults at read time. `.strict()` rejects unknown
 * keys so a client typo doesn't silently land in the row.
 *
 * Documented defaults (read-time):
 *   - display_currency: 'USD'
 *   - default_market: 'EBAY_US'
 *   - card_languages: ['en']
 *   - theme: 'system'
 *   - locale: 'en-US' (or accept-language at signup)
 *   - email_marketing_opt_in: false
 *   - default_grade_tier_view: 'auto'
 *   - grading_flywheel_opt_in: false
 *
 * Server-side validation rules layered on top of this schema
 * (per `context/data-model.md`):
 *   - `display_currency` must exist as a `quote_currency` in
 *     `fx_rate`.
 *   - `default_market` must exist in the `market` catalog.
 *
 * The contracts package validates the *shape*; the existence
 * checks happen in T-BE-EDGE-FUNCTIONS at write time.
 */
export const profilePreferencesSchema = z
  .object({
    displayCurrency: currencyCodeSchema.optional(),
    defaultMarket: z.enum(['EBAY_US', 'CARDMARKET_EU', 'EBAY_UK', 'EBAY_JP']).optional(),
    cardLanguages: z.array(languageSchema).optional(),
    theme: profileThemeSchema.optional(),
    /**
     * BCP-47 locale string. We don't enumerate (the list is
     * effectively unbounded); the regex enforces the broad shape
     * (`en`, `en-US`, `es-CL`, `de-DE`, `zh-Hans-CN`).
     */
    locale: z
      .string()
      .regex(
        /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?(-[A-Za-z0-9]{1,8})*$/,
        'expected BCP-47 locale tag',
      )
      .optional(),
    emailMarketingOptIn: z.boolean().optional(),
    defaultGradeTierView: defaultGradeTierViewSchema.optional(),
    gradingFlywheelOptIn: z.boolean().optional(),
  })
  .strict();
export type ProfilePreferences = z.infer<typeof profilePreferencesSchema>;

// ============================================================
// Profile — read DTO
// ============================================================

/**
 * Read-side wire shape for a `profile` row. `handle` is
 * citext-unique and used in the public URL `/c/{handle}/{slug}`;
 * other fields are display surface for the in-app account page
 * and the public shareable header.
 *
 * Public reads (anonymous SSR of a shareable page) receive only
 * the subset `{ handle, displayName, avatarUrl, bio }` — that
 * narrowing happens server-side in T-BE-EDGE-FUNCTIONS by
 * reading the public-profile RLS policy from Phase 1. The DTO
 * here is the *full* read shape; clients narrow as needed.
 */
export const profileDto = z
  .object({
    userId: uuidSchema,
    handle: z.string().min(3).max(40),
    displayName: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
    bio: z.string().nullable(),
    preferences: profilePreferencesSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type ProfileDto = z.infer<typeof profileDto>;

/**
 * Patch a profile. `handle` is mutable but rate-limited
 * server-side (claim-squatting concern; the handle is part of
 * the public URL). `preferences` is replaced wholesale on
 * update — partial preference patches are submitted as the new
 * preferences object with the carry-over keys included
 * (clients merge; server validates the merged shape).
 */
export const updateProfileRequest = z
  .object({
    handle: z
      .string()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9_]+$/, 'handle must be alphanumeric or underscore')
      .optional(),
    displayName: z.string().max(80).nullish(),
    avatarUrl: z.string().url().nullish(),
    bio: z.string().max(280).nullish(),
    preferences: profilePreferencesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updateProfileRequest body must include at least one field',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequest>;

// ============================================================
// Handle availability — `GET /v1/me/handle-available?handle=…`
// ============================================================

/**
 * Allowed shape for a public handle. The settings UI binds the
 * input box to this regex so the user gets feedback before the
 * round-trip; the server is the final authority (citext unique
 * on `profile.handle`).
 *
 * Pattern:
 *   - 3–30 chars total
 *   - first char `[a-z0-9]` (no leading hyphen — keeps the URL
 *     path readable and avoids the `-` that would prefix a flag)
 *   - subsequent chars `[a-z0-9-]`
 *
 * The wider `updateProfileRequest.handle` schema currently
 * accepts uppercase + underscore (legacy from T-BE-API-CONTRACTS
 * iter 12). The narrower shape on this endpoint is what the
 * settings UI bakes into its handle picker — the underlying
 * `profile.handle` column is `citext`, so server-side
 * uniqueness is case-insensitive regardless of the wire-time
 * casing the picker advertises.
 */
export const SHAREABLE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const shareableHandleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(SHAREABLE_HANDLE_PATTERN, 'handle must match ^[a-z0-9][a-z0-9-]{2,29}$');
export type ShareableHandle = z.infer<typeof shareableHandleSchema>;

/**
 * Reasons a handle can be unavailable. The client renders
 * different copy per reason:
 *   - `taken` — somebody else owns it (suggest a variant).
 *   - `invalid` — pattern check failed (the client also enforces
 *     this so the server response is the fallback for stale
 *     pages).
 *   - `rate_limited` — too many recent checks (the picker
 *     debounces 400 ms; sustained typing trips this on the
 *     backend's per-IP rate limit).
 *   - `reserved` — system-owned handle (e.g. "admin", "binderly",
 *     "support"). The server-side reserved-handle list is
 *     authoritative; the client just renders the message.
 */
export const HANDLE_UNAVAILABLE_REASONS = [
  'taken',
  'invalid',
  'rate_limited',
  'reserved',
] as const;
export const handleUnavailableReasonSchema = z.enum(HANDLE_UNAVAILABLE_REASONS);
export type HandleUnavailableReason = z.infer<typeof handleUnavailableReasonSchema>;

/**
 * Wire shape for `GET /v1/me/handle-available?handle=<value>`.
 *
 * - `available: true` → the handle is free; `reason` is absent.
 * - `available: false` → `reason` MUST be present; the client
 *   uses it to render the right copy.
 *
 * The endpoint is auth-required (rate-limit budget per user),
 * but checking your *current* handle returns `available: true`
 * (you already own it) so the settings UI can render "looks
 * good" even when the user hasn't typed a change yet.
 */
export const handleAvailabilityResponse = z
  .object({
    handle: shareableHandleSchema,
    available: z.boolean(),
    reason: handleUnavailableReasonSchema.optional(),
  })
  .strict()
  .refine(
    (value) => (value.available === false ? value.reason !== undefined : value.reason === undefined),
    {
      message:
        'reason MUST be set when available=false and MUST be absent when available=true',
    },
  );
export type HandleAvailabilityResponse = z.infer<typeof handleAvailabilityResponse>;

// ============================================================
// Subscription — read DTO
// ============================================================

/**
 * Subscription tier. Free is the default; Pro unlocks the
 * paid-feature matrix in PROJECT.md § 16.
 */
export const SUBSCRIPTION_TIERS = ['free', 'pro'] as const;
export const subscriptionTierSchema = z.enum(SUBSCRIPTION_TIERS);
export type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;

/**
 * Subscription source — the IAP / payment provider responsible
 * for the active entitlement. Webhooks from RevenueCat / Paddle
 * land in T-BE-EDGE-FUNCTIONS and update this column.
 */
export const SUBSCRIPTION_SOURCES = ['revenuecat', 'paddle'] as const;
export const subscriptionSourceSchema = z.enum(SUBSCRIPTION_SOURCES);
export type SubscriptionSource = z.infer<typeof subscriptionSourceSchema>;

/**
 * Read-side wire shape for a `subscription` row. The `raw`
 * column (provider webhook payload) is intentionally NOT on
 * this DTO — it's debug-only, never user-facing.
 *
 * `externalCustomerId` is included so the in-app "manage
 * subscription" link can deep-link into RevenueCat / Paddle's
 * customer portal without a server round-trip.
 */
export const subscriptionDto = z
  .object({
    userId: uuidSchema,
    tier: subscriptionTierSchema,
    source: subscriptionSourceSchema.nullable(),
    externalCustomerId: z.string().nullable(),
    expiresAt: isoDateTimeSchema.nullable(),
    lastEventAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type SubscriptionDto = z.infer<typeof subscriptionDto>;
