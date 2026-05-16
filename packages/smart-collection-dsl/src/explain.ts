// Human-readable rendering of a Smart Collection DSL expression.
//
// `explainExpression(expr)` returns a single English string that
// the smart-collection editor UI can show under the expression
// builder ("you're looking at: …"). The rendering is intentionally
// flat-ish — no nested bullet structure, no heavy newlines — so
// it works equally well in a tooltip and in a card subtitle.
//
// Literal English for v1. The escalation triggers in the task spec
// flag i18n as future work; we picked literal English here and
// noted it. Translation tooling (string keys, ICU plurals) lands
// in a follow-up if/when the product gates the explainer behind a
// translated surface.
//
// Style choices:
//   - Field names are rendered with a small alias map (`card.name`
//     → "card name") so users don't see DSL tokens.
//   - Enum values render with friendly casing
//     ("HOLO_RARE" → "Holo Rare").
//   - AND/OR are written as natural connectives ("and", "or"). The
//     surrounding parentheses appear only when nesting requires
//     them to avoid ambiguity.
//   - NOT is rendered as a leading "not" prefix.

import {
  CARD_CONDITIONS,
  CARD_SUBTYPES,
  GRADE_COMPANIES,
  POKEMON_TYPES,
  RARITIES,
  VARIANT_CLASSES,
  VARIANT_FLAGS,
} from '@binderly/api-contracts';

import { getFieldDef, type Expression, type Field } from './types.js';

/**
 * Render an expression as a single human-readable English string.
 * Always returns a non-empty string, even for trivial nodes.
 */
export function explainExpression(expr: Expression): string {
  return renderNode(expr, /* parentPriority */ 0);
}

// ============================================================
// Field display names
// ============================================================

const FIELD_DISPLAY: Record<Field, string> = {
  'card.name': 'card name',
  'card.number': 'card number',
  'card.illustrator': 'illustrator',
  'card.language': 'language',
  'card.type': 'energy type',
  'card.subtype': 'card subtype',
  'card.rarity': 'rarity',
  'card.hp': 'HP',
  'card.retreatCost': 'retreat cost',
  'set.code': 'set code',
  'set.name': 'set name',
  'set.series': 'set series',
  'set.language': 'set language',
  'set.releaseDate': 'set release date',
  'set.printedTotal': 'set printed total',
  'set.total': 'set total',
  'printing.variantClass': 'variant',
  'printing.variantFlags': 'variant flags',
  'printing.variantCode': 'variant code',
  'printing.includeInMasterSet': 'master-set membership',
  'collection.condition': 'condition',
  'collection.gradeCompany': 'grading company',
  'collection.grade': 'grade',
  'collection.quantity': 'quantity owned',
  'collection.acquiredAt': 'acquisition date',
  'collection.isOwned': 'ownership',
};

// ============================================================
// Enum prettifying
// ============================================================

/**
 * Build a static map from enum tag (`HOLO_RARE`) to a friendly
 * display string ("Holo Rare"). The map covers every enum surfaced
 * by the DSL so the explainer never falls back to raw tags for
 * known values.
 */
const ENUM_DISPLAY: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const enumValues of [
    POKEMON_TYPES,
    CARD_SUBTYPES,
    RARITIES,
    VARIANT_CLASSES,
    VARIANT_FLAGS,
    GRADE_COMPANIES,
    CARD_CONDITIONS,
  ]) {
    for (const v of enumValues) {
      map.set(v, prettifyEnum(v));
    }
  }
  return map;
})();

function prettifyEnum(token: string): string {
  // ASCII-only; covers the entire DSL enum surface.
  return token
    .toLowerCase()
    .split('_')
    .map((segment) =>
      segment.length === 0 ? '' : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join(' ');
}

function displayValue(field: Field, value: string | number | boolean): string {
  const def = getFieldDef(field);
  if (typeof value === 'boolean') {
    if (field === 'collection.isOwned') return value ? 'owned' : 'not owned';
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') return String(value);
  if (def.kind === 'enum' || def.kind === 'enumArray') {
    return ENUM_DISPLAY.get(value) ?? value;
  }
  return JSON.stringify(value);
}

// ============================================================
// Recursive renderer
// ============================================================

// Operator priorities — higher binds tighter. Used to decide when
// to wrap a child in parentheses while rendering. Roughly mirrors
// boolean-algebra precedence:
//   30  leaf
//   20  not
//   10  and
//    5  or
const PRIORITY = { or: 5, and: 10, not: 20, leaf: 30 } as const;

function renderNode(expr: Expression, parentPriority: number): string {
  switch (expr.type) {
    case 'and':
      return wrapIfNeeded(renderConnective(expr.children, ' and '), PRIORITY.and, parentPriority);
    case 'or':
      return wrapIfNeeded(renderConnective(expr.children, ' or '), PRIORITY.or, parentPriority);
    case 'not':
      return wrapIfNeeded(
        `not ${renderNode(expr.child, PRIORITY.not)}`,
        PRIORITY.not,
        parentPriority,
      );
    case 'eq':
      return renderEq(expr.field, expr.value);
    case 'in':
      return renderIn(expr.field, expr.values);
    case 'range':
      return renderRange(expr.field, expr);
    case 'exists':
      return renderExists(expr.field, expr.exists);
  }
}

function renderConnective(children: readonly Expression[], joiner: string): string {
  // The schema rejects empty children lists; a single child is
  // collapsed by `parse.ts/normalize`, so we reach this code path
  // only with ≥ 2 children when called via `parseExpression`. Guard
  // anyway for AST built in-process.
  if (children.length === 0) return '(empty)';
  if (children.length === 1) return renderNode(children[0] as Expression, PRIORITY.leaf);
  // Determine the precedence of the connective so children render
  // their own parens correctly.
  const myPriority = joiner.trim() === 'and' ? PRIORITY.and : PRIORITY.or;
  return children.map((c) => renderNode(c, myPriority)).join(joiner);
}

function renderEq(field: Field, value: string | number | boolean): string {
  const def = getFieldDef(field);
  if (field === 'collection.isOwned') {
    return value === true ? 'owned by you' : 'not owned by you';
  }
  if (def.kind === 'enumArray') {
    return `${FIELD_DISPLAY[field]} include ${displayValue(field, value)}`;
  }
  return `${FIELD_DISPLAY[field]} is ${displayValue(field, value)}`;
}

function renderIn(field: Field, values: readonly (string | number | boolean)[]): string {
  const def = getFieldDef(field);
  const list = values.map((v) => displayValue(field, v)).join(', ');
  if (field === 'collection.isOwned') {
    // The normalizer turned single-element IN into EQ; arriving here
    // means both true and false are allowed, which is everything.
    return 'any ownership state';
  }
  if (def.kind === 'enumArray') {
    return `${FIELD_DISPLAY[field]} include any of [${list}]`;
  }
  return `${FIELD_DISPLAY[field]} is one of [${list}]`;
}

function renderRange(
  field: Field,
  range: {
    readonly min?: number | string;
    readonly max?: number | string;
    readonly minInclusive?: boolean;
    readonly maxInclusive?: boolean;
  },
): string {
  const minInclusive = range.minInclusive ?? true;
  const maxInclusive = range.maxInclusive ?? true;
  const display = FIELD_DISPLAY[field];
  if (range.min !== undefined && range.max !== undefined) {
    if (minInclusive && maxInclusive) {
      return `${display} between ${stringifyBound(range.min)} and ${stringifyBound(range.max)}`;
    }
    return `${display} ${minInclusive ? '≥' : '>'} ${stringifyBound(range.min)} and ${maxInclusive ? '≤' : '<'} ${stringifyBound(range.max)}`;
  }
  if (range.min !== undefined) {
    return `${display} ${minInclusive ? 'at least' : 'greater than'} ${stringifyBound(range.min)}`;
  }
  if (range.max !== undefined) {
    return `${display} ${maxInclusive ? 'at most' : 'less than'} ${stringifyBound(range.max)}`;
  }
  return `${display} (unbounded range)`;
}

function renderExists(field: Field, exists: boolean): string {
  if (field === 'collection.isOwned') {
    return exists ? 'owned by you' : 'not owned by you';
  }
  return exists ? `${FIELD_DISPLAY[field]} is set` : `${FIELD_DISPLAY[field]} is missing`;
}

function stringifyBound(bound: number | string): string {
  return typeof bound === 'number' ? String(bound) : bound;
}

function wrapIfNeeded(rendered: string, ownPriority: number, parentPriority: number): string {
  return ownPriority < parentPriority ? `(${rendered})` : rendered;
}
