// Smoke test for the public barrel — proves every documented
// export resolves. If a future edit accidentally drops one of the
// public names from `index.ts`, this test fails before the change
// reaches the edge-functions worker.

import { describe, expect, it } from 'vitest';

import * as setCompletion from './index.js';

describe('@binderly/set-completion — public barrel', () => {
  it('exports every compute* function as a callable', () => {
    expect(typeof setCompletion.computeSetPct).toBe('function');
    expect(typeof setCompletion.computeMasterSetPct).toBe('function');
    expect(typeof setCompletion.computeAllPokemonPct).toBe('function');
    expect(typeof setCompletion.computeGlobalMasterPct).toBe('function');
    expect(typeof setCompletion.computeCompletion).toBe('function');
  });

  it('the barrel does not leak internal helpers (`safePct`, `uniqueIds`)', () => {
    expect((setCompletion as Record<string, unknown>).safePct).toBeUndefined();
    expect((setCompletion as Record<string, unknown>).uniqueIds).toBeUndefined();
  });

  it('every public function returns the expected zero-result shape on empty input', () => {
    expect(
      setCompletion.computeSetPct({
        setId: 'x',
        cards: [],
        printings: [],
        ownedPrintingIds: [],
      }),
    ).toEqual({
      setId: 'x',
      pct: 0,
      ownedNumbered: 0,
      totalNumbered: 0,
    });
    expect(
      setCompletion.computeMasterSetPct({
        setId: 'x',
        printings: [],
        ownedPrintingIds: [],
      }),
    ).toEqual({
      setId: 'x',
      pct: 0,
      ownedMaster: 0,
      totalMaster: 0,
    });
    expect(
      setCompletion.computeAllPokemonPct({
        cards: [],
        printings: [],
        ownedPrintingIds: [],
      }),
    ).toEqual({ pct: 0, uniqueCardsOwned: 0, uniqueCardsTotal: 0 });
    expect(
      setCompletion.computeGlobalMasterPct({
        printings: [],
        ownedPrintingIds: [],
      }),
    ).toEqual({ pct: 0, masterOwned: 0, masterTotal: 0 });
    expect(
      setCompletion.computeCompletion({
        cards: [],
        printings: [],
        ownedPrintingIds: [],
      }),
    ).toEqual({
      perSet: [],
      global: {
        allPokemonPct: 0,
        masterPct: 0,
        uniqueCardsOwned: 0,
        uniqueCardsTotal: 0,
        masterOwned: 0,
        masterTotal: 0,
      },
    });
  });
});
