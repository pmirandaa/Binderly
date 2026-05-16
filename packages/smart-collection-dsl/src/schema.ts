// Canonical zod schema for the Smart Collection DSL.
//
// `expressionSchema` is the source of truth that
// `@binderly/api-contracts`' `smartExpressionSchema` will eventually
// delegate to (see the README for the wiring task). Validates:
//
//   - Structural shape — every node has the right keys and types.
//   - Field allowlist — `field` is one of the names in
//     `FIELD_DEFS`. Unknown fields are rejected at parse time.
//   - Operand type-matching — `eq` / `in` values match the field's
//     kind; `range` is only valid on numeric / date fields; `exists`
//     is only valid on nullable fields and the synthetic
//     `collection.isOwned`.
//   - Max nesting depth — 8 levels (configurable). Prevents
//     pathological inputs from blowing up the evaluator or the SQL
//     compiler.
//
// Implementation notes. The structural validation uses
// `z.discriminatedUnion('type', ...)` for fast, narrow error
// messages. Per-leaf operand-type checks (e.g. "`range` only on
// numeric/date fields") happen in a single top-level
// `superRefine` walk after the structural pass — keeping the
// discriminator branches as plain `ZodObject`s (which is what
// `discriminatedUnion` requires) and centralizing the cross-field
// rules.
//
// The schema does NOT normalize — flattening of nested AND/OR and
// double-NOT collapsing happens in `parse.ts`. We deliberately keep
// the zod schema "shape-only + cross-field rules" so `safeParse`
// can be used for fast validation without producing a normalized
// result.

import { z } from 'zod';

import {
  FIELDS,
  getFieldDef,
  type Expression,
  type Field,
  type FieldDef,
  type FieldKind,
} from './types.js';

// ============================================================
// Constants
// ============================================================

/**
 * Maximum nesting depth allowed in a parsed expression. The
 * smart-collection editor UI is unlikely to produce anything deeper
 * than 4–5 levels in practice; the limit exists as a guardrail
 * against pathological input rather than a real product
 * constraint.
 */
export const DEFAULT_MAX_DEPTH = 8;

// ============================================================
// Primitive validators
// ============================================================

/**
 * ISO calendar date (`YYYY-MM-DD`). Used by the `date`-kinded
 * fields' RANGE bounds and EQ values. Mirrors
 * `@binderly/api-contracts`' `isoDateSchema` shape (kept local
 * to avoid the contracts package re-exporting an evaluator-internal
 * primitive).
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_REGEX.test(value);
}

/**
 * Field-name validator. Reused by every leaf node. Refines the
 * string into the typed `Field` literal union for downstream
 * type-narrowing.
 */
const fieldSchema = z
  .enum(FIELDS as unknown as readonly [Field, ...Field[]])
  .describe('one of the smart-collection DSL allowlist field names');

// ============================================================
// Node schemas (structural)
// ============================================================

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const rangeBoundSchema = z.union([z.number(), z.string()]);

const eqNodeSchema = z
  .object({
    type: z.literal('eq'),
    field: fieldSchema,
    value: scalarSchema,
  })
  .strict();

const inNodeSchema = z
  .object({
    type: z.literal('in'),
    field: fieldSchema,
    values: z.array(scalarSchema).min(1, '`in` values must be non-empty'),
  })
  .strict();

const rangeNodeSchema = z
  .object({
    type: z.literal('range'),
    field: fieldSchema,
    min: rangeBoundSchema.optional(),
    max: rangeBoundSchema.optional(),
    minInclusive: z.boolean().optional(),
    maxInclusive: z.boolean().optional(),
  })
  .strict();

const existsNodeSchema = z
  .object({
    type: z.literal('exists'),
    field: fieldSchema,
    exists: z.boolean(),
  })
  .strict();

const expressionShape: z.ZodType<Expression> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('and'),
        children: z
          .array(expressionShape)
          .min(1, '`and.children` must be non-empty (use no rule to mean "always true")'),
      })
      .strict(),
    z
      .object({
        type: z.literal('or'),
        children: z
          .array(expressionShape)
          .min(1, '`or.children` must be non-empty (use no rule to mean "always false")'),
      })
      .strict(),
    z
      .object({
        type: z.literal('not'),
        child: expressionShape,
      })
      .strict(),
    eqNodeSchema,
    inNodeSchema,
    rangeNodeSchema,
    existsNodeSchema,
  ]),
);

// ============================================================
// Cross-field semantic walk
// ============================================================

/**
 * Walks a structurally-valid expression and reports operand-type
 * mismatches as zod issues. Pushes onto `ctx`.
 *
 * Pure (no IO). Path is the JSON-path prefix the caller already
 * consumed; this function appends to it as it descends.
 */
function walkSemantics(expr: Expression, ctx: z.RefinementCtx, path: (string | number)[]): void {
  switch (expr.type) {
    case 'and':
    case 'or':
      expr.children.forEach((child, idx) => {
        walkSemantics(child, ctx, [...path, 'children', idx]);
      });
      return;
    case 'not':
      walkSemantics(expr.child, ctx, [...path, 'child']);
      return;
    case 'eq':
      checkScalarMatchesField(expr.field, expr.value, ctx, [...path, 'value']);
      return;
    case 'in':
      expr.values.forEach((value, idx) => {
        checkScalarMatchesField(expr.field, value, ctx, [...path, 'values', idx]);
      });
      return;
    case 'range': {
      const def = getFieldDef(expr.field);
      if (def.kind !== 'number' && def.kind !== 'date') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, 'field'],
          message: `\`range\` is only valid on number/date fields; \`${expr.field}\` is ${def.kind}`,
        });
        return;
      }
      if (expr.min === undefined && expr.max === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: '`range` requires at least one of `min` or `max`',
        });
      }
      if (expr.min !== undefined) {
        checkRangeBoundMatchesField(def.kind, expr.min, ctx, [...path, 'min']);
      }
      if (expr.max !== undefined) {
        checkRangeBoundMatchesField(def.kind, expr.max, ctx, [...path, 'max']);
      }
      if (expr.min !== undefined && expr.max !== undefined && typeof expr.min === typeof expr.max) {
        // Lexicographic compare works for ISO dates and natural
        // for numbers.
        const ok =
          typeof expr.min === 'number'
            ? (expr.min as number) <= (expr.max as number)
            : (expr.min as string) <= (expr.max as string);
        if (!ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: '`range.min` must be <= `range.max`',
          });
        }
      }
      return;
    }
    case 'exists': {
      const def = getFieldDef(expr.field);
      if (!def.nullable && expr.field !== 'collection.isOwned') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, 'field'],
          message: `\`exists\` is only valid on nullable fields; \`${expr.field}\` is non-nullable`,
        });
      }
      return;
    }
  }
}

function checkScalarMatchesField(
  field: Field,
  value: string | number | boolean,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  const def = getFieldDef(field);
  switch (def.kind) {
    case 'string':
      if (typeof value !== 'string') {
        addKindMismatch(ctx, path, def, typeofValue(value));
      }
      return;
    case 'enum':
    case 'enumArray': {
      if (typeof value !== 'string') {
        addKindMismatch(ctx, path, def, typeofValue(value));
        return;
      }
      if (!def.enumValues.includes(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `\`${value}\` is not a valid value for \`${field}\` (expected one of: ${def.enumValues.join(', ')})`,
        });
      }
      return;
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        addKindMismatch(ctx, path, def, typeofValue(value));
      }
      return;
    case 'date':
      if (!isIsoDate(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `\`${field}\` requires an ISO date in YYYY-MM-DD form; got \`${String(value)}\``,
        });
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        addKindMismatch(ctx, path, def, typeofValue(value));
      }
      return;
  }
}

function checkRangeBoundMatchesField(
  kind: 'number' | 'date',
  bound: number | string,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (kind === 'number') {
    if (typeof bound !== 'number' || !Number.isFinite(bound)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: '`range` bound must be a finite number',
      });
    }
    return;
  }
  if (!isIsoDate(bound)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `\`range\` date bound must be in YYYY-MM-DD form; got \`${String(bound)}\``,
    });
  }
}

function addKindMismatch(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  def: FieldDef,
  actual: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: `field of kind \`${def.kind}\` expects ${expectedTypeFor(def.kind)} but got ${actual}`,
  });
}

function expectedTypeFor(kind: FieldKind): string {
  switch (kind) {
    case 'string':
      return 'string';
    case 'enum':
    case 'enumArray':
      return 'string (enum value)';
    case 'number':
      return 'number';
    case 'date':
      return 'ISO date string';
    case 'boolean':
      return 'boolean';
  }
}

function typeofValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ============================================================
// Depth checking
// ============================================================

/**
 * Walks the AST and returns the maximum nesting depth. A leaf node
 * counts as depth 1; each AND/OR/NOT layer adds 1.
 */
export function expressionDepth(expr: Expression): number {
  switch (expr.type) {
    case 'and':
    case 'or': {
      if (expr.children.length === 0) return 1;
      let max = 0;
      for (const child of expr.children) {
        const d = expressionDepth(child);
        if (d > max) max = d;
      }
      return 1 + max;
    }
    case 'not':
      return 1 + expressionDepth(expr.child);
    case 'eq':
    case 'in':
    case 'range':
    case 'exists':
      return 1;
  }
}

// ============================================================
// Top-level schema
// ============================================================

/**
 * Top-level schema. Applies the structural validation, then walks
 * the AST to enforce the cross-field semantic rules and the
 * max-depth refinement.
 */
export const expressionSchema: z.ZodType<Expression> = expressionSchemaWithDepth(DEFAULT_MAX_DEPTH);

/**
 * Schema factory that lets callers tune the max-depth refinement.
 * Used by tests to verify the refinement triggers at the boundary.
 */
export function expressionSchemaWithDepth(maxDepth: number): z.ZodType<Expression> {
  return expressionShape.superRefine((value, ctx) => {
    walkSemantics(value, ctx, []);
    const depth = expressionDepth(value);
    if (depth > maxDepth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expression nesting depth ${depth} exceeds maximum ${maxDepth}`,
      });
    }
  }) as z.ZodType<Expression>;
}
