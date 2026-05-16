// Tests for `parse.ts`. Validates the parse + normalize pipeline:
//
//   - Valid input parses to the canonical normalized AST.
//   - Invalid input throws / returns `SmartDslParseError` with
//     useful issues.
//   - Normalization is idempotent (parse(parse(x)) === parse(x)).

import { describe, expect, it } from 'vitest';

import {
  isSmartDslParseError,
  normalize,
  parseExpression,
  safeParseExpression,
  SmartDslParseError,
} from './parse.js';

import type { Expression } from './types.js';

describe('parseExpression — happy path', () => {
  it('parses a simple eq', () => {
    const expr = parseExpression({
      type: 'eq',
      field: 'card.name',
      value: 'Charizard',
    });
    expect(expr).toEqual({ type: 'eq', field: 'card.name', value: 'Charizard' });
  });

  it('parses a simple in', () => {
    const expr = parseExpression({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE', 'ULTRA_RARE'],
    });
    expect(expr).toEqual({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE', 'ULTRA_RARE'],
    });
  });

  it('parses a range with both bounds', () => {
    const expr = parseExpression({
      type: 'range',
      field: 'card.hp',
      min: 100,
      max: 250,
    });
    expect(expr).toEqual({
      type: 'range',
      field: 'card.hp',
      min: 100,
      max: 250,
    });
  });

  it('parses an exists', () => {
    const expr = parseExpression({
      type: 'exists',
      field: 'card.illustrator',
      exists: false,
    });
    expect(expr).toEqual({
      type: 'exists',
      field: 'card.illustrator',
      exists: false,
    });
  });
});

// ============================================================
// Normalization
// ============================================================

describe('parseExpression — normalization', () => {
  it('flattens nested AND', () => {
    const expr = parseExpression({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        {
          type: 'and',
          children: [
            { type: 'eq', field: 'card.language', value: 'en' },
            { type: 'eq', field: 'set.code', value: 'swsh9' },
          ],
        },
      ],
    });
    expect(expr.type).toBe('and');
    expect((expr as Extract<Expression, { type: 'and' }>).children).toHaveLength(3);
  });

  it('flattens deeply nested AND', () => {
    const expr = parseExpression({
      type: 'and',
      children: [
        {
          type: 'and',
          children: [
            {
              type: 'and',
              children: [
                { type: 'eq', field: 'card.name', value: 'A' },
                { type: 'eq', field: 'card.name', value: 'B' },
              ],
            },
            { type: 'eq', field: 'card.name', value: 'C' },
          ],
        },
        { type: 'eq', field: 'card.name', value: 'D' },
      ],
    });
    expect(expr.type).toBe('and');
    expect((expr as Extract<Expression, { type: 'and' }>).children).toHaveLength(4);
  });

  it('flattens nested OR independently of AND', () => {
    const expr = parseExpression({
      type: 'or',
      children: [
        { type: 'eq', field: 'card.name', value: 'A' },
        {
          type: 'or',
          children: [
            { type: 'eq', field: 'card.name', value: 'B' },
            { type: 'eq', field: 'card.name', value: 'C' },
          ],
        },
      ],
    });
    expect(expr.type).toBe('or');
    expect((expr as Extract<Expression, { type: 'or' }>).children).toHaveLength(3);
  });

  it('does NOT flatten OR inside AND', () => {
    const expr = parseExpression({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'A' },
        {
          type: 'or',
          children: [
            { type: 'eq', field: 'card.name', value: 'B' },
            { type: 'eq', field: 'card.name', value: 'C' },
          ],
        },
      ],
    });
    expect(expr.type).toBe('and');
    const children = (expr as Extract<Expression, { type: 'and' }>).children;
    expect(children).toHaveLength(2);
    expect(children[1]?.type).toBe('or');
  });

  it('collapses single-child AND to its child', () => {
    const expr = parseExpression({
      type: 'and',
      children: [{ type: 'eq', field: 'card.name', value: 'X' }],
    });
    expect(expr.type).toBe('eq');
  });

  it('collapses single-child OR to its child', () => {
    const expr = parseExpression({
      type: 'or',
      children: [{ type: 'eq', field: 'card.name', value: 'X' }],
    });
    expect(expr.type).toBe('eq');
  });

  it('collapses double NOT to identity', () => {
    const expr = parseExpression({
      type: 'not',
      child: {
        type: 'not',
        child: { type: 'eq', field: 'card.name', value: 'X' },
      },
    });
    expect(expr.type).toBe('eq');
  });

  it('collapses 4-deep NOT to identity', () => {
    const expr = parseExpression({
      type: 'not',
      child: {
        type: 'not',
        child: {
          type: 'not',
          child: {
            type: 'not',
            child: { type: 'eq', field: 'card.name', value: 'X' },
          },
        },
      },
    });
    expect(expr.type).toBe('eq');
  });

  it('preserves single NOT', () => {
    const expr = parseExpression({
      type: 'not',
      child: { type: 'eq', field: 'card.name', value: 'X' },
    });
    expect(expr.type).toBe('not');
  });

  it('preserves triple NOT as a single NOT', () => {
    const expr = parseExpression({
      type: 'not',
      child: {
        type: 'not',
        child: {
          type: 'not',
          child: { type: 'eq', field: 'card.name', value: 'X' },
        },
      },
    });
    expect(expr.type).toBe('not');
  });

  it('collapses single-element IN to EQ', () => {
    const expr = parseExpression({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE'],
    });
    expect(expr).toEqual({
      type: 'eq',
      field: 'card.rarity',
      value: 'HOLO_RARE',
    });
  });

  it('preserves multi-element IN', () => {
    const expr = parseExpression({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE', 'ULTRA_RARE'],
    });
    expect(expr.type).toBe('in');
  });

  it('preserves child ordering (no re-sort)', () => {
    const expr = parseExpression({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'B' },
        { type: 'eq', field: 'card.name', value: 'A' },
      ],
    });
    const children = (expr as Extract<Expression, { type: 'and' }>).children;
    expect(children[0]).toEqual({ type: 'eq', field: 'card.name', value: 'B' });
    expect(children[1]).toEqual({ type: 'eq', field: 'card.name', value: 'A' });
  });

  it('is idempotent under repeated normalization', () => {
    const input = {
      type: 'and',
      children: [
        {
          type: 'and',
          children: [
            { type: 'eq', field: 'card.name', value: 'A' },
            {
              type: 'not',
              child: {
                type: 'not',
                child: { type: 'eq', field: 'card.language', value: 'en' },
              },
            },
          ],
        },
        { type: 'eq', field: 'set.code', value: 'swsh9' },
      ],
    };
    const once = parseExpression(input);
    const twice = normalize(once);
    expect(twice).toEqual(once);
  });
});

// ============================================================
// Error path
// ============================================================

describe('parseExpression — invalid input', () => {
  it('throws SmartDslParseError on a bad shape', () => {
    let caught: unknown;
    try {
      parseExpression('not an expression');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmartDslParseError);
  });

  it('attaches the issue list to the thrown error', () => {
    try {
      parseExpression({ type: 'eq', field: 'unknown.col', value: 'x' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SmartDslParseError);
      const e = err as SmartDslParseError;
      expect(e.issues.length).toBeGreaterThan(0);
    }
  });

  it('error message references the path', () => {
    try {
      parseExpression({ type: 'eq', field: 'card.unknownColumn', value: 'x' });
    } catch (err) {
      const e = err as SmartDslParseError;
      expect(e.message).toMatch(/field/);
    }
  });

  it('error toJSON returns name + message + issues', () => {
    try {
      parseExpression({ type: 'eq', field: 'card.name', value: 5 });
    } catch (err) {
      const e = err as SmartDslParseError;
      const j = e.toJSON();
      expect(j.name).toBe('SmartDslParseError');
      expect(typeof j.message).toBe('string');
      expect(Array.isArray(j.issues)).toBe(true);
    }
  });

  it('isSmartDslParseError narrows correctly', () => {
    try {
      parseExpression({ type: 'eq', field: 'card.name', value: 5 });
    } catch (err) {
      expect(isSmartDslParseError(err)).toBe(true);
    }
    expect(isSmartDslParseError(new Error('not us'))).toBe(false);
    expect(isSmartDslParseError('string')).toBe(false);
  });

  it('rejects null', () => {
    expect(() => parseExpression(null)).toThrow(SmartDslParseError);
  });

  it('rejects undefined', () => {
    expect(() => parseExpression(undefined)).toThrow(SmartDslParseError);
  });

  it('rejects an array', () => {
    expect(() => parseExpression([])).toThrow(SmartDslParseError);
  });

  it('rejects a missing type discriminator', () => {
    expect(() => parseExpression({ field: 'card.name', value: 'x' })).toThrow(SmartDslParseError);
  });
});

// ============================================================
// safeParseExpression
// ============================================================

describe('safeParseExpression', () => {
  it('returns success on valid input', () => {
    const r = safeParseExpression({
      type: 'eq',
      field: 'card.name',
      value: 'Charizard',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe('eq');
    }
  });

  it('returns failure on invalid input', () => {
    const r = safeParseExpression({ type: 'eq', field: 'unknown', value: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBeInstanceOf(SmartDslParseError);
    }
  });
});

// ============================================================
// normalize (direct)
// ============================================================

describe('normalize (direct)', () => {
  it('preserves a leaf', () => {
    const leaf: Expression = { type: 'eq', field: 'card.name', value: 'X' };
    expect(normalize(leaf)).toEqual(leaf);
  });

  it('flattens recursively', () => {
    const out = normalize({
      type: 'and',
      children: [
        {
          type: 'and',
          children: [
            { type: 'eq', field: 'card.name', value: 'A' },
            { type: 'eq', field: 'card.name', value: 'B' },
          ],
        },
        { type: 'eq', field: 'card.name', value: 'C' },
      ],
    });
    expect(out.type).toBe('and');
    expect((out as Extract<Expression, { type: 'and' }>).children).toHaveLength(3);
  });

  it('handles a deep mix of NOT/AND/OR collapses', () => {
    const out = normalize({
      type: 'and',
      children: [
        {
          type: 'not',
          child: {
            type: 'not',
            child: { type: 'eq', field: 'card.name', value: 'A' },
          },
        },
      ],
    });
    expect(out).toEqual({ type: 'eq', field: 'card.name', value: 'A' });
  });
});
