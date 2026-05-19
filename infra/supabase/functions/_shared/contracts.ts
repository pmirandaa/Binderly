// Mirror of the `@binderly/api-contracts` schemas the Edge Functions
// actually need.
//
// Why mirror instead of import?
//
//   1. Production deploy story — `supabase functions deploy` bundles
//      the function and its dependency graph. Pulling
//      `@binderly/api-contracts` into the bundle requires either a
//      relative-path workspace import (brittle once we have multiple
//      functions and the relative depth differs) or a published
//      package (we don't publish). Mirroring the small subset we need
//      keeps the bundle self-contained.
//
//   2. Bounded surface — the Edge Function only needs the WRITE
//      schemas (request bodies); read-side DTOs live on the client
//      side. Importing the whole barrel pulls in shareable / pricing /
//      grading / cards schemas the function never uses.
//
// **Drift control** — the corresponding contract test in
// `contracts.test.ts` round-trips representative payloads through both
// this file's schemas and the canonical ones in
// `packages/api-contracts/src/collection.ts` (read at test time via
// the workspace path). If a key differs, the test fails. Update both
// files in the same PR; the test enforces lockstep.

import { z } from 'zod';

// ============================================================
// Primitives — mirror of `api-contracts/common.ts`
// ============================================================

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z.string().date();

const numericString2dpSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'expected decimal string with up to 2 fractional digits');

const isoDateTimeSchema = z.string().datetime({ offset: true });

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'expected ISO-4217 alpha-3 code');

export const CARD_CONDITIONS = [
  'NEAR_MINT',
  'LIGHTLY_PLAYED',
  'MODERATELY_PLAYED',
  'HEAVILY_PLAYED',
  'DAMAGED',
  'UNKNOWN',
] as const;
export const cardConditionSchema = z.enum(CARD_CONDITIONS);

export const COLLECTION_ITEM_SOURCES = ['manual', 'scan', 'import'] as const;
export const collectionItemSourceSchema = z.enum(COLLECTION_ITEM_SOURCES);

export const GRADE_COMPANIES = ['PSA', 'BGS', 'CGC'] as const;
export const gradeCompanySchema = z.enum(GRADE_COMPANIES);

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected lowercase kebab-case slug');

// ============================================================
// `collection_item` write schemas — mirror of
// `api-contracts/collection.ts`
// ============================================================

export const addCollectionItemRequest = z
  .object({
    printingId: uuidSchema,
    quantity: z.number().int().min(1).optional(),
    condition: cardConditionSchema.optional(),
    gradeCompany: gradeCompanySchema.nullish(),
    grade: z.number().min(1).max(10).nullish(),
    acquiredAt: isoDateSchema.nullish(),
    acquiredPrice: z.number().nonnegative().nullish(),
    acquiredCurrency: currencyCodeSchema.nullish(),
    notes: z.string().nullish(),
    photoUrls: z.array(z.string().url()).optional(),
    source: collectionItemSourceSchema.optional(),
  })
  .strict();
export type AddCollectionItemRequest = z.infer<typeof addCollectionItemRequest>;

export const updateCollectionItemRequest = z
  .object({
    quantity: z.number().int().min(1).optional(),
    condition: cardConditionSchema.optional(),
    gradeCompany: gradeCompanySchema.nullish(),
    grade: z.number().min(1).max(10).nullish(),
    acquiredAt: isoDateSchema.nullish(),
    acquiredPrice: z.number().nonnegative().nullish(),
    acquiredCurrency: currencyCodeSchema.nullish(),
    notes: z.string().nullish(),
    photoUrls: z.array(z.string().url()).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updateCollectionItemRequest body must include at least one field',
  });
export type UpdateCollectionItemRequest = z.infer<typeof updateCollectionItemRequest>;

/**
 * Bulk-update payload — owned by this task; not yet in
 * `@binderly/api-contracts` (the api-client doesn't expose a bulk
 * method as of T-BE-API-CLIENT). The shape is "an array of
 * `{ id, patch }` items", each item a `(uuid, updateCollectionItemRequest)`
 * pair, with a length cap so a misbehaving client can't queue a
 * 100k-row write.
 *
 * If the api-client grows a `bulkUpdateCollection` method later, the
 * contract should move to `api-contracts` and this mirror should be
 * deleted in favor of the imported version. Documented in the README.
 */
export const bulkUpdateCollectionRequest = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuidSchema,
            patch: updateCollectionItemRequest,
          })
          .strict(),
      )
      .min(1, 'bulk update requires at least one item')
      .max(100, 'bulk update is capped at 100 items per request'),
  })
  .strict();
export type BulkUpdateCollectionRequest = z.infer<typeof bulkUpdateCollectionRequest>;

// ============================================================
// `custom_collection` write schemas
// ============================================================

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
      expression: z.custom<unknown>((value) => value !== undefined, {
        message: 'expression is required',
      }),
    })
    .strict(),
]);
export type CreateCustomCollectionRequest = z.infer<typeof createCustomCollectionRequest>;

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

export const addPrintingToCustomCollectionRequest = z
  .object({
    printingId: uuidSchema,
  })
  .strict();
export type AddPrintingToCustomCollectionRequest = z.infer<
  typeof addPrintingToCustomCollectionRequest
>;

export const updateSmartCollectionExpressionRequest = z
  .object({
    expression: z.custom<unknown>((value) => value !== undefined, {
      message: 'expression is required',
    }),
  })
  .strict();
export type UpdateSmartCollectionExpressionRequest = z.infer<
  typeof updateSmartCollectionExpressionRequest
>;

// ============================================================
// Shared DTO field shapes — re-exported for handlers
// ============================================================

export {
  isoDateTimeSchema as wireIsoDateTimeSchema,
  numericString2dpSchema as wireNumericString2dpSchema,
};

// ============================================================
// Smart-collection preview — request body mirror
// ============================================================
//
// The smart-collection DSL package (`@binderly/smart-collection-dsl`)
// owns the AST schema; the Edge Function bundle does NOT pull it in
// (the deno.jsonc import-map is npm-only and the dsl is a workspace
// package). We mirror just the leaf node shapes here — the same
// shape `smart_collection_rule.expression` already stores as opaque
// `jsonb` — so the preview handler can validate the AST structurally
// without compiling SQL.
//
// The compiler step happens inside the handler too: we translate
// each leaf into a PostgREST filter via the supabase-js builder
// rather than executing the dsl's `expressionToSql()` (which would
// require raw SQL execution against the DB, not available through
// the supabase-js boundary). Limitations:
//
//   - `collection.*` predicates are explicitly rejected by the
//     preview endpoint (the editor surfaces them only on the
//     "save" path, not on preview). The mirror schema rejects
//     them via a `superRefine`.
//   - `enumArray` fields use PostgREST's `cs` (contains) operator
//     for `eq`, and `ov` (overlaps) for `in`.

const ALLOWED_PREVIEW_FIELDS = [
  'card.name',
  'card.number',
  'card.illustrator',
  'card.language',
  'card.type',
  'card.subtype',
  'card.rarity',
  'card.hp',
  'card.retreatCost',
  'set.code',
  'set.name',
  'set.series',
  'set.language',
  'set.releaseDate',
  'set.printedTotal',
  'set.total',
  'printing.variantClass',
  'printing.variantFlags',
  'printing.variantCode',
  'printing.includeInMasterSet',
] as const;

export type SmartPreviewField = (typeof ALLOWED_PREVIEW_FIELDS)[number];

const previewFieldSchema = z.enum(
  ALLOWED_PREVIEW_FIELDS as unknown as readonly [SmartPreviewField, ...SmartPreviewField[]],
);

const previewScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const previewRangeBoundSchema = z.union([z.number(), z.string()]);

const previewEqNodeSchema = z
  .object({
    type: z.literal('eq'),
    field: previewFieldSchema,
    value: previewScalarSchema,
  })
  .strict();

const previewInNodeSchema = z
  .object({
    type: z.literal('in'),
    field: previewFieldSchema,
    values: z.array(previewScalarSchema).min(1, '`in` values must be non-empty'),
  })
  .strict();

const previewRangeNodeSchema = z
  .object({
    type: z.literal('range'),
    field: previewFieldSchema,
    min: previewRangeBoundSchema.optional(),
    max: previewRangeBoundSchema.optional(),
    minInclusive: z.boolean().optional(),
    maxInclusive: z.boolean().optional(),
  })
  .strict();
// NOTE: the "at least one of `min` / `max`" rule is enforced via the
// top-level `superRefine` on `smartPreviewRequest` below.
// `z.discriminatedUnion` rejects `ZodEffects` branches (wrapping
// `.refine()` produces `ZodEffects<ZodObject<...>>`), so we keep the
// branch pure and lift the cross-field rule to the outer schema.

const previewExistsNodeSchema = z
  .object({
    type: z.literal('exists'),
    field: previewFieldSchema,
    exists: z.boolean(),
  })
  .strict();

/**
 * The recursive expression AST mirror — `and` / `or` / `not` plus
 * the four leaf node types above. Mirrors
 * `@binderly/smart-collection-dsl`'s `expressionSchema` minus the
 * cross-field type-matching refinements (we do those at SQL build
 * time below — a malformed leaf surfaces as a clearer "value type X
 * is not valid for field Y" error there).
 */
export const previewExpressionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('and'),
        children: z.array(previewExpressionSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal('or'),
        children: z.array(previewExpressionSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal('not'),
        child: previewExpressionSchema,
      })
      .strict(),
    previewEqNodeSchema,
    previewInNodeSchema,
    previewRangeNodeSchema,
    previewExistsNodeSchema,
  ]),
);

/**
 * Request body for `POST /v1/smart-collections/preview`. Mirror of
 * `smartPreviewRequestDto` in `packages/api-contracts/src/collection.ts`.
 *
 * `expression` is structurally validated against `previewExpressionSchema`;
 * the legal field set rejects `collection.*` fields (see
 * `ALLOWED_PREVIEW_FIELDS` above) — those are server-evaluated on
 * the save path only, not on preview.
 *
 * `limit` defaults to 200, capped at 500. `offset` defaults to 0.
 */
export const smartPreviewRequest = z
  .object({
    expression: previewExpressionSchema,
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    walkRangeRules(value.expression, ctx, ['expression']);
  });
export type SmartPreviewRequest = z.infer<typeof smartPreviewRequest>;

function walkRangeRules(
  node: unknown,
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  if (typeof node !== 'object' || node === null) return;
  const n = node as { type?: string; children?: unknown[]; child?: unknown };
  if (n.type === 'and' || n.type === 'or') {
    const children = Array.isArray(n.children) ? n.children : [];
    children.forEach((child, idx) => walkRangeRules(child, ctx, [...path, 'children', idx]));
    return;
  }
  if (n.type === 'not') {
    walkRangeRules(n.child, ctx, [...path, 'child']);
    return;
  }
  if (n.type === 'range') {
    const r = node as { min?: unknown; max?: unknown };
    if (r.min === undefined && r.max === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path],
        message: '`range` requires at least one of `min` or `max`',
      });
    }
  }
}
