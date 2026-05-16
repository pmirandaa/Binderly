// Pure evaluator for the Smart Collection DSL.
//
// `evaluateExpression(expr, item)` is a side-effect-free predicate
// that returns `true` iff the item satisfies the expression. Used
// by:
//
//   - The smart-collection editor preview ("show me the live result
//     of this rule against the user's catalog").
//   - The round-trip property test that verifies the SQL compiler
//     and the in-process evaluator agree.
//
// NULL / MISSING semantics. To keep the evaluator and the SQL
// compiler in lockstep, every leaf comparison treats a null /
// undefined operand as "false". This matches the SQL output, which
// wraps every comparison in `(... ) IS TRUE` (so NULL collapses to
// FALSE before NOT applies). One concrete consequence: under
// `NOT eq(rarity, 'HOLO_RARE')`, a card with `rarity = NULL` returns
// `true` (because the inner `eq` is false). That mirrors the SQL —
// see `sql.ts`.
//
// NOTE: this evaluator is decoupled from the parser; callers may
// pass any AST that satisfies the type, including ones that came
// from in-process construction. For untrusted input, prefer
// `parseExpression` first.

import {
  getFieldDef,
  type CandidateItem,
  type Expression,
  type Field,
  type FieldDef,
} from './types.js';

/**
 * Pure boolean predicate. Returns `true` iff `item` satisfies
 * `expr`.
 */
export function evaluateExpression(expr: Expression, item: CandidateItem): boolean {
  switch (expr.type) {
    case 'and':
      return expr.children.every((child) => evaluateExpression(child, item));
    case 'or':
      return expr.children.some((child) => evaluateExpression(child, item));
    case 'not':
      return !evaluateExpression(expr.child, item);
    case 'eq':
      return evaluateEq(expr.field, expr.value, item);
    case 'in':
      return evaluateIn(expr.field, expr.values, item);
    case 'range':
      return evaluateRange(expr.field, expr, item);
    case 'exists':
      return evaluateExists(expr.field, expr.exists, item);
  }
}

// ============================================================
// Leaf operators
// ============================================================

function evaluateEq(field: Field, value: string | number | boolean, item: CandidateItem): boolean {
  const def = getFieldDef(field);
  // Synthetic ownership flag.
  if (field === 'collection.isOwned') {
    return item.collection !== undefined && item.collection !== null
      ? value === true
      : value === false;
  }
  if (def.kind === 'enumArray') {
    const arr = readArrayValue(field, item);
    if (arr === undefined) return false;
    return arr.includes(value as string);
  }
  const actual = readScalarValue(field, item);
  if (actual === null || actual === undefined) {
    return false;
  }
  return actual === value;
}

function evaluateIn(
  field: Field,
  values: readonly (string | number | boolean)[],
  item: CandidateItem,
): boolean {
  const def = getFieldDef(field);
  if (field === 'collection.isOwned') {
    const owned = item.collection !== undefined && item.collection !== null;
    return values.some((v) => v === owned);
  }
  if (def.kind === 'enumArray') {
    const arr = readArrayValue(field, item);
    if (arr === undefined) return false;
    return arr.some((entry) => values.includes(entry));
  }
  const actual = readScalarValue(field, item);
  if (actual === null || actual === undefined) {
    return false;
  }
  return values.some((v) => v === actual);
}

function evaluateRange(
  field: Field,
  range: {
    readonly min?: number | string;
    readonly max?: number | string;
    readonly minInclusive?: boolean;
    readonly maxInclusive?: boolean;
  },
  item: CandidateItem,
): boolean {
  const def = getFieldDef(field);
  if (def.kind !== 'number' && def.kind !== 'date') {
    return false;
  }
  const actual = readScalarValue(field, item);
  if (actual === null || actual === undefined) {
    return false;
  }
  const minInclusive = range.minInclusive ?? true;
  const maxInclusive = range.maxInclusive ?? true;
  if (range.min !== undefined) {
    if (def.kind === 'number') {
      if (typeof actual !== 'number' || typeof range.min !== 'number') return false;
      if (minInclusive ? actual < range.min : actual <= range.min) return false;
    } else {
      // ISO-date strings compare lexicographically. The schema
      // guarantees both sides are well-formed YYYY-MM-DD.
      if (typeof actual !== 'string' || typeof range.min !== 'string') return false;
      if (minInclusive ? actual < range.min : actual <= range.min) return false;
    }
  }
  if (range.max !== undefined) {
    if (def.kind === 'number') {
      if (typeof actual !== 'number' || typeof range.max !== 'number') return false;
      if (maxInclusive ? actual > range.max : actual >= range.max) return false;
    } else {
      if (typeof actual !== 'string' || typeof range.max !== 'string') return false;
      if (maxInclusive ? actual > range.max : actual >= range.max) return false;
    }
  }
  return true;
}

function evaluateExists(field: Field, exists: boolean, item: CandidateItem): boolean {
  if (field === 'collection.isOwned') {
    const owned = item.collection !== undefined && item.collection !== null;
    return exists ? owned : !owned;
  }
  const def = getFieldDef(field);
  if (def.kind === 'enumArray') {
    const arr = readArrayValue(field, item);
    return exists ? arr !== undefined : arr === undefined;
  }
  const actual = readScalarValue(field, item);
  const present = actual !== null && actual !== undefined;
  return exists ? present : !present;
}

// ============================================================
// Field accessors
// ============================================================

function readScalarValue(
  field: Field,
  item: CandidateItem,
): string | number | boolean | null | undefined {
  switch (field) {
    case 'card.name':
      return item.card.name;
    case 'card.number':
      return item.card.number;
    case 'card.illustrator':
      return item.card.illustrator;
    case 'card.language':
      return item.card.language;
    case 'card.type':
      return item.card.type;
    case 'card.subtype':
      return item.card.subtype;
    case 'card.rarity':
      return item.card.rarity;
    case 'card.hp':
      return item.card.hp;
    case 'card.retreatCost':
      return item.card.retreatCost;
    case 'set.code':
      return item.set.code;
    case 'set.name':
      return item.set.name;
    case 'set.series':
      return item.set.series;
    case 'set.language':
      return item.set.language;
    case 'set.releaseDate':
      return item.set.releaseDate;
    case 'set.printedTotal':
      return item.set.printedTotal;
    case 'set.total':
      return item.set.total;
    case 'printing.variantClass':
      return item.printing.variantClass;
    case 'printing.variantCode':
      return item.printing.variantCode;
    case 'printing.includeInMasterSet':
      return item.printing.includeInMasterSet;
    case 'collection.condition':
      return item.collection?.condition ?? null;
    case 'collection.gradeCompany':
      return item.collection?.gradeCompany ?? null;
    case 'collection.grade':
      return item.collection?.grade ?? null;
    case 'collection.quantity':
      return item.collection?.quantity ?? null;
    case 'collection.acquiredAt':
      return item.collection?.acquiredAt ?? null;
    case 'collection.isOwned':
      return item.collection !== undefined && item.collection !== null;
    case 'printing.variantFlags':
      // Array fields are not scalar; callers should use
      // `readArrayValue`. Returning undefined keeps the leaf
      // operators' "missing → false" path consistent.
      return undefined;
  }
  // Exhaustiveness — TS guarantees this branch is unreachable, but
  // keep a runtime fallback for safety.
  return undefined;
}

function readArrayValue(field: Field, item: CandidateItem): readonly string[] | undefined {
  if (field === 'printing.variantFlags') {
    return item.printing.variantFlags;
  }
  return undefined;
}

// Re-export `FieldDef` for tests that want to drive the evaluator
// off the field metadata directly.
export type { FieldDef };
