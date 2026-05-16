// Compile a Smart Collection DSL expression to a parameterized
// Postgres `WHERE`-clause fragment.
//
// Contract: the compiler returns `{ sql, params }`. `params` is a
// dense array of values; `sql` references them as `$1`, `$2`, …
// matching the indices into `params`. **No user-controlled value is
// ever inlined into `sql`.** This is the load-bearing safety
// property of the package — the tests verify it for every operator
// + every value shape (including a `'; DROP TABLE` payload).
//
// The caller is responsible for the FROM clause + joins. By default
// the compiler emits column references like `card.name`,
// `printing.variant_class`, `collection_item.condition`. Callers
// may rebind the table aliases via the `aliases` option.
//
// NULL semantics. Every leaf comparison is wrapped in `(... ) IS
// TRUE`, which collapses NULL to FALSE before the surrounding NOT /
// AND / OR sees it. The evaluator (`evaluate.ts`) mirrors this by
// treating null/undefined operands as a false leaf result. This
// keeps the two compilers in lockstep — the round-trip property
// test verifies it on a generated corpus.
//
// `collection.isOwned` is synthetic. We compile it to
// `<collection_item.id> IS NOT NULL`, assuming the caller LEFT
// JOINed `collection_item` filtered by the current user's id. The
// compiler does NOT add the join itself — that's a query-shape
// concern that lives one layer up.

import {
  FIELD_DEFS,
  getFieldDef,
  type Expression,
  type Field,
  type FieldDef,
  type ScalarValue,
} from './types.js';

// ============================================================
// Public types
// ============================================================

/**
 * Default table-alias map. Keys are the DSL entity prefixes; values
 * are the SQL alias the caller wired up in their FROM clause.
 *
 * Default values mirror the actual table names (`card`, `set`,
 * `printing`, `collection_item`) so a caller with `FROM card JOIN
 * printing ... LEFT JOIN collection_item ...` can pass no options
 * at all.
 *
 * SQL keyword caveat: `set` is a reserved word in Postgres and must
 * be quoted as an identifier when used unaliased. The compiler
 * always emits `<alias>.<column>` so callers who use `set` without
 * an alias must quote-escape it themselves (`FROM "set" AS set`);
 * the compiler does NOT inject the quoting because the alias is
 * caller-controlled.
 */
export interface SqlAliases {
  card?: string;
  set?: string;
  printing?: string;
  collectionItem?: string;
}

export interface ExpressionToSqlOptions {
  /**
   * Override the default table aliases. See `SqlAliases`.
   */
  aliases?: SqlAliases;
  /**
   * The starting placeholder index for `$N` parameters. Defaults to
   * `1`. Callers stitching this fragment into a larger query (with
   * other parameters already declared) bump this to continue the
   * sequence.
   */
  paramIndexOffset?: number;
}

export interface ExpressionToSqlResult {
  /** The parameterized WHERE-clause fragment. Caller-wrapped in `(...)` if needed. */
  readonly sql: string;
  /** Dense array of bound parameters. `params[N-1]` corresponds to `$N`. */
  readonly params: readonly unknown[];
}

// ============================================================
// Public API
// ============================================================

/**
 * Compile an expression to a parameterized SQL fragment.
 *
 * The fragment is a self-contained boolean expression — wrap it in
 * `(...)` and combine with the caller's other WHERE clauses. The
 * empty-children case for AND/OR is impossible because the schema
 * rejects empty children lists at parse time.
 */
export function expressionToSql(
  expr: Expression,
  options: ExpressionToSqlOptions = {},
): ExpressionToSqlResult {
  const aliases = mergeAliases(options.aliases);
  const indexOffset = options.paramIndexOffset ?? 1;
  const ctx: CompileCtx = {
    aliases,
    params: [],
    indexOffset,
  };
  const sql = compile(expr, ctx);
  return { sql, params: ctx.params };
}

// ============================================================
// Internal compilation
// ============================================================

interface CompileCtx {
  readonly aliases: Required<SqlAliases>;
  readonly params: unknown[];
  readonly indexOffset: number;
}

function compile(expr: Expression, ctx: CompileCtx): string {
  switch (expr.type) {
    case 'and': {
      const parts = expr.children.map((c) => compile(c, ctx));
      return `(${parts.join(' AND ')})`;
    }
    case 'or': {
      const parts = expr.children.map((c) => compile(c, ctx));
      return `(${parts.join(' OR ')})`;
    }
    case 'not':
      return `(NOT ${compile(expr.child, ctx)})`;
    case 'eq':
      return compileEq(expr.field, expr.value, ctx);
    case 'in':
      return compileIn(expr.field, expr.values, ctx);
    case 'range':
      return compileRange(expr.field, expr, ctx);
    case 'exists':
      return compileExists(expr.field, expr.exists, ctx);
  }
}

function compileEq(field: Field, value: ScalarValue, ctx: CompileCtx): string {
  if (field === 'collection.isOwned') {
    // Synthetic — `<alias>.id IS NOT NULL` (truthy = owned).
    const col = aliasedColumn(field, ctx);
    if (value === true) return `(${col} IS NOT NULL)`;
    if (value === false) return `(${col} IS NULL)`;
    // The schema would have rejected non-boolean here, but be
    // defensive — unreachable in practice.
    return 'FALSE';
  }
  const def = getFieldDef(field);
  const col = aliasedColumn(field, ctx);
  if (def.kind === 'enumArray') {
    const placeholder = bind(ctx, value);
    return `((${placeholder} = ANY(${col})) IS TRUE)`;
  }
  const placeholder = bind(ctx, value);
  return `((${col} = ${placeholder}) IS TRUE)`;
}

function compileIn(field: Field, values: readonly ScalarValue[], ctx: CompileCtx): string {
  if (field === 'collection.isOwned') {
    const col = aliasedColumn(field, ctx);
    const wantsTrue = values.some((v) => v === true);
    const wantsFalse = values.some((v) => v === false);
    if (wantsTrue && wantsFalse) return 'TRUE';
    if (wantsTrue) return `(${col} IS NOT NULL)`;
    if (wantsFalse) return `(${col} IS NULL)`;
    return 'FALSE';
  }
  const def = getFieldDef(field);
  const col = aliasedColumn(field, ctx);
  if (def.kind === 'enumArray') {
    // Array-overlap semantics. `text[] && text[]` returns true iff
    // they share any element. Each value gets its own param.
    const placeholders = values.map((v) => bind(ctx, v));
    return `((${col} && ARRAY[${placeholders.join(', ')}]::text[]) IS TRUE)`;
  }
  // Empty `values` is rejected by the schema; we always have ≥ 1.
  const placeholders = values.map((v) => bind(ctx, v));
  return `((${col} IN (${placeholders.join(', ')})) IS TRUE)`;
}

function compileRange(
  field: Field,
  range: {
    readonly min?: number | string;
    readonly max?: number | string;
    readonly minInclusive?: boolean;
    readonly maxInclusive?: boolean;
  },
  ctx: CompileCtx,
): string {
  const col = aliasedColumn(field, ctx);
  const minInclusive = range.minInclusive ?? true;
  const maxInclusive = range.maxInclusive ?? true;
  const parts: string[] = [];
  if (range.min !== undefined) {
    const op = minInclusive ? '>=' : '>';
    parts.push(`(${col} ${op} ${bind(ctx, range.min)})`);
  }
  if (range.max !== undefined) {
    const op = maxInclusive ? '<=' : '<';
    parts.push(`(${col} ${op} ${bind(ctx, range.max)})`);
  }
  // Schema guarantees ≥ 1 bound is present.
  return `((${parts.join(' AND ')}) IS TRUE)`;
}

function compileExists(field: Field, exists: boolean, ctx: CompileCtx): string {
  const col = aliasedColumn(field, ctx);
  if (field === 'collection.isOwned') {
    // Same as `eq(collection.isOwned, exists)`.
    return exists ? `(${col} IS NOT NULL)` : `(${col} IS NULL)`;
  }
  return exists ? `(${col} IS NOT NULL)` : `(${col} IS NULL)`;
}

// ============================================================
// Helpers
// ============================================================

const DEFAULT_ALIASES: Required<SqlAliases> = {
  card: 'card',
  set: 'set',
  printing: 'printing',
  collectionItem: 'collection_item',
};

function mergeAliases(overrides: SqlAliases | undefined): Required<SqlAliases> {
  if (!overrides) return DEFAULT_ALIASES;
  return {
    card: overrides.card ?? DEFAULT_ALIASES.card,
    set: overrides.set ?? DEFAULT_ALIASES.set,
    printing: overrides.printing ?? DEFAULT_ALIASES.printing,
    collectionItem: overrides.collectionItem ?? DEFAULT_ALIASES.collectionItem,
  };
}

/**
 * Resolve a DSL field name to its fully-qualified SQL column
 * reference, applying the caller's alias overrides.
 *
 * The default alias map matches table names verbatim, so most
 * callers use the column reference unchanged.
 */
function aliasedColumn(field: Field, ctx: CompileCtx): string {
  const def: FieldDef = FIELD_DEFS[field];
  // The sql column is `<table>.<col>` — we substitute `<table>`
  // with the caller's alias.
  const dotIdx = def.sqlColumn.indexOf('.');
  if (dotIdx <= 0) return def.sqlColumn;
  const table = def.sqlColumn.slice(0, dotIdx);
  const column = def.sqlColumn.slice(dotIdx + 1);
  let alias: string;
  switch (table) {
    case 'card':
      alias = ctx.aliases.card;
      break;
    case 'set':
      alias = ctx.aliases.set;
      break;
    case 'printing':
      alias = ctx.aliases.printing;
      break;
    case 'collection_item':
      alias = ctx.aliases.collectionItem;
      break;
    default:
      alias = table;
  }
  return `${alias}.${column}`;
}

/**
 * Push a value onto the params array and return the matching
 * `$N` placeholder. The placeholder index respects the caller's
 * `paramIndexOffset` so this fragment can be stitched into a
 * larger parameterized query.
 */
function bind(ctx: CompileCtx, value: unknown): string {
  ctx.params.push(value);
  const index = ctx.indexOffset + ctx.params.length - 1;
  return `$${index}`;
}
