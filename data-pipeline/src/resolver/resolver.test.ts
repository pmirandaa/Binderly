// Resolver tests with three mock adapters (primary + two validation,
// with one filler in some cases). Cases covered:
//
//   1. primary-wins (only primary emits a record)
//   2. validation-agrees → no conflict, agreement recorded
//   3. validation-disagrees → DataConflict recorded, primary's value kept
//   4. filler-fills-null-only → primary keeps non-null, filler only fills null

import { describe, expect, it } from 'vitest';

import {
  percentDiffStrategy,
  resolveCanonicalCards,
  resolveCanonicalSets,
  setEqualityStrategy,
  stringEqualityStrategy,
  type TieredRecords,
} from './resolver.js';

import type { RawCard, RawSet } from '../types.js';

function setOf(over: Partial<RawSet>): RawSet {
  return {
    source: 'tcgdex-en',
    sourceKey: 'swsh9',
    code: 'swsh9',
    language: 'en',
    name: 'Brilliant Stars',
    series: 'Sword & Shield',
    releaseDate: '2022-02-25',
    printedTotal: 172,
    total: 186,
    logoUrl: null,
    symbolUrl: null,
    ...over,
  };
}

function cardOf(over: Partial<RawCard>): RawCard {
  return {
    source: 'tcgdex-en',
    sourceKey: 'swsh9-018',
    setCode: 'swsh9',
    language: 'en',
    number: '018',
    name: 'Charizard VSTAR',
    nameLocalized: null,
    typeRaw: 'Fire',
    subtypeRaw: 'Pokemon',
    hp: 270,
    illustrator: '5ban Graphics',
    flavorText: null,
    attacks: null,
    weakness: null,
    resistance: null,
    retreatCost: 3,
    rarityRaw: 'Rare Holo VSTAR',
    ...over,
  };
}

describe('resolveCanonicalSets', () => {
  it('primary-wins when validation/filler are absent', () => {
    const records: TieredRecords<RawSet> = {
      primary: [setOf({})],
      validation: [],
      filler: [],
    };
    const result = resolveCanonicalSets(records);
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.canonicalKey).toBe('en-swsh9');
    expect(result.canonical[0]?.name).toBe('Brilliant Stars');
    expect(result.conflicts).toEqual([]);
  });

  it('validation-agrees → no conflict, agreement recorded in source_metadata', () => {
    const records: TieredRecords<RawSet> = {
      primary: [setOf({ source: 'tcgdex-en' })],
      validation: [setOf({ source: 'ptcgio', name: 'Brilliant Stars' })],
      filler: [],
    };
    const result = resolveCanonicalSets(records);
    expect(result.conflicts).toEqual([]);
    const md = result.canonical[0]?.sourceMetadata as { validation?: Record<string, string[]> };
    expect(md.validation?.['name']).toContain('ptcgio');
    expect(md.validation?.['releaseDate']).toContain('ptcgio');
  });

  it('validation-disagrees → DataConflict recorded, primary value retained', () => {
    const records: TieredRecords<RawSet> = {
      primary: [setOf({ source: 'tcgdex-en', name: 'Brilliant Stars' })],
      validation: [setOf({ source: 'ptcgio', name: 'Brilliant Star' /* missing s */ })],
      filler: [],
    };
    const result = resolveCanonicalSets(records);
    expect(result.canonical[0]?.name).toBe('Brilliant Stars');
    expect(result.conflicts).toHaveLength(1);
    const c = result.conflicts[0]!;
    expect(c.entity).toBe('set');
    expect(c.field).toBe('name');
    expect(c.entityKey).toBe('en-swsh9');
    expect(c.chosenValue).toBe('Brilliant Stars');
    expect(c.chosenSource).toBe('tcgdex-en');
    expect(c.sources['tcgdex-en']).toBe('Brilliant Stars');
    expect(c.sources['ptcgio']).toBe('Brilliant Star');
  });

  it('filler-fills-null-only — primary keeps non-null, filler only fills null', () => {
    const records: TieredRecords<RawSet> = {
      primary: [
        setOf({ source: 'tcgdex-en', logoUrl: null, symbolUrl: 'https://example.com/sym.png' }),
      ],
      validation: [],
      filler: [
        setOf({
          source: 'pokellector',
          logoUrl: 'https://example.com/logo.png',
          symbolUrl: 'https://example.com/sym-other.png', // primary already has one — filler must NOT win
        }),
      ],
    };
    const result = resolveCanonicalSets(records);
    expect(result.canonical[0]?.logoUrl).toBe('https://example.com/logo.png');
    expect(result.canonical[0]?.symbolUrl).toBe('https://example.com/sym.png');
    const md = result.canonical[0]?.sourceMetadata as { filler?: Record<string, string> };
    expect(md.filler?.['logoUrl']).toBe('pokellector');
    expect(md.filler?.['symbolUrl']).toBeUndefined();
  });

  it('numeric tolerance: printedTotal differs by 1 within 1% tolerance is not a conflict', () => {
    const records: TieredRecords<RawSet> = {
      primary: [setOf({ source: 'tcgdex-en', printedTotal: 172 })],
      // 172 vs 173 → 0.58% diff, within 1% threshold
      validation: [setOf({ source: 'ptcgio', printedTotal: 173 })],
      filler: [],
    };
    const result = resolveCanonicalSets(records);
    expect(result.conflicts).toEqual([]);
  });

  it('numeric tolerance: large difference fires a conflict', () => {
    const records: TieredRecords<RawSet> = {
      primary: [setOf({ source: 'tcgdex-en', printedTotal: 172 })],
      validation: [setOf({ source: 'ptcgio', printedTotal: 200 })],
      filler: [],
    };
    const result = resolveCanonicalSets(records);
    expect(result.conflicts.find((c) => c.field === 'printedTotal')).toBeDefined();
  });

  it('filler-only sets surface a presence DataConflict and are NOT promoted to canonical', () => {
    const records: TieredRecords<RawSet> = {
      primary: [],
      validation: [],
      filler: [setOf({ source: 'pokellector', code: 'wizpromo' })],
    };
    const result = resolveCanonicalSets(records);
    expect(result.canonical).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe('__presence');
  });

  it('onConflict callback fires per recorded conflict', () => {
    const seen: string[] = [];
    resolveCanonicalSets(
      {
        primary: [setOf({ source: 'tcgdex-en', name: 'Brilliant Stars' })],
        validation: [setOf({ source: 'ptcgio', name: 'Different Name' })],
        filler: [],
      },
      { onConflict: (c) => seen.push(c.field) },
    );
    expect(seen).toContain('name');
  });

  it('custom merge strategy override is honored', () => {
    const records: TieredRecords<RawSet> = {
      primary: [setOf({ source: 'tcgdex-en', name: 'Brilliant Stars' })],
      validation: [setOf({ source: 'ptcgio', name: 'BRILLIANT STARS' })],
      filler: [],
    };
    // Default string equality is case-insensitive, so this would NOT
    // conflict. Override to a strict-equality strategy and verify a
    // conflict fires.
    const strict: ReturnType<typeof stringEqualityStrategy.compare> | unknown = null;
    void strict;
    const result = resolveCanonicalSets(records, {
      mergeStrategies: {
        'set.name': {
          compare: (a: string, b: string) =>
            a === b ? { agrees: true } : { agrees: false, reason: 'strict-eq mismatch' },
        },
      },
    });
    expect(result.conflicts.find((c) => c.field === 'name')).toBeDefined();
  });
});

describe('resolveCanonicalCards', () => {
  const setLookup = new Map<string, { canonicalKey: string }>([
    ['en-swsh9', { canonicalKey: 'en-swsh9' }],
  ]);

  it('builds canonical card with primary fields', () => {
    const result = resolveCanonicalCards(
      {
        primary: [cardOf({})],
        validation: [],
        filler: [],
      },
      setLookup,
    );
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]?.canonicalKey).toBe('en-swsh9-018');
    expect(result.canonical[0]?.name).toBe('Charizard VSTAR');
    expect(result.canonical[0]?.hp).toBe(270);
  });

  it('records validation conflicts on illustrator mismatch', () => {
    const result = resolveCanonicalCards(
      {
        primary: [cardOf({ source: 'tcgdex-en', illustrator: '5ban Graphics' })],
        validation: [cardOf({ source: 'ptcgio', illustrator: 'Different Artist' })],
        filler: [],
      },
      setLookup,
    );
    expect(result.canonical[0]?.illustrator).toBe('5ban Graphics');
    expect(result.conflicts.find((c) => c.field === 'illustrator')).toBeDefined();
  });

  it('filler fills missing flavor text only when primary lacks it', () => {
    const result = resolveCanonicalCards(
      {
        primary: [cardOf({ source: 'tcgdex-en', flavorText: null })],
        validation: [],
        filler: [cardOf({ source: 'serebii', flavorText: 'Filler flavor' })],
      },
      setLookup,
    );
    expect(result.canonical[0]?.flavorText).toBe('Filler flavor');
  });

  it('filler does NOT overwrite primary non-null flavor text', () => {
    const result = resolveCanonicalCards(
      {
        primary: [cardOf({ source: 'tcgdex-en', flavorText: 'Primary flavor' })],
        validation: [],
        filler: [cardOf({ source: 'serebii', flavorText: 'Filler flavor' })],
      },
      setLookup,
    );
    expect(result.canonical[0]?.flavorText).toBe('Primary flavor');
  });

  it('skips primary cards for sets the lookup does not know about', () => {
    const result = resolveCanonicalCards(
      {
        primary: [cardOf({ setCode: 'unknown-set' })],
        validation: [],
        filler: [],
      },
      setLookup,
    );
    expect(result.canonical).toEqual([]);
  });

  it('hp tolerance: equal-ish numeric values do not conflict', () => {
    const result = resolveCanonicalCards(
      {
        primary: [cardOf({ source: 'tcgdex-en', hp: 270 })],
        validation: [cardOf({ source: 'ptcgio', hp: 270 })],
        filler: [],
      },
      setLookup,
    );
    expect(result.conflicts).toEqual([]);
  });

  it('rarityRaw mismatch surfaces a DataConflict', () => {
    const result = resolveCanonicalCards(
      {
        primary: [cardOf({ source: 'tcgdex-en', rarityRaw: 'Rare Holo VSTAR' })],
        validation: [cardOf({ source: 'ptcgio', rarityRaw: 'Hyper Rare' })],
        filler: [],
      },
      setLookup,
    );
    expect(result.conflicts.find((c) => c.field === 'rarityRaw')).toBeDefined();
    expect(result.canonical[0]?.sourceMetadata['rarityRaw']).toBe('Rare Holo VSTAR');
  });
});

describe('merge strategies', () => {
  it('percentDiffStrategy at 1%: 100 vs 100.5 agrees', () => {
    expect(percentDiffStrategy(1).compare(100, 100.5)).toEqual({ agrees: true });
  });

  it('percentDiffStrategy at 1%: 100 vs 102 disagrees', () => {
    const out = percentDiffStrategy(1).compare(100, 102);
    expect(out.agrees).toBe(false);
  });

  it('setEqualityStrategy: same elements in different order agree', () => {
    expect(setEqualityStrategy.compare([1, 2, 3], [3, 2, 1])).toEqual({ agrees: true });
  });

  it('setEqualityStrategy: different lengths disagree', () => {
    expect(setEqualityStrategy.compare([1, 2], [1, 2, 3]).agrees).toBe(false);
  });

  it('stringEqualityStrategy: case-insensitive trim equality', () => {
    expect(stringEqualityStrategy.compare(' Brilliant Stars ', 'BRILLIANT STARS ')).toEqual({
      agrees: true,
    });
  });
});
