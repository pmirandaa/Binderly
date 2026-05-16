// Tests for `types.ts` — the field allowlist and the `isField` /
// `getFieldDef` helpers. These are the foundation every other
// module dispatches off, so we verify the metadata shape carefully.

import { describe, expect, it } from 'vitest';

import { FIELDS, FIELD_DEFS, getFieldDef, isField } from './types.js';

describe('FIELD_DEFS', () => {
  it('exposes every entity prefix at least once', () => {
    const prefixes = new Set(FIELDS.map((f) => f.split('.')[0]));
    expect(prefixes.has('card')).toBe(true);
    expect(prefixes.has('set')).toBe(true);
    expect(prefixes.has('printing')).toBe(true);
    expect(prefixes.has('collection')).toBe(true);
  });

  it('every field has a non-empty SQL column ref', () => {
    for (const field of FIELDS) {
      const def = FIELD_DEFS[field];
      expect(def.sqlColumn.length).toBeGreaterThan(0);
      expect(def.sqlColumn).toContain('.');
    }
  });

  it('every enum/enumArray field has a non-empty enumValues list', () => {
    for (const field of FIELDS) {
      const def = FIELD_DEFS[field];
      if (def.kind === 'enum' || def.kind === 'enumArray') {
        expect(def.enumValues.length).toBeGreaterThan(0);
      }
    }
  });

  it('exposes the PROJECT.md § 9 fields', () => {
    expect(isField('card.name')).toBe(true);
    expect(isField('card.subtype')).toBe(true);
    expect(isField('card.rarity')).toBe(true);
    expect(isField('set.series')).toBe(true);
    expect(isField('set.code')).toBe(true);
    expect(isField('card.language')).toBe(true);
    expect(isField('printing.variantClass')).toBe(true);
    expect(isField('collection.isOwned')).toBe(true);
  });

  it('exposes the grading-prediction fields used by Pro features', () => {
    expect(isField('collection.grade')).toBe(true);
    expect(isField('collection.gradeCompany')).toBe(true);
  });
});

describe('isField', () => {
  it('returns true for known fields', () => {
    expect(isField('card.name')).toBe(true);
    expect(isField('set.releaseDate')).toBe(true);
  });

  it('returns false for unknown strings', () => {
    expect(isField('card.unknownField')).toBe(false);
    expect(isField('nope.nope')).toBe(false);
    expect(isField('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isField(undefined)).toBe(false);
    expect(isField(null)).toBe(false);
    expect(isField(42)).toBe(false);
    expect(isField({})).toBe(false);
    expect(isField([])).toBe(false);
  });
});

describe('getFieldDef', () => {
  it('returns the def for a known field', () => {
    const def = getFieldDef('card.name');
    expect(def.kind).toBe('string');
    expect(def.sqlColumn).toBe('card.name');
  });

  it('throws for an unknown field at runtime', () => {
    expect(() => getFieldDef('not.a.field' as never)).toThrow(/unknown field/);
  });

  it('marks `card.name` as non-nullable', () => {
    expect(getFieldDef('card.name').nullable).toBe(false);
  });

  it('marks `card.illustrator` as nullable', () => {
    expect(getFieldDef('card.illustrator').nullable).toBe(true);
  });

  it('marks `printing.variantFlags` as enumArray', () => {
    expect(getFieldDef('printing.variantFlags').kind).toBe('enumArray');
  });

  it('marks `printing.includeInMasterSet` as boolean', () => {
    expect(getFieldDef('printing.includeInMasterSet').kind).toBe('boolean');
  });

  it('marks `set.releaseDate` as date', () => {
    expect(getFieldDef('set.releaseDate').kind).toBe('date');
  });

  it('marks `card.hp` as number', () => {
    expect(getFieldDef('card.hp').kind).toBe('number');
  });
});
