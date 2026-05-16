// Tests for the pure evaluator. Each leaf operator gets coverage on
// representative items; AND/OR/NOT short-circuit / negation
// behaviours get explicit cases. NULL semantics ("missing operand
// → leaf is false") are verified for every leaf.

import { describe, expect, it } from 'vitest';

import { evaluateExpression } from './evaluate.js';

import type { CandidateItem, Expression } from './types.js';

// ============================================================
// Fixtures
// ============================================================

const charizardSwsh9: CandidateItem = {
  card: {
    name: 'Charizard VSTAR',
    number: '018',
    illustrator: '5ban Graphics',
    language: 'en',
    type: 'FIRE',
    subtype: 'POKEMON',
    rarity: 'ULTRA_RARE',
    hp: 270,
    retreatCost: 2,
  },
  set: {
    code: 'swsh9',
    name: 'Brilliant Stars',
    series: 'Sword & Shield',
    language: 'en',
    releaseDate: '2022-02-25',
    printedTotal: 172,
    total: 186,
  },
  printing: {
    variantClass: 'HOLO',
    variantFlags: ['FIRST_EDITION'],
    variantCode: 'HOLO',
    includeInMasterSet: true,
  },
  collection: {
    condition: 'NEAR_MINT',
    gradeCompany: 'PSA',
    grade: 9,
    quantity: 2,
    acquiredAt: '2024-08-01',
  },
};

const blastoiseRaw: CandidateItem = {
  card: {
    name: 'Blastoise',
    number: '009',
    illustrator: null,
    language: 'en',
    type: 'WATER',
    subtype: 'POKEMON',
    rarity: 'HOLO_RARE',
    hp: 120,
    retreatCost: 3,
  },
  set: {
    code: 'base1',
    name: 'Base Set',
    series: 'Base',
    language: 'en',
    releaseDate: '1999-01-09',
    printedTotal: 102,
    total: 102,
  },
  printing: {
    variantClass: 'HOLO',
    variantFlags: ['SHADOWLESS'],
    variantCode: 'HOLO-SHADOWLESS',
    includeInMasterSet: true,
  },
  // Not owned.
};

// ============================================================
// EQ
// ============================================================

describe('evaluateExpression — eq', () => {
  it('matches a string value', () => {
    expect(
      evaluateExpression(
        { type: 'eq', field: 'card.name', value: 'Charizard VSTAR' },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('rejects a different string value', () => {
    expect(
      evaluateExpression({ type: 'eq', field: 'card.name', value: 'Pikachu' }, charizardSwsh9),
    ).toBe(false);
  });

  it('matches an enum value', () => {
    expect(
      evaluateExpression({ type: 'eq', field: 'card.rarity', value: 'ULTRA_RARE' }, charizardSwsh9),
    ).toBe(true);
  });

  it('matches a number value', () => {
    expect(evaluateExpression({ type: 'eq', field: 'card.hp', value: 270 }, charizardSwsh9)).toBe(
      true,
    );
  });

  it('matches a boolean value', () => {
    expect(
      evaluateExpression(
        { type: 'eq', field: 'printing.includeInMasterSet', value: true },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('matches an enumArray "contains" value', () => {
    expect(
      evaluateExpression(
        { type: 'eq', field: 'printing.variantFlags', value: 'FIRST_EDITION' },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('rejects an enumArray "contains" miss', () => {
    expect(
      evaluateExpression(
        { type: 'eq', field: 'printing.variantFlags', value: 'SHADOWLESS' },
        charizardSwsh9,
      ),
    ).toBe(false);
  });

  it('returns false on a null operand (illustrator)', () => {
    expect(
      evaluateExpression({ type: 'eq', field: 'card.illustrator', value: 'Anyone' }, blastoiseRaw),
    ).toBe(false);
  });

  it('returns false on a missing collection (gradeCompany)', () => {
    expect(
      evaluateExpression(
        { type: 'eq', field: 'collection.gradeCompany', value: 'PSA' },
        blastoiseRaw,
      ),
    ).toBe(false);
  });

  it('handles synthetic isOwned=true', () => {
    expect(
      evaluateExpression({ type: 'eq', field: 'collection.isOwned', value: true }, charizardSwsh9),
    ).toBe(true);
    expect(
      evaluateExpression({ type: 'eq', field: 'collection.isOwned', value: true }, blastoiseRaw),
    ).toBe(false);
  });

  it('handles synthetic isOwned=false', () => {
    expect(
      evaluateExpression({ type: 'eq', field: 'collection.isOwned', value: false }, charizardSwsh9),
    ).toBe(false);
    expect(
      evaluateExpression({ type: 'eq', field: 'collection.isOwned', value: false }, blastoiseRaw),
    ).toBe(true);
  });
});

// ============================================================
// IN
// ============================================================

describe('evaluateExpression — in', () => {
  it('matches when the value is in the list', () => {
    expect(
      evaluateExpression(
        { type: 'in', field: 'card.rarity', values: ['HOLO_RARE', 'ULTRA_RARE'] },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('rejects when the value is not in the list', () => {
    expect(
      evaluateExpression(
        { type: 'in', field: 'card.rarity', values: ['COMMON', 'UNCOMMON'] },
        charizardSwsh9,
      ),
    ).toBe(false);
  });

  it('matches an enumArray overlap', () => {
    expect(
      evaluateExpression(
        {
          type: 'in',
          field: 'printing.variantFlags',
          values: ['STAMPED_PRERELEASE', 'FIRST_EDITION'],
        },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('rejects an enumArray with no overlap', () => {
    expect(
      evaluateExpression(
        {
          type: 'in',
          field: 'printing.variantFlags',
          values: ['SHADOWLESS', 'STAMPED_STAFF'],
        },
        charizardSwsh9,
      ),
    ).toBe(false);
  });

  it('returns false for null operand', () => {
    expect(
      evaluateExpression(
        { type: 'in', field: 'card.illustrator', values: ['A', 'B'] },
        blastoiseRaw,
      ),
    ).toBe(false);
  });

  it('handles synthetic isOwned with both values', () => {
    expect(
      evaluateExpression(
        { type: 'in', field: 'collection.isOwned', values: [true, false] },
        charizardSwsh9,
      ),
    ).toBe(true);
    expect(
      evaluateExpression(
        { type: 'in', field: 'collection.isOwned', values: [true, false] },
        blastoiseRaw,
      ),
    ).toBe(true);
  });
});

// ============================================================
// RANGE
// ============================================================

describe('evaluateExpression — range', () => {
  it('matches inclusive number range', () => {
    expect(
      evaluateExpression({ type: 'range', field: 'card.hp', min: 200, max: 300 }, charizardSwsh9),
    ).toBe(true);
  });

  it('rejects outside number range', () => {
    expect(
      evaluateExpression({ type: 'range', field: 'card.hp', min: 50, max: 100 }, charizardSwsh9),
    ).toBe(false);
  });

  it('inclusive lower bound matches at the boundary', () => {
    expect(evaluateExpression({ type: 'range', field: 'card.hp', min: 270 }, charizardSwsh9)).toBe(
      true,
    );
  });

  it('exclusive lower bound rejects at the boundary', () => {
    expect(
      evaluateExpression(
        { type: 'range', field: 'card.hp', min: 270, minInclusive: false },
        charizardSwsh9,
      ),
    ).toBe(false);
  });

  it('inclusive upper bound matches at the boundary', () => {
    expect(evaluateExpression({ type: 'range', field: 'card.hp', max: 270 }, charizardSwsh9)).toBe(
      true,
    );
  });

  it('exclusive upper bound rejects at the boundary', () => {
    expect(
      evaluateExpression(
        { type: 'range', field: 'card.hp', max: 270, maxInclusive: false },
        charizardSwsh9,
      ),
    ).toBe(false);
  });

  it('matches an open-ended min only', () => {
    expect(evaluateExpression({ type: 'range', field: 'card.hp', min: 200 }, charizardSwsh9)).toBe(
      true,
    );
  });

  it('matches an open-ended max only', () => {
    expect(evaluateExpression({ type: 'range', field: 'card.hp', max: 300 }, charizardSwsh9)).toBe(
      true,
    );
  });

  it('matches an inclusive ISO date range', () => {
    expect(
      evaluateExpression(
        {
          type: 'range',
          field: 'set.releaseDate',
          min: '2022-01-01',
          max: '2022-12-31',
        },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('rejects an ISO date range outside', () => {
    expect(
      evaluateExpression(
        {
          type: 'range',
          field: 'set.releaseDate',
          min: '2023-01-01',
          max: '2023-12-31',
        },
        charizardSwsh9,
      ),
    ).toBe(false);
  });

  it('returns false on null operand (collection.grade missing)', () => {
    expect(
      evaluateExpression({ type: 'range', field: 'collection.grade', min: 9 }, blastoiseRaw),
    ).toBe(false);
  });

  it('handles a numeric grade', () => {
    expect(
      evaluateExpression({ type: 'range', field: 'collection.grade', min: 9 }, charizardSwsh9),
    ).toBe(true);
  });
});

// ============================================================
// EXISTS
// ============================================================

describe('evaluateExpression — exists', () => {
  it('exists=true returns true when present', () => {
    expect(
      evaluateExpression(
        { type: 'exists', field: 'card.illustrator', exists: true },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('exists=true returns false when missing', () => {
    expect(
      evaluateExpression({ type: 'exists', field: 'card.illustrator', exists: true }, blastoiseRaw),
    ).toBe(false);
  });

  it('exists=false returns true when missing', () => {
    expect(
      evaluateExpression(
        { type: 'exists', field: 'card.illustrator', exists: false },
        blastoiseRaw,
      ),
    ).toBe(true);
  });

  it('exists=true on isOwned matches owned items', () => {
    expect(
      evaluateExpression(
        { type: 'exists', field: 'collection.isOwned', exists: true },
        charizardSwsh9,
      ),
    ).toBe(true);
  });

  it('exists=true on isOwned rejects unowned items', () => {
    expect(
      evaluateExpression(
        { type: 'exists', field: 'collection.isOwned', exists: true },
        blastoiseRaw,
      ),
    ).toBe(false);
  });

  it('exists=false on isOwned matches unowned items', () => {
    expect(
      evaluateExpression(
        { type: 'exists', field: 'collection.isOwned', exists: false },
        blastoiseRaw,
      ),
    ).toBe(true);
  });

  it('exists on enumArray returns true (array always present)', () => {
    expect(
      evaluateExpression(
        { type: 'exists', field: 'printing.variantFlags', exists: true },
        charizardSwsh9,
      ),
    ).toBe(true);
  });
});

// ============================================================
// AND / OR / NOT
// ============================================================

describe('evaluateExpression — boolean combinators', () => {
  const matches: Expression = {
    type: 'eq',
    field: 'card.name',
    value: 'Charizard VSTAR',
  };
  const fails: Expression = {
    type: 'eq',
    field: 'card.name',
    value: 'Mew',
  };

  it('AND of all true is true', () => {
    expect(evaluateExpression({ type: 'and', children: [matches, matches] }, charizardSwsh9)).toBe(
      true,
    );
  });

  it('AND with any false is false', () => {
    expect(evaluateExpression({ type: 'and', children: [matches, fails] }, charizardSwsh9)).toBe(
      false,
    );
  });

  it('OR with any true is true', () => {
    expect(evaluateExpression({ type: 'or', children: [fails, matches] }, charizardSwsh9)).toBe(
      true,
    );
  });

  it('OR of all false is false', () => {
    expect(evaluateExpression({ type: 'or', children: [fails, fails] }, charizardSwsh9)).toBe(
      false,
    );
  });

  it('NOT inverts true → false', () => {
    expect(evaluateExpression({ type: 'not', child: matches }, charizardSwsh9)).toBe(false);
  });

  it('NOT inverts false → true', () => {
    expect(evaluateExpression({ type: 'not', child: fails }, charizardSwsh9)).toBe(true);
  });

  it('NOT(NOT(x)) is identity for true', () => {
    expect(
      evaluateExpression({ type: 'not', child: { type: 'not', child: matches } }, charizardSwsh9),
    ).toBe(true);
  });

  it('NOT(NOT(x)) is identity for false', () => {
    expect(
      evaluateExpression({ type: 'not', child: { type: 'not', child: fails } }, charizardSwsh9),
    ).toBe(false);
  });

  it('AND short-circuits empty children to true', () => {
    // Schema rejects this but the evaluator gracefully handles it.
    expect(evaluateExpression({ type: 'and', children: [] }, charizardSwsh9)).toBe(true);
  });

  it('OR short-circuits empty children to false', () => {
    expect(evaluateExpression({ type: 'or', children: [] }, charizardSwsh9)).toBe(false);
  });
});

// ============================================================
// PROJECT.md § 9 examples
// ============================================================

describe('evaluateExpression — PROJECT.md § 9 examples', () => {
  it('"all Charizards in any Sword & Shield-era set"', () => {
    const expr: Expression = {
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard VSTAR' },
        { type: 'eq', field: 'set.series', value: 'Sword & Shield' },
      ],
    };
    expect(evaluateExpression(expr, charizardSwsh9)).toBe(true);
    expect(evaluateExpression(expr, blastoiseRaw)).toBe(false);
  });

  it('"every full-art trainer in some set"', () => {
    const expr: Expression = {
      type: 'and',
      children: [
        { type: 'eq', field: 'card.subtype', value: 'TRAINER_SUPPORTER' },
        { type: 'eq', field: 'printing.variantClass', value: 'FULL_ART' },
      ],
    };
    expect(evaluateExpression(expr, charizardSwsh9)).toBe(false);
  });

  it('"all gold cards I don\'t own yet"', () => {
    const expr: Expression = {
      type: 'and',
      children: [
        { type: 'eq', field: 'printing.variantClass', value: 'GOLD' },
        { type: 'eq', field: 'collection.isOwned', value: false },
      ],
    };
    expect(evaluateExpression(expr, blastoiseRaw)).toBe(false);
  });

  it('"PSA 9 or better Charizards"', () => {
    const expr: Expression = {
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard VSTAR' },
        { type: 'eq', field: 'collection.gradeCompany', value: 'PSA' },
        { type: 'range', field: 'collection.grade', min: 9 },
      ],
    };
    expect(evaluateExpression(expr, charizardSwsh9)).toBe(true);
  });
});
