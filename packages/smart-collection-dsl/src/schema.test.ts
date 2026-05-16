// Tests for `schema.ts`. Every node type gets at least one positive
// case (valid input parses) and one negative case (invalid input is
// rejected with a clear issue).

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_DEPTH,
  expressionDepth,
  expressionSchema,
  expressionSchemaWithDepth,
} from './schema.js';

import type { Expression } from './types.js';

// ============================================================
// Structural acceptance
// ============================================================

describe('expressionSchema — structural acceptance', () => {
  it('accepts a simple eq', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.name',
      value: 'Charizard',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a simple eq on a number field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.hp',
      value: 200,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a simple eq on a boolean field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'printing.includeInMasterSet',
      value: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a simple eq on the synthetic isOwned', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'collection.isOwned',
      value: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a simple eq on an enum field with valid value', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.rarity',
      value: 'HOLO_RARE',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a simple eq on an enumArray field with valid value', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'printing.variantFlags',
      value: 'FIRST_EDITION',
    });
    expect(r.success).toBe(true);
  });

  it('accepts an in with multiple enum values', () => {
    const r = expressionSchema.safeParse({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE', 'ULTRA_RARE'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a range on a number field with min only', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'collection.grade',
      min: 9,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a range on a number field with both bounds', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.hp',
      min: 100,
      max: 250,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a range on a number field with open bounds', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.hp',
      min: 100,
      minInclusive: false,
      max: 250,
      maxInclusive: false,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a range on a date field with ISO date bounds', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'set.releaseDate',
      min: '2022-01-01',
      max: '2023-01-01',
    });
    expect(r.success).toBe(true);
  });

  it('accepts an exists on a nullable field', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'card.illustrator',
      exists: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts an exists on the synthetic isOwned', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'collection.isOwned',
      exists: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts an and with leaf children', () => {
    const r = expressionSchema.safeParse({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        { type: 'eq', field: 'printing.variantClass', value: 'HOLO' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts an or with leaf children', () => {
    const r = expressionSchema.safeParse({
      type: 'or',
      children: [
        { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
        { type: 'eq', field: 'card.rarity', value: 'ULTRA_RARE' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a not wrapping a leaf', () => {
    const r = expressionSchema.safeParse({
      type: 'not',
      child: { type: 'eq', field: 'card.name', value: 'Charizard' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts a deeply nested AND/OR/NOT (within depth)', () => {
    const r = expressionSchema.safeParse({
      type: 'and',
      children: [
        {
          type: 'or',
          children: [
            { type: 'eq', field: 'card.name', value: 'Charizard' },
            {
              type: 'not',
              child: { type: 'eq', field: 'card.name', value: 'Blastoise' },
            },
          ],
        },
        { type: 'eq', field: 'card.language', value: 'en' },
      ],
    });
    expect(r.success).toBe(true);
  });
});

// ============================================================
// Field allowlist enforcement
// ============================================================

describe('expressionSchema — field allowlist', () => {
  it('rejects an unknown field at the root leaf', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.unknownColumn',
      value: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown field nested inside an and', () => {
    const r = expressionSchema.safeParse({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        { type: 'eq', field: 'card.bogus', value: 'x' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an internal column (source_metadata)', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.sourceMetadata',
      value: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty field name', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: '',
      value: 'x',
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
// Operand-type matching
// ============================================================

describe('expressionSchema — operand types', () => {
  it('rejects a number value on a string field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.name',
      value: 42,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a string value on a number field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.hp',
      value: '200',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-finite number on a number field', () => {
    // NaN / Infinity are not JSON-serializable but defensive check.
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.hp',
      value: Number.POSITIVE_INFINITY,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a boolean on a string field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.name',
      value: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a value not in the enum', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.rarity',
      value: 'NOT_A_RARITY',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an in value with wrong type', () => {
    const r = expressionSchema.safeParse({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE', 5],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-ISO date value on a date field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'set.releaseDate',
      value: 'tomorrow',
    });
    expect(r.success).toBe(false);
  });

  it('accepts an ISO date value on a date field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'set.releaseDate',
      value: '2022-02-25',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-boolean value on a boolean field', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'printing.includeInMasterSet',
      value: 'yes',
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
// Range constraints
// ============================================================

describe('expressionSchema — range constraints', () => {
  it('rejects a range on a string field', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.name',
      min: 'A',
      max: 'M',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range on an enum field', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.rarity',
      min: 'COMMON',
      max: 'ULTRA_RARE',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range on a boolean field', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'printing.includeInMasterSet',
      min: false,
      max: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range with no bounds', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.hp',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range with min > max', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.hp',
      min: 250,
      max: 100,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range with non-ISO date bounds on a date field', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'set.releaseDate',
      min: 'whenever',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range with non-finite bound', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.hp',
      min: Number.NaN,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range with a string bound on a number field', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'card.hp',
      min: '100',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a range with a number bound on a date field', () => {
    const r = expressionSchema.safeParse({
      type: 'range',
      field: 'set.releaseDate',
      min: 2022,
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
// Exists constraints
// ============================================================

describe('expressionSchema — exists constraints', () => {
  it('rejects exists on a non-nullable string field', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'card.name',
      exists: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects exists on a non-nullable enum field', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'card.language',
      exists: true,
    });
    expect(r.success).toBe(false);
  });

  it('accepts exists on the synthetic isOwned (despite non-nullable kind)', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'collection.isOwned',
      exists: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts exists on a nullable date field', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'collection.acquiredAt',
      exists: false,
    });
    expect(r.success).toBe(true);
  });

  it('accepts exists on a nullable enum field', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'collection.gradeCompany',
      exists: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejects exists with a non-boolean value', () => {
    const r = expressionSchema.safeParse({
      type: 'exists',
      field: 'card.illustrator',
      exists: 'yes',
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
// AND/OR shape
// ============================================================

describe('expressionSchema — and/or shape', () => {
  it('rejects an empty `and.children`', () => {
    const r = expressionSchema.safeParse({ type: 'and', children: [] });
    expect(r.success).toBe(false);
  });

  it('rejects an empty `or.children`', () => {
    const r = expressionSchema.safeParse({ type: 'or', children: [] });
    expect(r.success).toBe(false);
  });

  it('rejects an empty `in.values`', () => {
    const r = expressionSchema.safeParse({
      type: 'in',
      field: 'card.rarity',
      values: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields in `and.children`', () => {
    const r = expressionSchema.safeParse({
      type: 'and',
      children: [{ type: 'unknownNode', whatever: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects extra keys in a leaf node (strict)', () => {
    const r = expressionSchema.safeParse({
      type: 'eq',
      field: 'card.name',
      value: 'Charizard',
      bonus: 'no',
    });
    expect(r.success).toBe(false);
  });

  it('rejects extra keys in an and node (strict)', () => {
    const r = expressionSchema.safeParse({
      type: 'and',
      children: [{ type: 'eq', field: 'card.name', value: 'Charizard' }],
      something: true,
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
// Depth limit
// ============================================================

describe('expressionSchema — depth limit', () => {
  function nest(depth: number): Expression {
    let expr: Expression = { type: 'eq', field: 'card.name', value: 'X' };
    for (let i = 0; i < depth; i++) {
      expr = { type: 'and', children: [expr] };
    }
    return expr;
  }

  it('default max depth is 8', () => {
    expect(DEFAULT_MAX_DEPTH).toBe(8);
  });

  it('accepts an expression at exactly max depth', () => {
    // Wrapping a leaf 7 times in AND yields depth = 8.
    const expr = nest(7);
    expect(expressionDepth(expr)).toBe(8);
    expect(expressionSchema.safeParse(expr).success).toBe(true);
  });

  it('rejects a 9-deep expression at the default limit', () => {
    const expr = nest(8);
    expect(expressionDepth(expr)).toBe(9);
    const r = expressionSchema.safeParse(expr);
    expect(r.success).toBe(false);
  });

  it('factory respects a smaller custom depth', () => {
    const small = expressionSchemaWithDepth(3);
    const expr = nest(3); // depth 4
    const r = small.safeParse(expr);
    expect(r.success).toBe(false);
  });

  it('factory respects a larger custom depth', () => {
    const big = expressionSchemaWithDepth(20);
    const expr = nest(15);
    const r = big.safeParse(expr);
    expect(r.success).toBe(true);
  });
});

// ============================================================
// expressionDepth
// ============================================================

describe('expressionDepth', () => {
  it('returns 1 for any leaf', () => {
    expect(expressionDepth({ type: 'eq', field: 'card.name', value: 'X' })).toBe(1);
    expect(expressionDepth({ type: 'in', field: 'card.rarity', values: ['HOLO_RARE'] })).toBe(1);
    expect(expressionDepth({ type: 'range', field: 'card.hp', min: 1 })).toBe(1);
    expect(expressionDepth({ type: 'exists', field: 'card.illustrator', exists: true })).toBe(1);
  });

  it('counts NOT layers', () => {
    const expr: Expression = {
      type: 'not',
      child: { type: 'eq', field: 'card.name', value: 'X' },
    };
    expect(expressionDepth(expr)).toBe(2);
  });

  it('returns the max child depth + 1 for AND/OR', () => {
    const expr: Expression = {
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'X' },
        {
          type: 'or',
          children: [
            { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
            {
              type: 'not',
              child: { type: 'eq', field: 'card.language', value: 'en' },
            },
          ],
        },
      ],
    };
    // Outer AND (1) + OR (2) + NOT (3) + leaf (4) = 4.
    expect(expressionDepth(expr)).toBe(4);
  });

  it('handles empty AND/OR (treated as depth 1)', () => {
    expect(expressionDepth({ type: 'and', children: [] })).toBe(1);
    expect(expressionDepth({ type: 'or', children: [] })).toBe(1);
  });
});
