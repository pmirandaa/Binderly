// Tests for `explain.ts`. We assert representative phrasings rather
// than exact strings — the explainer is human-facing copy and is
// likely to be tweaked. The contract is "non-empty, mentions the
// field and operator in user-friendly form".

import { describe, expect, it } from 'vitest';

import { explainExpression } from './explain.js';

describe('explainExpression — non-empty for every node type', () => {
  it('eq scalar', () => {
    const out = explainExpression({ type: 'eq', field: 'card.name', value: 'Charizard' });
    expect(out).toContain('card name');
    expect(out).toContain('Charizard');
  });

  it('eq enum prettifies the value', () => {
    const out = explainExpression({ type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' });
    expect(out).toContain('rarity');
    expect(out).toContain('Holo Rare');
  });

  it('eq enumArray uses "include"', () => {
    const out = explainExpression({
      type: 'eq',
      field: 'printing.variantFlags',
      value: 'FIRST_EDITION',
    });
    expect(out).toContain('include');
    expect(out).toContain('First Edition');
  });

  it('eq isOwned=true says "owned by you"', () => {
    const out = explainExpression({ type: 'eq', field: 'collection.isOwned', value: true });
    expect(out).toBe('owned by you');
  });

  it('eq isOwned=false says "not owned by you"', () => {
    const out = explainExpression({ type: 'eq', field: 'collection.isOwned', value: false });
    expect(out).toBe('not owned by you');
  });

  it('in scalar lists values', () => {
    const out = explainExpression({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE', 'ULTRA_RARE'],
    });
    expect(out).toContain('Holo Rare');
    expect(out).toContain('Ultra Rare');
  });

  it('in enumArray uses "include any of"', () => {
    const out = explainExpression({
      type: 'in',
      field: 'printing.variantFlags',
      values: ['FIRST_EDITION', 'SHADOWLESS'],
    });
    expect(out).toContain('include any of');
  });

  it('range with both bounds inclusive uses "between"', () => {
    const out = explainExpression({ type: 'range', field: 'card.hp', min: 100, max: 250 });
    expect(out).toContain('between 100');
    expect(out).toContain('250');
  });

  it('range with only min uses "at least"', () => {
    const out = explainExpression({ type: 'range', field: 'collection.grade', min: 9 });
    expect(out).toContain('at least 9');
  });

  it('range with only max uses "at most"', () => {
    const out = explainExpression({ type: 'range', field: 'card.hp', max: 200 });
    expect(out).toContain('at most 200');
  });

  it('range with exclusive lower uses "greater than"', () => {
    const out = explainExpression({
      type: 'range',
      field: 'card.hp',
      min: 100,
      minInclusive: false,
    });
    expect(out).toContain('greater than 100');
  });

  it('range with exclusive upper uses "less than"', () => {
    const out = explainExpression({
      type: 'range',
      field: 'card.hp',
      max: 200,
      maxInclusive: false,
    });
    expect(out).toContain('less than 200');
  });

  it('range with mixed inclusivity uses ≤ and ≥', () => {
    const out = explainExpression({
      type: 'range',
      field: 'card.hp',
      min: 100,
      max: 200,
      minInclusive: false,
    });
    expect(out).toMatch(/>|≤|≥|less than|at most|greater than/);
  });

  it('range over date renders the ISO bounds', () => {
    const out = explainExpression({
      type: 'range',
      field: 'set.releaseDate',
      min: '2022-01-01',
      max: '2022-12-31',
    });
    expect(out).toContain('2022-01-01');
    expect(out).toContain('2022-12-31');
  });

  it('exists=true says "is set"', () => {
    const out = explainExpression({
      type: 'exists',
      field: 'card.illustrator',
      exists: true,
    });
    expect(out).toContain('illustrator');
    expect(out).toContain('is set');
  });

  it('exists=false says "is missing"', () => {
    const out = explainExpression({
      type: 'exists',
      field: 'card.illustrator',
      exists: false,
    });
    expect(out).toContain('is missing');
  });

  it('exists on isOwned says "owned by you"', () => {
    const out = explainExpression({
      type: 'exists',
      field: 'collection.isOwned',
      exists: true,
    });
    expect(out).toBe('owned by you');
  });

  it('and joins children with "and"', () => {
    const out = explainExpression({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        { type: 'eq', field: 'card.language', value: 'en' },
      ],
    });
    expect(out).toContain(' and ');
    expect(out).toContain('Charizard');
  });

  it('or joins children with "or"', () => {
    const out = explainExpression({
      type: 'or',
      children: [
        { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
        { type: 'eq', field: 'card.rarity', value: 'ULTRA_RARE' },
      ],
    });
    expect(out).toContain(' or ');
  });

  it('not prefixes "not"', () => {
    const out = explainExpression({
      type: 'not',
      child: { type: 'eq', field: 'card.name', value: 'Charizard' },
    });
    expect(out.startsWith('not ')).toBe(true);
  });

  it('parenthesizes OR inside AND for clarity', () => {
    const out = explainExpression({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        {
          type: 'or',
          children: [
            { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
            { type: 'eq', field: 'card.rarity', value: 'ULTRA_RARE' },
          ],
        },
      ],
    });
    expect(out).toContain('(');
    expect(out).toContain(')');
  });

  it('returns non-empty for every leaf node type', () => {
    const cases = [
      { type: 'eq', field: 'card.name', value: 'X' },
      { type: 'in', field: 'card.rarity', values: ['HOLO_RARE', 'ULTRA_RARE'] },
      { type: 'range', field: 'card.hp', min: 1 },
      { type: 'exists', field: 'card.illustrator', exists: true },
    ] as const;
    for (const c of cases) {
      expect(explainExpression(c).length).toBeGreaterThan(0);
    }
  });
});
