// Reusable primitives shared across every domain module:
//
//   - Primitive validators (UUID, ISO-8601 datetime, ISO date,
//     ISO-4217 currency, language code, market code, the
//     Drizzle-style `numeric(p,s)` wire form).
//   - The discriminated-union result envelope (`apiResultSchema`)
//     consumed by every endpoint. Mirrors `rules/02-backend.md`
//     ("Edge Functions return `{ ok, data | error }`").
//   - The error envelope (`apiErrorSchema`).
//   - Cursor-paginated response wrapper (`paginatedResponseSchema`).
//   - Cursor encode / decode helpers (opaque base64).
//
// This module is the bottom of the package's type graph. No other
// module in `@binderly/api-contracts` depends on anything but
// `common` and `zod`.

import { z } from 'zod';

// ============================================================
// Primitive validators
// ============================================================

/**
 * UUID v4 string. Matches Postgres `gen_random_uuid()` output
 * format — 8-4-4-4-12 hex.
 */
export const uuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof uuidSchema>;

/**
 * ISO-8601 datetime string with timezone (matches Postgres
 * `timestamptz` rendered to JSON via PostgREST / supabase-js).
 *
 * `z.string().datetime({ offset: true })` rejects bare local
 * datetimes — we always serialize timestamps with an explicit
 * offset (most often `Z` for UTC) so consumers don't have to
 * guess the timezone.
 */
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

/**
 * ISO-8601 calendar date (`YYYY-MM-DD`). Matches Postgres `date`
 * columns — `set.release_date`, `collection_item.acquired_at`,
 * `price_aggregate.period_start`, `fx_rate.rate_date`, etc.
 *
 * Zod's built-in `.date()` validator (added in 3.20) enforces the
 * exact `YYYY-MM-DD` shape and rejects timestamps. Documented for
 * the regex-curious in the `data-pipeline` precedent
 * (`isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`); using
 * the built-in keeps the error message uniform with `isoDateTime`.
 */
export const isoDateSchema = z.string().date();
export type IsoDate = z.infer<typeof isoDateSchema>;

/**
 * Postgres `numeric(precision, scale)` columns serialise to JSON
 * as strings via the postgres-js driver. We mirror that posture on
 * the wire so consumers don't suffer floating-point drift
 * (`0.1 + 0.2 → 0.30000000000000004`). Allows up to 2 decimal
 * places (the price columns are all `numeric(_, 2)`); higher-scale
 * columns (`fx_rate.rate` — `numeric(14, 6)`) get their own
 * tighter validator co-located with the schema that uses them.
 *
 * Negative values are accepted because some `numeric` fields can
 * be negative in principle (deltas, refunds); validators that need
 * non-negative semantics layer that on top.
 */
export const numericString2dpSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'expected decimal string with up to 2 fractional digits');
export type NumericString2dp = z.infer<typeof numericString2dpSchema>;

/**
 * Higher-precision numeric for FX rates (`numeric(14, 6)`) — up to
 * 6 fractional digits. `1 USD = 0.000123 …` is valid; trailing
 * zeros are accepted because Postgres preserves them.
 */
export const numericString6dpSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,6})?$/, 'expected decimal string with up to 6 fractional digits');
export type NumericString6dp = z.infer<typeof numericString6dpSchema>;

/**
 * ISO-4217 alpha-3 currency code, uppercase. Matches the wire
 * form used by `price_observation.observed_currency`,
 * `collection_item.acquired_currency`, and
 * `profile.preferences.display_currency`.
 *
 * We do not enumerate the full ISO-4217 list here because the
 * canonical "supported" list is the set of `quote_currency`
 * values present in `fx_rate` (per `context/data-model.md` § 13:
 * "display_currency must be a currency we have at least one
 * fx_rate row for"). Server-side validators layer that
 * existence check on top of this regex.
 */
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'expected ISO-4217 alpha-3 code');
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

/**
 * Card language enum. Per `context/data-model.md` and
 * `data-pipeline/src/types.ts`, v1 supports `en` and `jp`.
 * Other languages are deferred (PROJECT.md § 7).
 */
export const LANGUAGES = ['en', 'jp'] as const;
export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;

/**
 * Market code enum. Mirrors the seed data inserted by the
 * `T-DL-SCHEMA-PRICING` migration into the `market` catalog
 * table; canonical reference is `context/data-model.md` §
 * "Markets".
 */
export const MARKET_CODES = [
  'EBAY_US',
  'EBAY_DE',
  'EBAY_UK',
  'EBAY_JP',
  'CARDMARKET_EU',
  'TCGPLAYER_DERIVED',
  'OTHER',
] as const;
export const marketCodeSchema = z.enum(MARKET_CODES);
export type MarketCode = z.infer<typeof marketCodeSchema>;

/**
 * Grade-tier enum, mirroring the canonical vocabulary in
 * `context/data-model.md` § "Grade tiers" and the
 * `PRICE_OBSERVATION_GRADE_TIERS` tuple in
 * `data-pipeline/src/types.ts`. Re-declared (not imported) per
 * the elaborated D3 decision — the contracts package must not
 * pull `@binderly/data-pipeline` into the consumer's transitive
 * graph.
 */
export const GRADE_TIERS = [
  'RAW_NM',
  'RAW_LP',
  'RAW_MP',
  'RAW_HP',
  'RAW_DMG',
  'RAW_UNKNOWN',
  'PSA_10',
  'PSA_9',
  'PSA_8',
  'PSA_7',
  'PSA_LOWER',
  'BGS_10_BLACK',
  'BGS_10',
  'BGS_9_5',
  'BGS_9',
  'BGS_LOWER',
  'CGC_10_PRISTINE',
  'CGC_10',
  'CGC_9_5',
  'CGC_9',
  'CGC_LOWER',
  'OTHER_GRADED',
] as const;
export const gradeTierSchema = z.enum(GRADE_TIERS);
export type GradeTier = z.infer<typeof gradeTierSchema>;

/**
 * Card-condition enum (the user-visible vocabulary for
 * `collection_item.condition`). Matches PROJECT.md § 13 ("Raw:
 * NM, LP, MP, HP, DMG, plus 'raw unknown condition'") and the
 * default `'NEAR_MINT'` from
 * `packages/db/src/schema/collections.ts`. The DB column itself
 * is permissive `text` for forward flexibility; this enum is the
 * API-layer enforcement surface per `collections.ts`'s comment
 * ("validation lives at the API layer").
 */
export const CARD_CONDITIONS = [
  'NEAR_MINT',
  'LIGHTLY_PLAYED',
  'MODERATELY_PLAYED',
  'HEAVILY_PLAYED',
  'DAMAGED',
  'UNKNOWN',
] as const;
export const cardConditionSchema = z.enum(CARD_CONDITIONS);
export type CardCondition = z.infer<typeof cardConditionSchema>;

// ============================================================
// Error envelope
// ============================================================

/**
 * Standard error code enum. Mirrors
 * `context/conventions.md` § "Error handling" and is referenced
 * by the discriminated-union result envelope below.
 *
 * `RATE_LIMIT` is included because the eBay-Browse and TCGdex
 * adapters surface upstream 429s; the user-facing error map
 * should distinguish "we hit a limit, retry" from "INTERNAL".
 */
export const API_ERROR_CODES = [
  'VALIDATION',
  'AUTH',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMIT',
  'INTERNAL',
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1, 'error.message must be non-empty'),
    /**
     * Free-form detail payload — typically a list of zod issues
     * for `'VALIDATION'` errors, the offending resource id for
     * `'NOT_FOUND'`, etc. Consumers MUST treat this as `unknown`
     * and not rely on a stable shape.
     */
    details: z.unknown().optional(),
  })
  .strict();
export type ApiError = z.infer<typeof apiErrorSchema>;

// ============================================================
// Discriminated-union result envelope
// ============================================================

/**
 * The wire shape every Edge Function / API route returns.
 * Consumers narrow on `.ok` and read `.data` or `.error`
 * accordingly — the api-client (T-BE-API-CLIENT) wraps this
 * unwrap at the call site.
 *
 * Implemented as a generic factory so callers can plug in their
 * `data` schema while keeping zod's runtime validation intact.
 *
 * Usage:
 *
 * ```ts
 * const cardResult = apiResultSchema(cardDto);
 * type CardResult = z.infer<typeof cardResult>;
 * //   = { ok: true; data: CardDto } | { ok: false; error: ApiError }
 * ```
 */
export function apiResultSchema<T extends z.ZodTypeAny>(
  dataSchema: T,
): z.ZodDiscriminatedUnion<
  'ok',
  [
    z.ZodObject<{ ok: z.ZodLiteral<true>; data: T }, 'strict'>,
    z.ZodObject<{ ok: z.ZodLiteral<false>; error: typeof apiErrorSchema }, 'strict'>,
  ]
> {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data: dataSchema }).strict(),
    z.object({ ok: z.literal(false), error: apiErrorSchema }).strict(),
  ]);
}

/**
 * Helper type matching `apiResultSchema(...)`'s inference.
 * Endpoint-specific result types use this directly:
 *
 * ```ts
 * type CardResult = ApiResult<CardDto>;
 * ```
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ============================================================
// Cursor pagination
// ============================================================

/**
 * Cursor-paginated response wrapper. `nextCursor` is opaque
 * base64; `null` means "this is the last page". `total` is
 * optional because not every endpoint can compute it cheaply
 * (large catalog scans skip it).
 *
 * Usage:
 *
 * ```ts
 * const cardsPage = paginatedResponseSchema(cardDto);
 * type CardsPage = z.infer<typeof cardsPage>;
 * //   = { items: CardDto[]; nextCursor: string | null; total?: number }
 * ```
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
): z.ZodObject<
  {
    items: z.ZodArray<T>;
    nextCursor: z.ZodNullable<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
  },
  'strict'
> {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: z.string().nullable(),
      total: z.number().int().nonnegative().optional(),
    })
    .strict();
}

/**
 * Helper type matching `paginatedResponseSchema(...)`'s
 * inference.
 */
export type PaginatedResponse<T> = {
  items: T[];
  nextCursor: string | null;
  total?: number;
};

// ============================================================
// Cursor encode / decode helpers
// ============================================================

/**
 * Encode an opaque cursor payload for transport. Consumers
 * should treat the returned string as opaque — its internal
 * shape may change without notice. Server-side endpoints use
 * the matching `decodeCursor` to round-trip.
 *
 * Implementation: JSON-stringify then base64url-encode (no
 * padding, URL-safe alphabet) so the cursor can be passed in a
 * query string without further escaping.
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return base64UrlEncode(json);
}

/**
 * Decode a cursor previously emitted by `encodeCursor`. Throws
 * on a malformed cursor (caller decides whether to translate
 * that into an `apiError({ code: 'VALIDATION', ... })`).
 *
 * The return type is `Record<string, unknown>` — callers parse
 * with their own zod schema for the specific endpoint's cursor
 * shape (the contracts package does not own per-endpoint cursor
 * payloads; that lives next to the endpoint in T-BE-EDGE-FUNCTIONS).
 */
export function decodeCursor(cursor: string): Record<string, unknown> {
  let json: string;
  try {
    json = base64UrlDecode(cursor);
  } catch (error) {
    throw new Error(
      `decodeCursor: invalid base64url cursor (${error instanceof Error ? error.message : 'unknown'})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `decodeCursor: invalid JSON in cursor payload (${error instanceof Error ? error.message : 'unknown'})`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('decodeCursor: cursor payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
}
