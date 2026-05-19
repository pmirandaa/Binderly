// User-collection DTOs — both READ shapes (responses) and WRITE
// shapes (request bodies for add / update / create operations).
//
// Mirrors the Drizzle user-tables in `packages/db/src/schema/`:
//
//   - `collection_item` (`collections.ts`)
//   - `custom_collection` + `custom_collection_item`
//     (`custom_collections.ts`)
//   - `smart_collection_rule` (`smart_rules.ts`)
//
// Server-side validation per `rules/02-backend.md`: every write
// schema is `.strict()` so unknown keys are rejected at the API
// boundary. The DB column itself is permissive `text`, but
// validation lives at the API layer (the schema comments in
// `collections.ts` and `custom_collections.ts` both explicitly
// defer enum checking here).

import { z } from 'zod';

import {
  cardConditionSchema,
  isoDateSchema,
  isoDateTimeSchema,
  numericString2dpSchema,
  uuidSchema,
} from './common.js';

// ============================================================
// collection_item — the per-physical-instance row
// ============================================================

/**
 * Source of a `collection_item` row — `'manual'` (user typed it
 * in or used the search-and-add flow), `'scan'` (the scanner
 * pipeline added it), `'import'` (CSV / JSON import). Default
 * `'manual'` per `collections.ts`.
 */
export const COLLECTION_ITEM_SOURCES = ['manual', 'scan', 'import'] as const;
export const collectionItemSourceSchema = z.enum(COLLECTION_ITEM_SOURCES);
export type CollectionItemSource = z.infer<typeof collectionItemSourceSchema>;

/**
 * Grading-company enum. Matches the columns
 * `collection_item.grade_company` and the values surfaced in
 * `context/data-model.md` § "collection_item" (`'PSA' | 'BGS' |
 * 'CGC' | null`). `null` means "raw" (no slab).
 */
export const GRADE_COMPANIES = ['PSA', 'BGS', 'CGC'] as const;
export const gradeCompanySchema = z.enum(GRADE_COMPANIES);
export type GradeCompany = z.infer<typeof gradeCompanySchema>;

/**
 * Read-side wire shape for a `collection_item` row.
 *
 * - `userId` is exposed because RLS already gates rows to the
 *   owner; the consumer's typed cache benefits from having the
 *   identifier explicitly.
 * - `grade` is a `numeric(3,1)` column → string on the wire (see
 *   `common.ts` `numericString2dpSchema` — covers both 1dp grade
 *   values like `'9.5'` and the `'10.0'` whole-number case).
 * - `acquiredPrice` is `numeric(10,2)` → string.
 * - `photoUrls` is always-non-null array (DB default `'{}'::text[]`).
 */
export const collectionItemDto = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    printingId: uuidSchema,
    quantity: z.number().int().min(1),
    condition: cardConditionSchema,
    gradeCompany: gradeCompanySchema.nullable(),
    grade: numericString2dpSchema.nullable(),
    acquiredAt: isoDateSchema.nullable(),
    acquiredPrice: numericString2dpSchema.nullable(),
    acquiredCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    notes: z.string().nullable(),
    photoUrls: z.array(z.string().url()),
    source: collectionItemSourceSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type CollectionItemDto = z.infer<typeof collectionItemDto>;

/**
 * Add a `collection_item` row. `quantity` defaults to 1 server-
 * side; `condition` defaults to `'NEAR_MINT'`. `userId` is NOT
 * accepted from the wire — the server reads it from the
 * authenticated session.
 *
 * `grade` arrives as a number on the wire (clients send JSON
 * numbers; the server converts to `numeric` at insert time).
 */
export const addCollectionItemRequest = z
  .object({
    printingId: uuidSchema,
    quantity: z.number().int().min(1).optional(),
    condition: cardConditionSchema.optional(),
    gradeCompany: gradeCompanySchema.nullish(),
    grade: z.number().min(1).max(10).nullish(),
    acquiredAt: isoDateSchema.nullish(),
    acquiredPrice: z.number().nonnegative().nullish(),
    acquiredCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullish(),
    notes: z.string().nullish(),
    photoUrls: z.array(z.string().url()).optional(),
    source: collectionItemSourceSchema.optional(),
  })
  .strict();
export type AddCollectionItemRequest = z.infer<typeof addCollectionItemRequest>;

/**
 * Patch a `collection_item` row. Every field is optional;
 * missing means "don't change". Server-side validation rejects a
 * fully-empty body to avoid no-op writes.
 */
export const updateCollectionItemRequest = z
  .object({
    quantity: z.number().int().min(1).optional(),
    condition: cardConditionSchema.optional(),
    gradeCompany: gradeCompanySchema.nullish(),
    grade: z.number().min(1).max(10).nullish(),
    acquiredAt: isoDateSchema.nullish(),
    acquiredPrice: z.number().nonnegative().nullish(),
    acquiredCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullish(),
    notes: z.string().nullish(),
    photoUrls: z.array(z.string().url()).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updateCollectionItemRequest body must include at least one field',
  });
export type UpdateCollectionItemRequest = z.infer<typeof updateCollectionItemRequest>;

// ============================================================
// custom_collection — manual + smart
// ============================================================

/**
 * Custom-collection kind. Manual collections persist their
 * members via `custom_collection_item`; smart collections
 * compute their members from `smart_collection_rule.expression`.
 */
export const CUSTOM_COLLECTION_KINDS = ['manual', 'smart'] as const;
export const customCollectionKindSchema = z.enum(CUSTOM_COLLECTION_KINDS);
export type CustomCollectionKind = z.infer<typeof customCollectionKindSchema>;

/**
 * URL-safe slug per `custom_collection.slug`. Lowercase
 * alphanumeric + hyphens. The DB column itself is plain `text`
 * (no CHECK), but the API layer enforces a slug shape so the
 * shareable URL `/c/{handle}/{slug}` is always well-formed.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected lowercase kebab-case slug');

/**
 * Read-side wire shape for a `custom_collection` row.
 */
export const customCollectionDto = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    name: z.string().min(1),
    slug: slugSchema,
    kind: customCollectionKindSchema,
    description: z.string().nullable(),
    coverUrl: z.string().url().nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type CustomCollectionDto = z.infer<typeof customCollectionDto>;

/**
 * Read-side wire shape for a `custom_collection_item` row (the
 * join row for manual collections).
 */
export const customCollectionItemDto = z
  .object({
    customCollectionId: uuidSchema,
    printingId: uuidSchema,
    addedAt: isoDateTimeSchema,
  })
  .strict();
export type CustomCollectionItemDto = z.infer<typeof customCollectionItemDto>;

/**
 * Field validator for the smart-collection expression payload.
 * `z.unknown()` and `z.any()` both treat the field as optional;
 * we want "must be present, may be any JSON value the smart-DSL
 * package will later parse". `z.custom` lets us enforce
 * presence without falling out of the discriminated union
 * (`.refine()` on a branch wraps it in `ZodEffects` which
 * `z.discriminatedUnion` rejects).
 */
const smartExpressionSchema = z.custom<unknown>((value) => value !== undefined, {
  message: 'expression is required',
});

/**
 * Create a manual or smart custom collection. For `kind:
 * 'smart'`, the `expression` is the DSL AST owned by
 * T-SP-SMART-DSL — we pass it through as `unknown` here so the
 * smart-DSL package can ratify the shape when it lands. (The
 * DB column itself is plain `jsonb`; this matches the schema's
 * own posture in `smart_rules.ts`.)
 *
 * Server-side per `rules/02-backend.md`: free tier allows 3
 * manual + 0 smart; paid allows unlimited. The contract
 * package describes the shape; the gating is enforced in
 * T-BE-EDGE-FUNCTIONS.
 */
export const createCustomCollectionRequest = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('manual'),
      name: z.string().min(1).max(120),
      slug: slugSchema,
      description: z.string().max(500).nullish(),
      coverUrl: z.string().url().nullish(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('smart'),
      name: z.string().min(1).max(120),
      slug: slugSchema,
      description: z.string().max(500).nullish(),
      coverUrl: z.string().url().nullish(),
      expression: smartExpressionSchema,
    })
    .strict(),
]);
export type CreateCustomCollectionRequest = z.infer<typeof createCustomCollectionRequest>;

/**
 * Patch a custom collection. Renaming, re-slugging, swapping
 * cover image. The `kind` is immutable (changing manual →
 * smart or vice versa would require migrating rows; not in
 * scope for v1). Smart-collection expression edits go through
 * the dedicated `updateSmartCollectionExpressionRequest` below.
 */
export const updateCustomCollectionRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: slugSchema.optional(),
    description: z.string().max(500).nullish(),
    coverUrl: z.string().url().nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updateCustomCollectionRequest body must include at least one field',
  });
export type UpdateCustomCollectionRequest = z.infer<typeof updateCustomCollectionRequest>;

/**
 * Add a printing to a manual custom collection. Idempotent on
 * (custom_collection_id, printing_id) per the schema's PK; the
 * server returns a `'CONFLICT'` error if the printing is
 * already in the collection.
 */
export const addPrintingToCustomCollectionRequest = z
  .object({
    printingId: uuidSchema,
  })
  .strict();
export type AddPrintingToCustomCollectionRequest = z.infer<
  typeof addPrintingToCustomCollectionRequest
>;

// ============================================================
// smart_collection_rule
// ============================================================

/**
 * Read-side wire shape for a `smart_collection_rule` row. The
 * `expression` is opaque `unknown` — the DSL schema is owned by
 * T-SP-SMART-DSL and ratified there. UIs that need to render
 * the expression import the smart-DSL package separately and
 * parse with its schema.
 */
export const smartCollectionRuleDto = z
  .object({
    customCollectionId: uuidSchema,
    expression: z.unknown(),
    lastEvaluatedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type SmartCollectionRuleDto = z.infer<typeof smartCollectionRuleDto>;

/**
 * Replace the expression on an existing smart collection. The
 * expression is opaque here (see `smartCollectionRuleDto`).
 * Server-side parses with the smart-DSL schema before writing.
 */
export const updateSmartCollectionExpressionRequest = z
  .object({
    expression: smartExpressionSchema,
  })
  .strict();
export type UpdateSmartCollectionExpressionRequest = z.infer<
  typeof updateSmartCollectionExpressionRequest
>;

// ============================================================
// Collection completion — read DTOs
// ============================================================

/**
 * One row in the `perSet` array returned by
 * `GET /v1/me/collection/completion`. Field names mirror the
 * `mv_user_set_completion` materialized view documented in
 * `context/data-model.md` § "Materialized views" with the
 * addition of `setCode` / `setName` so the home-screen list
 * doesn't need to fan out a second `getSet(id)` per row.
 *
 * Percentages are in the 0..100 range as plain `number`s (not
 * strings) — the endpoint computes them as JavaScript floats
 * and the home-screen UI renders one decimal place. Empty /
 * zero-denominator sets carry `setPct: 0` / `masterPct: 0`
 * (never NaN) per the `@binderly/set-completion` contract.
 */
export const perSetCompletionEntryDto = z
  .object({
    setId: uuidSchema,
    setCode: z.string().min(1),
    setName: z.string().min(1),
    setPct: z.number().min(0).max(100),
    masterPct: z.number().min(0).max(100),
    ownedNumbered: z.number().int().nonnegative(),
    totalNumbered: z.number().int().nonnegative(),
    ownedMaster: z.number().int().nonnegative(),
    totalMaster: z.number().int().nonnegative(),
  })
  .strict();
export type PerSetCompletionEntryDto = z.infer<typeof perSetCompletionEntryDto>;

/**
 * The cross-catalog tally — mirrors `mv_user_global_completion`.
 * Same 0..100 rule for the two percentage fields.
 */
export const globalCompletionDto = z
  .object({
    allPokemonPct: z.number().min(0).max(100),
    masterPct: z.number().min(0).max(100),
    uniqueCardsOwned: z.number().int().nonnegative(),
    uniqueCardsTotal: z.number().int().nonnegative(),
    masterOwned: z.number().int().nonnegative(),
    masterTotal: z.number().int().nonnegative(),
  })
  .strict();
export type GlobalCompletionDto = z.infer<typeof globalCompletionDto>;

/**
 * Top-level response shape for `GET /v1/me/collection/completion`.
 * `perSet` is sorted by `setName` ascending so the home screen can
 * render the list without a second sort pass. Empty collection →
 * `perSet: []` (the empty array, not zero-rows-per-set) and
 * `global` all-zero — the home screen distinguishes "you own
 * nothing yet" from "we couldn't compute" via the API error
 * envelope rather than via an empty `perSet`.
 *
 * `lastUpdatedAt` is the maximum `collection_item.updated_at`
 * across the user's collection, or `null` if the collection is
 * empty. Used by client caches for stale-while-revalidate.
 */
export const completionDto = z
  .object({
    global: globalCompletionDto,
    perSet: z.array(perSetCompletionEntryDto),
    lastUpdatedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type CompletionDto = z.infer<typeof completionDto>;

// ============================================================
// Smart-collection preview — read DTOs
// ============================================================

/**
 * Smart-collection preview request body. The `expression` is the
 * DSL AST (the same shape stored in `smart_collection_rule.expression`);
 * shape validation happens server-side via the smart-DSL schema
 * mirror — the contracts package keeps the field opaque so the
 * smart-DSL dependency is not pulled into every consumer.
 *
 * `limit` defaults to 200 server-side (max 500). `offset`
 * defaults to 0. The endpoint clamps `limit` to the documented
 * max rather than throwing — callers can ask for `limit: 1000`
 * and silently receive 500 rows.
 */
export const smartPreviewRequestDto = z
  .object({
    expression: smartExpressionSchema,
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
export type SmartPreviewRequestDto = z.infer<typeof smartPreviewRequestDto>;

/**
 * One row in the `items` array of the preview response — the
 * narrow projection of a `printing` joined to its `card` and
 * `set` the smart-collection UI's "matching printings" grid
 * renders. NOT a full `printingDto` — only the columns the grid
 * actually displays, to keep the wire size bounded for the
 * 500-row max page.
 */
export const smartPreviewItemDto = z
  .object({
    printingId: uuidSchema,
    cardId: uuidSchema,
    setId: uuidSchema,
    cardName: z.string().min(1),
    cardNumber: z.string().min(1),
    setName: z.string().min(1),
    setCode: z.string().min(1),
    variantLabel: z.string(),
    imageSmallUrl: z.string().url().nullable(),
  })
  .strict();
export type SmartPreviewItemDto = z.infer<typeof smartPreviewItemDto>;

/**
 * Response envelope for `POST /v1/smart-collections/preview`.
 *
 * - `items` — the page's matching printings (≤ `limit`).
 * - `totalCount` — total matching printings across the catalog
 *   (NOT just this page). The endpoint computes this with a
 *   second `count()` query so the UI can render "showing X of Y".
 *   For very large result sets the count may be approximate (the
 *   handler caps the count query at 100k for performance — see
 *   the handler's docstring); approximate counts are signalled
 *   by `totalCount === 100000 && nextOffset !== null` (UI shows
 *   "100,000+").
 * - `nextOffset` — `offset + items.length` if more rows exist,
 *   `null` if the page is the last.
 */
export const smartPreviewResponseDto = z
  .object({
    items: z.array(smartPreviewItemDto),
    totalCount: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type SmartPreviewResponseDto = z.infer<typeof smartPreviewResponseDto>;
