import { describe, expect, it } from 'vitest';

import { computeGlobalMasterPct } from './global-master-pct.js';
import {
  brilliantStars,
  errorsOnly,
  hiddenFates,
  multiSetRoster,
  printing,
  printingId,
} from './test-fixtures.js';

describe('computeGlobalMasterPct — empty / boundary inputs', () => {
  it('empty printings ⇒ pct=0, totals=0', () => {
    const result = computeGlobalMasterPct({
      printings: [],
      ownedPrintingIds: [],
    });
    expect(result).toEqual({
      pct: 0,
      masterOwned: 0,
      masterTotal: 0,
    });
  });

  it('empty owned, non-empty roster ⇒ pct=0, total>0', () => {
    const fx = multiSetRoster();
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.masterOwned).toBe(0);
    expect(result.masterTotal).toBe(9);
    expect(result.pct).toBe(0);
  });

  it('every printing is includeInMasterSet=false ⇒ totals=0', () => {
    const fx = errorsOnly();
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    expect(result.masterTotal).toBe(0);
    expect(result.pct).toBe(0);
  });
});

describe('computeGlobalMasterPct — full / partial', () => {
  it('owns every master-set printing across all sets ⇒ pct=100', () => {
    const fx = multiSetRoster();
    const masterIds = fx.printings.filter((p) => p.includeInMasterSet).map((p) => p.printingId);
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: masterIds,
    });
    expect(result.pct).toBe(100);
    expect(result.masterOwned).toBe(9);
    expect(result.masterTotal).toBe(9);
  });

  it('owns half ⇒ pct ≈ 50', () => {
    const fx = multiSetRoster();
    const halfIds = fx.printings
      .filter((p) => p.includeInMasterSet)
      .slice(0, Math.floor(9 / 2))
      .map((p) => p.printingId);
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: halfIds,
    });
    expect(result.masterOwned).toBe(4);
    expect(result.masterTotal).toBe(9);
    expect(result.pct).toBeCloseTo((4 / 9) * 100, 6);
  });

  it('owns 1 ⇒ pct ≈ 11.11', () => {
    const fx = multiSetRoster();
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: [printingId('set:brilliant-stars', '001', 'holo')],
    });
    expect(result.masterOwned).toBe(1);
    expect(result.masterTotal).toBe(9);
  });
});

describe('computeGlobalMasterPct — non-master excluded', () => {
  it('STAFF promo (includeInMasterSet=false) does NOT increment ownedMaster', () => {
    const fx = brilliantStars();
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '003', 'staff')],
    });
    expect(result.masterOwned).toBe(0);
  });

  it('STAFF promo does NOT increment masterTotal', () => {
    const fx = brilliantStars();
    expect(
      computeGlobalMasterPct({
        printings: fx.printings,
        ownedPrintingIds: [],
      }).masterTotal,
    ).toBe(6);
  });

  it('mix of master and non-master printings counts only master in totals', () => {
    const setId = 'set:mix';
    const printings = [
      printing(setId, '001', 'h', { includeInMasterSet: true }),
      printing(setId, '001', 'staff', { includeInMasterSet: false }),
      printing(setId, '002', 'h', { includeInMasterSet: true }),
      printing(setId, '002', 'err', { includeInMasterSet: false }),
    ];
    const result = computeGlobalMasterPct({
      printings,
      ownedPrintingIds: printings.map((p) => p.printingId),
    });
    expect(result.masterOwned).toBe(2);
    expect(result.masterTotal).toBe(2);
    expect(result.pct).toBe(100);
  });
});

describe('computeGlobalMasterPct — robustness', () => {
  it('owned printing not in roster is silently ignored', () => {
    const fx = brilliantStars();
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'holo'), 'printing:ghost'],
    });
    expect(result.masterOwned).toBe(1);
  });

  it('duplicate ownedPrintingIds collapse', () => {
    const fx = brilliantStars();
    const id = printingId(fx.setId, '001', 'holo');
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: [id, id, id, id],
    });
    expect(result.masterOwned).toBe(1);
  });

  it('aggregates across multiple sets correctly', () => {
    const bs = brilliantStars();
    const hf = hiddenFates();
    const allPrintings = [...bs.printings, ...hf.printings];
    // BS has 6 master, HF has 3 master ⇒ total 9.
    const result = computeGlobalMasterPct({
      printings: allPrintings,
      ownedPrintingIds: [],
    });
    expect(result.masterTotal).toBe(9);
  });

  it('numerator never exceeds denominator', () => {
    const fx = multiSetRoster();
    const result = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    expect(result.masterOwned).toBeLessThanOrEqual(result.masterTotal);
  });
});

describe('computeGlobalMasterPct — idempotency / determinism', () => {
  it('two identical calls return deeply-equal results', () => {
    const fx = multiSetRoster();
    const args = {
      printings: fx.printings,
      ownedPrintingIds: fx.printings.slice(0, 4).map((p) => p.printingId),
    };
    expect(computeGlobalMasterPct(args)).toEqual(computeGlobalMasterPct(args));
  });

  it('reordering input does not change the result', () => {
    const fx = multiSetRoster();
    const owned = fx.printings.slice(0, 3).map((p) => p.printingId);
    const a = computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    const b = computeGlobalMasterPct({
      printings: [...fx.printings].reverse(),
      ownedPrintingIds: [...owned].reverse(),
    });
    expect(a).toEqual(b);
  });

  it('does not mutate input arrays', () => {
    const fx = multiSetRoster();
    const printingsCopy = JSON.parse(JSON.stringify(fx.printings));
    const owned = [printingId('set:brilliant-stars', '001', 'holo')];
    const ownedCopy = [...owned];
    computeGlobalMasterPct({
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    expect(fx.printings).toEqual(printingsCopy);
    expect(owned).toEqual(ownedCopy);
  });
});

describe('computeGlobalMasterPct — output shape', () => {
  it('result has only the three documented keys', () => {
    const result = computeGlobalMasterPct({
      printings: [],
      ownedPrintingIds: [],
    });
    expect(Object.keys(result).sort()).toEqual(['masterOwned', 'masterTotal', 'pct']);
  });
});
