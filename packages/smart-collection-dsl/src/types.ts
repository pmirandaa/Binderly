// AST node types and the curated `Field` allowlist for the Smart
// Collection DSL.
//
// The DSL is strictly bounded — boolean combinations of leaf
// predicates over a fixed set of fields drawn from the `card`,
// `printing`, `set`, and (per-user) `collection_item` DTOs. Adding
// a new field to the surface area requires a code change here;
// users cannot reach internal columns or accidentally leak data.
//
// Two consumer-facing concerns live in this file:
//
// 1. The AST shape — `Expression` and its node types — used by every
//    other module.
// 2. The `FIELD_DEFS` allowlist — per-field metadata (kind, sql
//    column, nullability, multi-valued?) that drives schema
//    validation, evaluator dispatch, SQL emission, and the human
//    explainer.
//
// Field naming convention: `<entity>.<dtoCamelCase>` (e.g.
// `card.name`, `printing.variantClass`, `set.releaseDate`,
// `collection.grade`). The dot is purely cosmetic on the wire — the
// parser treats the whole string as an opaque field key. The four
// entity prefixes are: `card`, `set`, `printing`, `collection`.

import {
  CARD_CONDITIONS,
  CARD_SUBTYPES,
  GRADE_COMPANIES,
  LANGUAGES,
  POKEMON_TYPES,
  RARITIES,
  VARIANT_CLASSES,
  VARIANT_FLAGS,
  type CardCondition,
  type CardSubtype,
  type GradeCompany,
  type Language,
  type PokemonType,
  type Rarity,
  type VariantClass,
  type VariantFlag,
} from '@binderly/api-contracts';

// ============================================================
// Field allowlist
// ============================================================

/**
 * Field-kind tag drives type checking in the schema (which operands
 * are valid) and dispatch in the evaluator / SQL compiler.
 *
 * - `string`     — free-text columns like `card.name`,
 *                  `card.illustrator`, `set.code`. EQ / IN supported.
 *                  RANGE not supported (lexicographic ranges open
 *                  surprising surface; punt to v2).
 * - `enum`       — closed-set columns like `card.rarity`,
 *                  `printing.variantClass`. EQ / IN supported and
 *                  values type-checked against the enum.
 * - `enumArray`  — `text[]` columns like `printing.variantFlags`.
 *                  EQ semantics = "array contains"; IN semantics =
 *                  "array overlaps any of these values".
 * - `number`     — integer / numeric columns like `card.hp`,
 *                  `collection.quantity`, `collection.grade`. EQ /
 *                  IN / RANGE supported.
 * - `date`       — `date` columns like `set.releaseDate`,
 *                  `collection.acquiredAt`. RANGE supported with
 *                  ISO date strings; EQ / IN supported on the
 *                  ISO date wire form.
 * - `boolean`    — `printing.includeInMasterSet` and the synthetic
 *                  `collection.isOwned`. EQ / EXISTS supported.
 */
export type FieldKind = 'string' | 'enum' | 'enumArray' | 'number' | 'date' | 'boolean';

export interface FieldDefBase {
  /** Storage-layer fully-qualified column reference (table.column). */
  readonly sqlColumn: string;
  /** Whether the underlying column is nullable. EXISTS only valid on nullable fields. */
  readonly nullable: boolean;
}

export interface StringFieldDef extends FieldDefBase {
  readonly kind: 'string';
}

export interface EnumFieldDef<T extends string = string> extends FieldDefBase {
  readonly kind: 'enum';
  readonly enumValues: readonly T[];
}

export interface EnumArrayFieldDef<T extends string = string> extends FieldDefBase {
  readonly kind: 'enumArray';
  readonly enumValues: readonly T[];
}

export interface NumberFieldDef extends FieldDefBase {
  readonly kind: 'number';
}

export interface DateFieldDef extends FieldDefBase {
  readonly kind: 'date';
}

export interface BooleanFieldDef extends FieldDefBase {
  readonly kind: 'boolean';
}

export type FieldDef =
  | StringFieldDef
  | EnumFieldDef
  | EnumArrayFieldDef
  | NumberFieldDef
  | DateFieldDef
  | BooleanFieldDef;

/**
 * The canonical field allowlist. Extending the DSL surface is a
 * code change here — by design.
 *
 * Naming convention: `<entity>.<camelCase>` matching the DTO field
 * name. SQL columns use the underlying snake_case (the DSL is the
 * translation layer).
 *
 * `collection.isOwned` is synthetic — there's no physical column
 * for it. The SQL compiler emits the `collection_item.id IS NOT
 * NULL` predicate (assuming the caller LEFT JOINs `collection_item`
 * filtered by user_id). The evaluator reads
 * `item.collection !== undefined`.
 */
export const FIELD_DEFS = {
  // -- card -------------------------------------------------------
  'card.name': {
    kind: 'string',
    sqlColumn: 'card.name',
    nullable: false,
  },
  'card.number': {
    kind: 'string',
    sqlColumn: 'card.number',
    nullable: false,
  },
  'card.illustrator': {
    kind: 'string',
    sqlColumn: 'card.illustrator',
    nullable: true,
  },
  'card.language': {
    kind: 'enum',
    enumValues: LANGUAGES,
    sqlColumn: 'card.language',
    nullable: false,
  },
  'card.type': {
    kind: 'enum',
    enumValues: POKEMON_TYPES,
    sqlColumn: 'card.type',
    nullable: true,
  },
  'card.subtype': {
    kind: 'enum',
    enumValues: CARD_SUBTYPES,
    sqlColumn: 'card.subtype',
    nullable: true,
  },
  'card.rarity': {
    kind: 'enum',
    enumValues: RARITIES,
    sqlColumn: 'card.rarity',
    nullable: true,
  },
  'card.hp': {
    kind: 'number',
    sqlColumn: 'card.hp',
    nullable: true,
  },
  'card.retreatCost': {
    kind: 'number',
    sqlColumn: 'card.retreat_cost',
    nullable: true,
  },
  // -- set --------------------------------------------------------
  'set.code': {
    kind: 'string',
    sqlColumn: 'set.code',
    nullable: false,
  },
  'set.name': {
    kind: 'string',
    sqlColumn: 'set.name',
    nullable: false,
  },
  'set.series': {
    kind: 'string',
    sqlColumn: 'set.series',
    nullable: true,
  },
  'set.language': {
    kind: 'enum',
    enumValues: LANGUAGES,
    sqlColumn: 'set.language',
    nullable: false,
  },
  'set.releaseDate': {
    kind: 'date',
    sqlColumn: 'set.release_date',
    nullable: false,
  },
  'set.printedTotal': {
    kind: 'number',
    sqlColumn: 'set.printed_total',
    nullable: true,
  },
  'set.total': {
    kind: 'number',
    sqlColumn: 'set.total',
    nullable: true,
  },
  // -- printing ---------------------------------------------------
  'printing.variantClass': {
    kind: 'enum',
    enumValues: VARIANT_CLASSES,
    sqlColumn: 'printing.variant_class',
    nullable: false,
  },
  'printing.variantFlags': {
    kind: 'enumArray',
    enumValues: VARIANT_FLAGS,
    sqlColumn: 'printing.variant_flags',
    nullable: false,
  },
  'printing.variantCode': {
    kind: 'string',
    sqlColumn: 'printing.variant_code',
    nullable: false,
  },
  'printing.includeInMasterSet': {
    kind: 'boolean',
    sqlColumn: 'printing.include_in_master_set',
    nullable: false,
  },
  // -- collection (per-user) -------------------------------------
  'collection.condition': {
    kind: 'enum',
    enumValues: CARD_CONDITIONS,
    sqlColumn: 'collection_item.condition',
    nullable: true,
  },
  'collection.gradeCompany': {
    kind: 'enum',
    enumValues: GRADE_COMPANIES,
    sqlColumn: 'collection_item.grade_company',
    nullable: true,
  },
  'collection.grade': {
    kind: 'number',
    sqlColumn: 'collection_item.grade',
    nullable: true,
  },
  'collection.quantity': {
    kind: 'number',
    sqlColumn: 'collection_item.quantity',
    nullable: true,
  },
  'collection.acquiredAt': {
    kind: 'date',
    sqlColumn: 'collection_item.acquired_at',
    nullable: true,
  },
  'collection.isOwned': {
    kind: 'boolean',
    // Synthetic — see the file-header comment. The SQL compiler
    // expands this to `collection_item.id IS NOT NULL`.
    sqlColumn: 'collection_item.id',
    nullable: false,
  },
} as const satisfies Record<string, FieldDef>;

export type Field = keyof typeof FIELD_DEFS;

/** Runtime-iterable list of every legal field name. */
export const FIELDS = Object.keys(FIELD_DEFS) as readonly Field[];

/**
 * Type-narrowing predicate the schema and parser use to validate
 * the `field` operand of every leaf node.
 */
export function isField(value: unknown): value is Field {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FIELD_DEFS, value);
}

/**
 * Lookup helper. Throws synchronously if the field is unknown —
 * callers should validate with `isField` first when accepting
 * untrusted input.
 */
export function getFieldDef(field: Field): FieldDef {
  const def = FIELD_DEFS[field];
  if (def === undefined) {
    throw new Error(`unknown field: ${String(field)}`);
  }
  return def;
}

// ============================================================
// AST node types
// ============================================================

/**
 * Scalar value carried by `eq` / `in` leaf nodes. Booleans are
 * accepted on `boolean` fields; strings on `string` / `enum` /
 * `enumArray` / `date` fields; numbers on `number` fields.
 */
export type ScalarValue = string | number | boolean;

/**
 * Numeric or ISO-date bound on a RANGE node. Numbers are used on
 * `number` fields; ISO date strings (`YYYY-MM-DD`) on `date`
 * fields.
 */
export type RangeBound = number | string;

/**
 * `and` — every child must be true. An empty children list is
 * forbidden by the schema (would otherwise mean "always true",
 * which is better expressed by omitting the rule).
 */
export interface AndNode {
  readonly type: 'and';
  readonly children: readonly Expression[];
}

/**
 * `or` — at least one child must be true. Empty children list is
 * forbidden by the schema (would mean "always false").
 */
export interface OrNode {
  readonly type: 'or';
  readonly children: readonly Expression[];
}

/** `not` — single child negated. The parser collapses `not(not(x))` to `x`. */
export interface NotNode {
  readonly type: 'not';
  readonly child: Expression;
}

/**
 * `eq` — equality on the named field. For `enumArray` fields, the
 * semantics are "array contains the given value" (e.g.
 * `eq('printing.variantFlags', 'FIRST_EDITION')` matches printings
 * whose flags array contains `FIRST_EDITION`).
 */
export interface EqNode {
  readonly type: 'eq';
  readonly field: Field;
  readonly value: ScalarValue;
}

/**
 * `in` — membership on the named field. For `enumArray` fields,
 * the semantics are "array overlaps with any of these values".
 * Empty `values` is forbidden by the schema.
 */
export interface InNode {
  readonly type: 'in';
  readonly field: Field;
  readonly values: readonly ScalarValue[];
}

/**
 * `range` — numeric or date interval on the named field. At least
 * one of `min` / `max` must be provided (a range with neither bound
 * is meaningless). `minInclusive` / `maxInclusive` default to
 * `true` (closed interval) — match the user's mental model of
 * "between X and Y inclusive".
 *
 * Only valid on `number` and `date` fields. The schema rejects
 * `range` on string / enum / boolean fields.
 */
export interface RangeNode {
  readonly type: 'range';
  readonly field: Field;
  readonly min?: RangeBound;
  readonly max?: RangeBound;
  readonly minInclusive?: boolean;
  readonly maxInclusive?: boolean;
}

/**
 * `exists` — non-null check on a nullable field, or "row exists"
 * check on the synthetic `collection.isOwned`. `exists: false`
 * checks for null. Only valid on nullable fields and on the
 * synthetic `collection.isOwned`.
 */
export interface ExistsNode {
  readonly type: 'exists';
  readonly field: Field;
  readonly exists: boolean;
}

/**
 * The full AST. Discriminated by `type`. Every other module in this
 * package is a function over this union.
 */
export type Expression = AndNode | OrNode | NotNode | EqNode | InNode | RangeNode | ExistsNode;

// ============================================================
// Candidate item — input to the evaluator
// ============================================================

/**
 * The canonical printing-card-set bundle the evaluator filters on.
 * Mirrors the DTO shapes from `@binderly/api-contracts` but only
 * carries the fields the DSL allowlist references — callers are
 * free to project this from a richer source row.
 *
 * `collection` is undefined when the current user does not own this
 * printing. When defined, it represents the `collection_item` row
 * for the (user, printing) pair the caller materialized — for
 * `enumArray` / `enum` columns, undefined values short-circuit to
 * the SQL `NULL = anything` semantics (every comparison is false).
 */
export interface CandidateCard {
  readonly name: string;
  readonly number: string;
  readonly illustrator: string | null;
  readonly language: Language;
  readonly type: PokemonType | null;
  readonly subtype: CardSubtype | null;
  readonly rarity: Rarity | null;
  readonly hp: number | null;
  readonly retreatCost: number | null;
}

export interface CandidateSet {
  readonly code: string;
  readonly name: string;
  readonly series: string | null;
  readonly language: Language;
  /** ISO date `YYYY-MM-DD`. */
  readonly releaseDate: string;
  readonly printedTotal: number | null;
  readonly total: number | null;
}

export interface CandidatePrinting {
  readonly variantClass: VariantClass;
  readonly variantFlags: readonly VariantFlag[];
  readonly variantCode: string;
  readonly includeInMasterSet: boolean;
}

export interface CandidateCollection {
  readonly condition: CardCondition;
  readonly gradeCompany: GradeCompany | null;
  /** Numeric grade serialized as a `number` (e.g. `9.5`); null when raw. */
  readonly grade: number | null;
  readonly quantity: number;
  /** ISO date `YYYY-MM-DD` or null when not recorded. */
  readonly acquiredAt: string | null;
}

export interface CandidateItem {
  readonly card: CandidateCard;
  readonly set: CandidateSet;
  readonly printing: CandidatePrinting;
  readonly collection?: CandidateCollection;
}
