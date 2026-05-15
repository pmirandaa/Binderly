import { describe, expect, it } from 'vitest';

import { computeCompletion } from './aggregate.js';
import {
  brilliantStars,
  buildLargeRoster,
  hiddenFates,
  multiSetRoster,
  printing,
  printingId,
} from './test-fixtures.js';

describe('computeCompletion — empty / boundary inputs', () => {
  it('every input empty ⇒ empty perSet, zero global', () => {
    const result = computeCompletion({
      cards: [],
      printings: [],
      ownedPrintingIds: [],
    });
    expect(result.perSet).toEqual([]);
    expect(result.global).toEqual({
      allPokemonPct: 0,
      masterPct: 0,
      uniqueCardsOwned: 0,
      uniqueCardsTotal: 0,
      masterOwned: 0,
      masterTotal: 0,
    });
  });

  it('explicit `sets` with empty roster ⇒ zero-result entries in supplied order', () => {
    const result = computeCompletion({
      cards: [],
      printings: [],
      ownedPrintingIds: [],
      sets: ['set:a', 'set:b'],
    });
    expect(result.perSet).toHaveLength(2);
    expect(result.perSet[0]).toEqual({
      setId: 'set:a',
      setPct: 0,
      masterPct: 0,
      ownedNumbered: 0,
      totalNumbered: 0,
      ownedMaster: 0,
      totalMaster: 0,
    });
    expect(result.perSet[1]!.setId).toBe('set:b');
  });
});

describe('computeCompletion — full / partial', () => {
  it('full collection (every printing owned) ⇒ every percentage 100', () => {
    const fx = multiSetRoster();
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    for (const set of result.perSet) {
      expect(set.setPct).toBe(100);
      expect(set.masterPct).toBe(100);
    }
    expect(result.global.allPokemonPct).toBe(100);
    expect(result.global.masterPct).toBe(100);
  });

  it('multi-set roster ⇒ both BS and HF appear in perSet (default ordering)', () => {
    const fx = multiSetRoster();
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.perSet.map((s) => s.setId)).toEqual(['set:brilliant-stars', 'set:hidden-fates']);
  });

  it('default-order matches first-seen order from `printings`, not `cards`', () => {
    const bs = brilliantStars();
    const hf = hiddenFates();
    // Reverse the cards order; printings still BS first.
    const result = computeCompletion({
      cards: [...hf.cards, ...bs.cards],
      printings: [...bs.printings, ...hf.printings],
      ownedPrintingIds: [],
    });
    expect(result.perSet.map((s) => s.setId)).toEqual(['set:brilliant-stars', 'set:hidden-fates']);
  });

  it('explicit `sets` argument pins per-set output order', () => {
    const fx = multiSetRoster();
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [],
      sets: ['set:hidden-fates', 'set:brilliant-stars'],
    });
    expect(result.perSet.map((s) => s.setId)).toEqual(['set:hidden-fates', 'set:brilliant-stars']);
  });

  it('explicit `sets` containing an unknown id ⇒ zero-result for that id', () => {
    const fx = multiSetRoster();
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
      sets: ['set:hidden-fates', 'set:not-in-roster'],
    });
    expect(result.perSet[0]).toMatchObject({
      setId: 'set:hidden-fates',
      setPct: 100,
    });
    expect(result.perSet[1]).toEqual({
      setId: 'set:not-in-roster',
      setPct: 0,
      masterPct: 0,
      ownedNumbered: 0,
      totalNumbered: 0,
      ownedMaster: 0,
      totalMaster: 0,
    });
  });
});

describe('computeCompletion — per-set + global agree with per-metric functions', () => {
  it('aggregate per-set Set% / Master% match per-metric outputs', () => {
    const fx = multiSetRoster();
    const owned = [
      printingId('set:brilliant-stars', '001', 'holo'),
      printingId('set:brilliant-stars', '002', 'reverse'),
      printingId('set:hidden-fates', 'SV001', 'shiny-vault'),
    ];
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    const bs = result.perSet.find((s) => s.setId === 'set:brilliant-stars')!;
    expect(bs.ownedNumbered).toBe(2);
    expect(bs.totalNumbered).toBe(3);
    expect(bs.ownedMaster).toBe(2);
    expect(bs.totalMaster).toBe(6);
    expect(bs.setPct).toBeCloseTo((2 / 3) * 100, 6);
    expect(bs.masterPct).toBeCloseTo((2 / 6) * 100, 6);

    const hf = result.perSet.find((s) => s.setId === 'set:hidden-fates')!;
    expect(hf.ownedNumbered).toBe(1);
    expect(hf.totalNumbered).toBe(2);
    expect(hf.ownedMaster).toBe(1);
    expect(hf.totalMaster).toBe(3);
  });

  it('aggregate global counts match the per-metric outputs', () => {
    const fx = multiSetRoster();
    const owned = [
      printingId('set:brilliant-stars', '001', 'holo'),
      printingId('set:brilliant-stars', '002', 'reverse'),
      printingId('set:hidden-fates', 'SV001', 'shiny-vault'),
    ];
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    expect(result.global.uniqueCardsOwned).toBe(3);
    expect(result.global.uniqueCardsTotal).toBe(5);
    expect(result.global.masterOwned).toBe(3);
    expect(result.global.masterTotal).toBe(9);
    expect(result.global.allPokemonPct).toBe(60);
    expect(result.global.masterPct).toBeCloseTo((3 / 9) * 100, 6);
  });

  it('owning ALL non-master printings (and nothing else) ⇒ Master%=0', () => {
    const setId = 'set:non-master-only';
    const printings = [
      printing(setId, '001', 'staff', { includeInMasterSet: false }),
      printing(setId, '001', 'error', { includeInMasterSet: false }),
    ];
    const result = computeCompletion({
      cards: [{ cardId: `card:${setId}-001`, setId }],
      printings,
      ownedPrintingIds: printings.map((p) => p.printingId),
    });
    const set = result.perSet[0]!;
    // Set %=100 (owns the staff promo, which credits the card).
    expect(set.setPct).toBe(100);
    // Master %: 0/0 → 0.
    expect(set.masterPct).toBe(0);
    expect(set.totalMaster).toBe(0);
    // Global master also 0/0 → 0.
    expect(result.global.masterPct).toBe(0);
  });
});

describe('computeCompletion — idempotency / determinism', () => {
  it('two identical calls return deeply-equal results', () => {
    const fx = multiSetRoster();
    const args = {
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId('set:brilliant-stars', '001', 'holo'),
        printingId('set:hidden-fates', 'SV001', 'holo'),
      ],
    };
    const a = computeCompletion(args);
    const b = computeCompletion(args);
    expect(a).toEqual(b);
  });

  it('explicit `sets` ordering is preserved on repeat call', () => {
    const fx = multiSetRoster();
    const args = {
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [],
      sets: ['set:hidden-fates', 'set:brilliant-stars'],
    };
    expect(computeCompletion(args).perSet.map((s) => s.setId)).toEqual([
      'set:hidden-fates',
      'set:brilliant-stars',
    ]);
    expect(computeCompletion(args).perSet.map((s) => s.setId)).toEqual([
      'set:hidden-fates',
      'set:brilliant-stars',
    ]);
  });

  it('reordering inputs preserves first-seen-order semantics', () => {
    const bs = brilliantStars();
    const hf = hiddenFates();
    const aResult = computeCompletion({
      cards: [...bs.cards, ...hf.cards],
      printings: [...bs.printings, ...hf.printings],
      ownedPrintingIds: [],
    });
    const bResult = computeCompletion({
      cards: [...hf.cards, ...bs.cards],
      printings: [...hf.printings, ...bs.printings],
      ownedPrintingIds: [],
    });
    // Different first-seen ordering ⇒ different perSet ordering;
    // but the global is identical.
    expect(aResult.perSet.map((s) => s.setId)).toEqual(['set:brilliant-stars', 'set:hidden-fates']);
    expect(bResult.perSet.map((s) => s.setId)).toEqual(['set:hidden-fates', 'set:brilliant-stars']);
    expect(aResult.global).toEqual(bResult.global);
  });

  it('does not mutate input arrays', () => {
    const fx = multiSetRoster();
    const cardsCopy = JSON.parse(JSON.stringify(fx.cards));
    const printingsCopy = JSON.parse(JSON.stringify(fx.printings));
    const owned = [printingId('set:brilliant-stars', '001', 'holo')];
    const ownedCopy = [...owned];
    const sets = ['set:brilliant-stars'];
    const setsCopy = [...sets];
    computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
      sets,
    });
    expect(fx.cards).toEqual(cardsCopy);
    expect(fx.printings).toEqual(printingsCopy);
    expect(owned).toEqual(ownedCopy);
    expect(sets).toEqual(setsCopy);
  });
});

describe('computeCompletion — output shape', () => {
  it('perSet entry has the documented six-field shape', () => {
    const fx = brilliantStars();
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(Object.keys(result.perSet[0] ?? {}).sort()).toEqual([
      'masterPct',
      'ownedMaster',
      'ownedNumbered',
      'setId',
      'setPct',
      'totalMaster',
      'totalNumbered',
    ]);
  });

  it('global has the documented six-field shape', () => {
    const fx = brilliantStars();
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(Object.keys(result.global).sort()).toEqual([
      'allPokemonPct',
      'masterOwned',
      'masterPct',
      'masterTotal',
      'uniqueCardsOwned',
      'uniqueCardsTotal',
    ]);
  });

  it('every percentage is in [0, 100]', () => {
    const fx = multiSetRoster();
    const owned = fx.printings.slice(0, 3).map((p) => p.printingId);
    const result = computeCompletion({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    for (const set of result.perSet) {
      expect(set.setPct).toBeGreaterThanOrEqual(0);
      expect(set.setPct).toBeLessThanOrEqual(100);
      expect(set.masterPct).toBeGreaterThanOrEqual(0);
      expect(set.masterPct).toBeLessThanOrEqual(100);
    }
    expect(result.global.allPokemonPct).toBeGreaterThanOrEqual(0);
    expect(result.global.allPokemonPct).toBeLessThanOrEqual(100);
    expect(result.global.masterPct).toBeGreaterThanOrEqual(0);
    expect(result.global.masterPct).toBeLessThanOrEqual(100);
  });
});

describe('computeCompletion — performance', () => {
  // Acceptance criterion: 5,000-item collection vs 30,000-printing
  // catalog completes in < 100ms wall-clock. Build a roster of the
  // documented scale and time the call. Test is deterministic
  // (no randomness in the fixture builder).
  it('5,000 owned items vs ~30,000 printings completes in < 100ms', () => {
    // 100 sets × 200 cards × ~1.5 printings/card avg ≈ 30k printings.
    // 100 sets × 200 cards = 20k cards.
    const roster = buildLargeRoster({
      nSets: 100,
      cardsPerSet: 200,
      printingsPerCard: 2, // 100 × 200 × 2 = 40k printings (slightly above 30k for headroom).
    });
    expect(roster.printings.length).toBeGreaterThanOrEqual(30000);
    expect(roster.cards.length).toBeGreaterThanOrEqual(20000);

    // Pick 5,000 deterministically — every 8th printing (40k/8 = 5k).
    const ownedPrintingIds: string[] = [];
    for (let i = 0; i < roster.printings.length; i += 8) {
      ownedPrintingIds.push(roster.printings[i]!.printingId);
    }
    expect(ownedPrintingIds.length).toBeGreaterThanOrEqual(5000);

    const start = performance.now();
    const result = computeCompletion({
      cards: roster.cards,
      printings: roster.printings,
      ownedPrintingIds,
    });
    const elapsed = performance.now() - start;

    // Sanity-check the output before asserting on performance —
    // a fast wrong answer is worse than a slow right answer.
    expect(result.perSet.length).toBe(100);
    expect(result.global.uniqueCardsTotal).toBe(roster.cards.length);
    expect(result.global.uniqueCardsOwned).toBeGreaterThan(0);
    expect(result.global.masterTotal).toBeGreaterThan(0);

    // Performance assertion — < 100ms per the acceptance criterion.
    expect(elapsed).toBeLessThan(100);
  });

  it('repeat-call performance is stable (no global state accretion)', () => {
    const roster = buildLargeRoster({
      nSets: 50,
      cardsPerSet: 200,
      printingsPerCard: 2,
    });
    const ownedPrintingIds = roster.printings
      .filter((_, i) => i % 4 === 0)
      .map((p) => p.printingId);

    // Warmup.
    computeCompletion({
      cards: roster.cards,
      printings: roster.printings,
      ownedPrintingIds,
    });

    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      computeCompletion({
        cards: roster.cards,
        printings: roster.printings,
        ownedPrintingIds,
      });
      times.push(performance.now() - start);
    }
    // No call exceeds 100ms — global state would manifest as
    // cumulative slowdown.
    for (const t of times) expect(t).toBeLessThan(100);
  });
});
