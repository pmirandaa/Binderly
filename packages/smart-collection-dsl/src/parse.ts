// Parse + normalize a JSON-shaped Smart Collection DSL expression.
//
// Two responsibilities:
//
// 1. Run the canonical zod schema (`expressionSchema`) against an
//    untrusted `unknown` input. Schema failures become a typed
//    `SmartDslParseError` carrying the zod issue list.
// 2. Normalize the resulting AST so equivalent inputs round-trip to
//    the same shape:
//      - Nested AND/OR flattens (`and(and(a, b), c)` → `and(a, b, c)`).
//      - Single-child AND/OR collapses to its child (`and(a)` → `a`).
//      - Double NOT collapses (`not(not(x))` → `x`).
//      - `in` with a single value collapses to `eq` (`in(x, [v])` →
//        `eq(x, v)`).
//
// The normalizer is intentionally conservative: it never re-orders
// children, never drops duplicates, never merges adjacent EQs into
// an IN. Those are display-layer optimizations the editor UI can do
// itself; this layer's job is just structural canonicalization that
// the round-trip property test relies on.

import { z } from 'zod';

import { expressionSchema } from './schema.js';

import type { Expression, InNode, ScalarValue } from './types.js';

// ============================================================
// Typed error
// ============================================================

/**
 * Thrown by `parseExpression` when input is invalid. Carries the
 * zod `ZodError` issue list so callers can surface validation
 * errors to the user verbatim.
 *
 * Mirrors the `AuthError` posture in `@binderly/auth/src/errors.ts`
 * (typed class, stable `name`, JSON-able shape).
 */
export class SmartDslParseError extends Error {
  public override readonly name = 'SmartDslParseError';
  public readonly issues: readonly z.ZodIssue[];

  public constructor(message: string, issues: readonly z.ZodIssue[]) {
    super(message);
    this.issues = issues;
    // Restore prototype chain for `instanceof` after transpilation
    // — the same trick `@binderly/auth` uses for `AuthError`.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): { name: 'SmartDslParseError'; message: string; issues: readonly z.ZodIssue[] } {
    return {
      name: this.name,
      message: this.message,
      issues: this.issues,
    };
  }
}

/**
 * Type-narrowing predicate. Useful for callers that catch broad
 * `unknown` errors at an API boundary and need to distinguish DSL
 * errors from other failures.
 */
export function isSmartDslParseError(value: unknown): value is SmartDslParseError {
  return value instanceof SmartDslParseError;
}

// ============================================================
// Public API
// ============================================================

/**
 * Parse + normalize a smart-collection expression payload. Throws
 * `SmartDslParseError` on any structural / semantic failure.
 *
 * The returned `Expression` is canonical — repeated calls on the
 * same input always return structurally-identical output, modulo
 * the deliberately-preserved child ordering.
 */
export function parseExpression(input: unknown): Expression {
  const result = expressionSchema.safeParse(input);
  if (!result.success) {
    throw new SmartDslParseError(formatIssues(result.error.issues), result.error.issues);
  }
  return normalize(result.data);
}

/**
 * Same as `parseExpression` but returns a discriminated-union
 * result instead of throwing. Mirrors the `safeParse` posture of
 * zod — useful in code paths that don't want exceptions.
 */
export function safeParseExpression(
  input: unknown,
): { success: true; data: Expression } | { success: false; error: SmartDslParseError } {
  try {
    return { success: true, data: parseExpression(input) };
  } catch (err) {
    if (err instanceof SmartDslParseError) {
      return { success: false, error: err };
    }
    throw err;
  }
}

// ============================================================
// Normalization
// ============================================================

/**
 * Idempotent normalization. The implementation is recursive +
 * post-order: normalize each child first, then apply the
 * structural rewrites at the current node.
 *
 * Exposed for tests; production callers should go through
 * `parseExpression`.
 */
export function normalize(expr: Expression): Expression {
  switch (expr.type) {
    case 'and':
    case 'or':
      return normalizeBoolean(expr.type, expr.children.map(normalize));
    case 'not':
      return normalizeNot(normalize(expr.child));
    case 'in':
      return normalizeIn(expr);
    case 'eq':
    case 'range':
    case 'exists':
      return expr;
  }
}

function normalizeBoolean(op: 'and' | 'or', children: Expression[]): Expression {
  // Flatten same-op children: `and(a, and(b, c), d)` → `and(a, b, c, d)`.
  // Children are already normalized by the caller, so any AND
  // we see at this level is in canonical form (no nested ANDs of
  // its own). One pass is sufficient.
  const flattened: Expression[] = [];
  for (const child of children) {
    if (child.type === op) {
      for (const grandchild of child.children) {
        flattened.push(grandchild);
      }
    } else {
      flattened.push(child);
    }
  }
  // Single-child collapse: `and(a)` is just `a`. The schema rejects
  // empty children lists at parse time, so we'll always have ≥ 1.
  if (flattened.length === 1) {
    return flattened[0] as Expression;
  }
  return { type: op, children: flattened };
}

function normalizeNot(child: Expression): Expression {
  // `not(not(x))` → `x`. Repeated only once because `child` is
  // already normalized — its own NOT (if any) would have collapsed
  // by the post-order recursion.
  if (child.type === 'not') {
    return child.child;
  }
  return { type: 'not', child };
}

function normalizeIn(node: InNode): Expression {
  // `in(x, [v])` → `eq(x, v)`. Saves the SQL compiler a degenerate
  // `IN ($1)` and gives the explainer a tighter sentence.
  if (node.values.length === 1) {
    return { type: 'eq', field: node.field, value: node.values[0] as ScalarValue };
  }
  return node;
}

// ============================================================
// Internal: pretty-print the issue list
// ============================================================

function formatIssues(issues: readonly z.ZodIssue[]): string {
  if (issues.length === 0) {
    return 'invalid smart-collection expression';
  }
  const head = issues[0] as z.ZodIssue;
  const path = head.path.length > 0 ? head.path.join('.') : '<root>';
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
  return `invalid smart-collection expression at ${path}: ${head.message}${more}`;
}
