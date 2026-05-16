import { describe, expect, it } from 'vitest';

import { computeMasterSetPct } from './master-pct.js';
import { computeSetPct } from './set-pct.js';
import { brilliantStars, errorsOnly, printing, printingId } from './test-fixtures.js';

describe('computeMasterSetPct — empty / boundary inputs', () => {
  it('empty printings + empty owned ⇒ pct=0, totals=0', () => {
    const result = computeMasterSetPct({
      setId: 'set:nope',
      printings: [],
      ownedPrintingIds: [],
    });
    expect(result).toEqual({
      setId: 'set:nope',
      pct: 0,
      ownedMaster: 0,
      totalMaster: 0,
    });
  });

  it('printings present but ownedPrintingIds empty ⇒ pct=0', () => {
    const fx = brilliantStars();
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.pct).toBe(0);
    expect(result.ownedMaster).toBe(0);
    expect(result.totalMaster).toBe(6);
  });

  it('every printing has includeInMasterSet=false ⇒ pct=0, totalMaster=0', () => {
    const fx = errorsOnly();
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    expect(result.totalMaster).toBe(0);
    expect(result.ownedMaster).toBe(0);
    expect(result.pct).toBe(0);
  });

  it('querying a setId not in the roster ⇒ zero result', () => {
    const fx = brilliantStars();
    const result = computeMasterSetPct({
      setId: 'set:does-not-exist',
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    expect(result.totalMaster).toBe(0);
    expect(result.pct).toBe(0);
  });
});

describe('computeMasterSetPct — full / partial', () => {
  it('owns every master-set printing ⇒ pct=100, totalMaster=ownedMaster', () => {
    const fx = brilliantStars();
    const masterIds = fx.printings.filter((p) => p.includeInMasterSet).map((p) => p.printingId);
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: masterIds,
    });
    expect(result).toEqual({
      setId: fx.setId,
      pct: 100,
      ownedMaster: 6,
      totalMaster: 6,
    });
  });

  it('owns 50% (3 of 6) of master printings ⇒ pct=50', () => {
    const fx = brilliantStars();
    const masterIds = fx.printings
      .filter((p) => p.includeInMasterSet)
      .slice(0, 3)
      .map((p) => p.printingId);
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: masterIds,
    });
    expect(result.pct).toBe(50);
    expect(result.ownedMaster).toBe(3);
    expect(result.totalMaster).toBe(6);
  });

  it('owns 1 of 6 ⇒ pct ≈ 16.66', () => {
    const fx = brilliantStars();
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'holo')],
    });
    expect(result.pct).toBeCloseTo((1 / 6) * 100, 6);
    expect(result.ownedMaster).toBe(1);
  });

  it('owns 5 of 6 ⇒ pct ≈ 83.33', () => {
    const fx = brilliantStars();
    const masterIds = fx.printings
      .filter((p) => p.includeInMasterSet)
      .slice(0, 5)
      .map((p) => p.printingId);
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: masterIds,
    });
    expect(result.pct).toBeCloseTo((5 / 6) * 100, 6);
  });
});

describe('computeMasterSetPct — non-master printings are excluded', () => {
  it('owning a STAFF promo (includeInMasterSet=false) does NOT increment ownedMaster', () => {
    const fx = brilliantStars();
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '003', 'staff')],
    });
    expect(result.ownedMaster).toBe(0);
    expect(result.pct).toBe(0);
  });

  it('owning a STAFF promo does NOT increment totalMaster either', () => {
    const fx = brilliantStars();
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.totalMaster).toBe(6);
  });

  it('a roster mixing master+non-master printings counts correctly', () => {
    const setId = 'set:mix';
    const printings = [
      printing(setId, '001', 'holo', { includeInMasterSet: true }),
      printing(setId, '001', 'reverse', { includeInMasterSet: true }),
      printing(setId, '001', 'staff', { includeInMasterSet: false }),
      printing(setId, '001', 'error', { includeInMasterSet: false }),
    ];
    // Owns 1 master + both non-master.
    const result = computeMasterSetPct({
      setId,
      printings,
      ownedPrintingIds: [
        printings[0]!.printingId,
        printings[2]!.printingId,
        printings[3]!.printingId,
      ],
    });
    expect(result.totalMaster).toBe(2);
    expect(result.ownedMaster).toBe(1);
    expect(result.pct).toBe(50);
  });
});

describe('computeMasterSetPct — robustness', () => {
  it('owned printing not in roster is silently ignored', () => {
    const fx = brilliantStars();
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'holo'), 'printing:ghost'],
    });
    expect(result.ownedMaster).toBe(1);
  });

  it('duplicate ownedPrintingIds collapse', () => {
    const fx = brilliantStars();
    const id = printingId(fx.setId, '001', 'holo');
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: [id, id, id, id, id],
    });
    expect(result.ownedMaster).toBe(1);
  });

  it('printings of OTHER sets are not counted', () => {
    const fx = brilliantStars();
    const otherSetPrinting = printing('set:elsewhere', '001', 'holo');
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: [...fx.printings, otherSetPrinting],
      ownedPrintingIds: [otherSetPrinting.printingId],
    });
    expect(result.ownedMaster).toBe(0);
    expect(result.totalMaster).toBe(6);
  });

  it('result.setId mirrors input setId verbatim', () => {
    const result = computeMasterSetPct({
      setId: 'set:passthrough',
      printings: [],
      ownedPrintingIds: [],
    });
    expect(result.setId).toBe('set:passthrough');
  });
});

describe('computeMasterSetPct — relationship to Set %', () => {
  it('PROJECT.md § 8 case: only base-printings owned ⇒ Set %=100, Master %<100', () => {
    const fx = brilliantStars();
    // Owns the "base" printing of every card (HOLO for 001,
    // NON_HOLO for 002, NON_HOLO for 003) — and nothing else.
    const baseOnly = [
      printingId(fx.setId, '001', 'holo'),
      printingId(fx.setId, '002', 'nonholo'),
      printingId(fx.setId, '003', 'nonholo'),
    ];
    const setResult = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: baseOnly,
    });
    const masterResult = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: baseOnly,
    });
    expect(setResult.pct).toBe(100);
    expect(masterResult.pct).toBeLessThan(100);
  });

  it('Set % ≥ Master Set % whenever ownership is base-only — generalized', () => {
    // Same fixture, several "base-only" subsets.
    const fx = brilliantStars();
    const subsets = [
      [], // empty
      [printingId(fx.setId, '001', 'holo')],
      [printingId(fx.setId, '001', 'holo'), printingId(fx.setId, '002', 'nonholo')],
      [
        printingId(fx.setId, '001', 'holo'),
        printingId(fx.setId, '002', 'nonholo'),
        printingId(fx.setId, '003', 'nonholo'),
      ],
    ];
    for (const owned of subsets) {
      const setResult = computeSetPct({
        setId: fx.setId,
        cards: fx.cards,
        printings: fx.printings,
        ownedPrintingIds: owned,
      });
      const masterResult = computeMasterSetPct({
        setId: fx.setId,
        printings: fx.printings,
        ownedPrintingIds: owned,
      });
      expect(setResult.pct).toBeGreaterThanOrEqual(masterResult.pct);
    }
  });
});

describe('computeMasterSetPct — idempotency / determinism', () => {
  it('two identical calls return deeply-equal results', () => {
    const fx = brilliantStars();
    const args = {
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: fx.printings.slice(0, 3).map((p) => p.printingId),
    };
    expect(computeMasterSetPct(args)).toEqual(computeMasterSetPct(args));
  });

  it('reordering printings does not change the result', () => {
    const fx = brilliantStars();
    const owned = fx.printings.slice(0, 3).map((p) => p.printingId);
    const a = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    const b = computeMasterSetPct({
      setId: fx.setId,
      printings: [...fx.printings].reverse(),
      ownedPrintingIds: [...owned].reverse(),
    });
    expect(a).toEqual(b);
  });

  it('does not mutate input arrays', () => {
    const fx = brilliantStars();
    const printingsCopy = JSON.parse(JSON.stringify(fx.printings));
    const owned = [printingId(fx.setId, '001', 'holo')];
    const ownedCopy = [...owned];
    computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    expect(fx.printings).toEqual(printingsCopy);
    expect(owned).toEqual(ownedCopy);
  });
});

describe('computeMasterSetPct — output shape', () => {
  it('result has only the four documented keys', () => {
    const result = computeMasterSetPct({
      setId: 'set:any',
      printings: [],
      ownedPrintingIds: [],
    });
    expect(Object.keys(result).sort()).toEqual(['ownedMaster', 'pct', 'setId', 'totalMaster']);
  });

  it('numerator never exceeds denominator (counts are bounded by master pool)', () => {
    const fx = brilliantStars();
    // Owning every printing including non-master: numerator should
    // still be capped at totalMaster (since non-master don't count).
    const result = computeMasterSetPct({
      setId: fx.setId,
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    expect(result.ownedMaster).toBeLessThanOrEqual(result.totalMaster);
    expect(result.pct).toBe(100);
  });
});
