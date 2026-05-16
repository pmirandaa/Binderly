import { describe, expect, it } from 'vitest';

import type { CardDto, PrintingDto, SetDto } from '@binderly/api-contracts';

import {
  compareSummariesForHome,
  computeCompletionForSet,
  partitionPrintingsForDrillDown,
  summarizeCollection,
  summaryFromResult,
  type OwnedPrintingContext,
} from './completion';

function makeSet(partial: Partial<SetDto> & { id: string }): SetDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-${partial.id}`,
    code: partial.code ?? partial.id,
    language: partial.language ?? 'en',
    name: partial.name ?? `Set ${partial.id}`,
    series: partial.series ?? 'Series',
    releaseDate: partial.releaseDate ?? '2024-01-01',
    // Tests pass `null` explicitly when they want to exercise the
    // missing-totals fallback; only default when the key is omitted.
    printedTotal: 'printedTotal' in partial ? (partial.printedTotal ?? null) : null,
    total: 'total' in partial ? (partial.total ?? null) : 100,
    logoUrl: partial.logoUrl ?? null,
    symbolUrl: partial.symbolUrl ?? null,
    masterSetRules: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeOwned(partial: Partial<OwnedPrintingContext>): OwnedPrintingContext {
  return {
    printingId: partial.printingId ?? 'p1',
    cardId: partial.cardId ?? 'c1',
    setId: partial.setId ?? 'set-a',
    includeInMasterSet: partial.includeInMasterSet ?? true,
  };
}

describe('summarizeCollection', () => {
  const setA = makeSet({ id: 'set-a', name: 'Alpha', total: 10 });
  const setB = makeSet({ id: 'set-b', name: 'Beta', total: 4 });

  it('returns a zero-summary for every set when nothing is owned', () => {
    const summary = summarizeCollection({ sets: [setA, setB], owned: [] });
    expect(summary.perSet).toHaveLength(2);
    expect(summary.perSet[0]?.setPct).toBe(0);
    expect(summary.perSet[0]?.ownedNumbered).toBe(0);
    expect(summary.perSet[0]?.totalNumbered).toBe(10);
    expect(summary.global.allPokemonPct).toBe(0);
    expect(summary.global.uniqueCardsTotal).toBe(14);
  });

  it('counts distinct owned cardIds per set even when the user owns multiple variants', () => {
    const owned: OwnedPrintingContext[] = [
      makeOwned({ printingId: 'p1', cardId: 'c1', setId: 'set-a' }),
      makeOwned({ printingId: 'p2', cardId: 'c1', setId: 'set-a' }),
      makeOwned({ printingId: 'p3', cardId: 'c2', setId: 'set-a' }),
      makeOwned({ printingId: 'p4', cardId: 'c10', setId: 'set-b' }),
    ];
    const summary = summarizeCollection({ sets: [setA, setB], owned });
    const a = summary.perSet[0];
    const b = summary.perSet[1];
    expect(a?.ownedNumbered).toBe(2);
    expect(a?.totalNumbered).toBe(10);
    expect(a?.setPct).toBe(20);
    expect(b?.ownedNumbered).toBe(1);
    expect(b?.totalNumbered).toBe(4);
    expect(b?.setPct).toBe(25);
  });

  it('aggregates global All Pokémon % across every set', () => {
    const owned: OwnedPrintingContext[] = [
      makeOwned({ printingId: 'p1', cardId: 'c1', setId: 'set-a' }),
      makeOwned({ printingId: 'p2', cardId: 'c2', setId: 'set-a' }),
      makeOwned({ printingId: 'p3', cardId: 'c3', setId: 'set-b' }),
    ];
    const summary = summarizeCollection({ sets: [setA, setB], owned });
    // 3 unique cards out of 14 total.
    expect(summary.global.uniqueCardsOwned).toBe(3);
    expect(summary.global.uniqueCardsTotal).toBe(14);
    expect(summary.global.allPokemonPct).toBeCloseTo((3 / 14) * 100);
  });

  it('counts a set as "started" only when the user owns at least one printing in it', () => {
    const owned: OwnedPrintingContext[] = [
      makeOwned({ printingId: 'p1', cardId: 'c1', setId: 'set-a' }),
    ];
    const summary = summarizeCollection({ sets: [setA, setB], owned });
    expect(summary.global.setsStarted).toBe(1);
  });

  it('counts a set as "mastered" only when every numbered card is owned', () => {
    const setSmall = makeSet({ id: 'small', total: 2 });
    const owned: OwnedPrintingContext[] = [
      makeOwned({ printingId: 'p1', cardId: 'c1', setId: 'small' }),
      makeOwned({ printingId: 'p2', cardId: 'c2', setId: 'small' }),
    ];
    const summary = summarizeCollection({ sets: [setSmall, setA], owned });
    expect(summary.global.setsMastered).toBe(1);
  });

  it('falls back to printedTotal when total is null', () => {
    const set = makeSet({ id: 'fallback', total: null, printedTotal: 50 });
    const summary = summarizeCollection({ sets: [set], owned: [] });
    expect(summary.perSet[0]?.totalNumbered).toBe(50);
  });

  it('treats a set with no totals as a 0/0 row instead of NaN', () => {
    const set = makeSet({ id: 'empty', total: null, printedTotal: null });
    const summary = summarizeCollection({ sets: [set], owned: [] });
    expect(summary.perSet[0]?.setPct).toBe(0);
    expect(summary.perSet[0]?.totalNumbered).toBe(0);
  });

  it('tallies global master-owned printings', () => {
    const owned: OwnedPrintingContext[] = [
      makeOwned({ printingId: 'p1', cardId: 'c1', setId: 'set-a', includeInMasterSet: true }),
      makeOwned({ printingId: 'p2', cardId: 'c2', setId: 'set-a', includeInMasterSet: false }),
      makeOwned({ printingId: 'p3', cardId: 'c3', setId: 'set-b', includeInMasterSet: true }),
    ];
    const summary = summarizeCollection({ sets: [setA, setB], owned });
    expect(summary.global.masterOwned).toBe(2);
  });
});

describe('compareSummariesForHome', () => {
  const setNew = makeSet({ id: 'new', releaseDate: '2024-01-01', name: 'New' });
  const setOld = makeSet({ id: 'old', releaseDate: '2010-01-01', name: 'Old' });
  const setMid = makeSet({ id: 'mid', releaseDate: '2018-01-01', name: 'Mid' });

  it('sorts higher completion first', () => {
    const sorted = [
      summaryFromResult(setOld, {
        setId: 'old',
        setPct: 90,
        masterPct: 0,
        ownedNumbered: 9,
        totalNumbered: 10,
        ownedMaster: 0,
        totalMaster: 0,
      }),
      summaryFromResult(setMid, {
        setId: 'mid',
        setPct: 45,
        masterPct: 0,
        ownedNumbered: 9,
        totalNumbered: 20,
        ownedMaster: 0,
        totalMaster: 0,
      }),
      summaryFromResult(setNew, {
        setId: 'new',
        setPct: 100,
        masterPct: 0,
        ownedNumbered: 10,
        totalNumbered: 10,
        ownedMaster: 0,
        totalMaster: 0,
      }),
    ].sort(compareSummariesForHome);
    expect(sorted.map((row) => row.set.id)).toEqual(['new', 'old', 'mid']);
  });

  it('breaks ties on release date (newest first)', () => {
    const a = summaryFromResult(setNew, {
      setId: 'new',
      setPct: 50,
      masterPct: 0,
      ownedNumbered: 5,
      totalNumbered: 10,
      ownedMaster: 0,
      totalMaster: 0,
    });
    const b = summaryFromResult(setOld, {
      setId: 'old',
      setPct: 50,
      masterPct: 0,
      ownedNumbered: 5,
      totalNumbered: 10,
      ownedMaster: 0,
      totalMaster: 0,
    });
    const sorted = [b, a].sort(compareSummariesForHome);
    expect(sorted.map((row) => row.set.id)).toEqual(['new', 'old']);
  });
});

function makeCard(partial: Partial<CardDto> & { id: string; setId: string }): CardDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-card-${partial.id}`,
    setId: partial.setId,
    language: partial.language ?? 'en',
    number: partial.number ?? '1',
    name: partial.name ?? `Card ${partial.id}`,
    nameLocalized: partial.nameLocalized ?? null,
    type: partial.type ?? null,
    subtype: partial.subtype ?? null,
    hp: partial.hp ?? null,
    illustrator: partial.illustrator ?? null,
    flavorText: partial.flavorText ?? null,
    attacks: partial.attacks ?? null,
    weakness: partial.weakness ?? null,
    resistance: partial.resistance ?? null,
    retreatCost: partial.retreatCost ?? null,
    rarity: partial.rarity ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makePrinting(
  partial: Partial<PrintingDto> & { id: string; cardId: string },
): PrintingDto {
  return {
    id: partial.id,
    variantKey: partial.variantKey ?? `${partial.cardId}-${partial.id}`,
    cardId: partial.cardId,
    variantClass: partial.variantClass ?? 'NON_HOLO',
    variantFlags: partial.variantFlags ?? [],
    variantCode: partial.variantCode ?? 'std',
    includeInMasterSet: partial.includeInMasterSet ?? true,
    imageSmallUrl: partial.imageSmallUrl ?? null,
    imageLargeUrl: partial.imageLargeUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('computeCompletionForSet', () => {
  it('returns precise per-set Set / Master percentages for a full roster', () => {
    const result = computeCompletionForSet({
      setId: 'set-a',
      cards: [
        makeCard({ id: 'c1', setId: 'set-a' }),
        makeCard({ id: 'c2', setId: 'set-a' }),
      ],
      printings: [
        makePrinting({ id: 'p1', cardId: 'c1', includeInMasterSet: true }),
        makePrinting({ id: 'p2', cardId: 'c1', includeInMasterSet: true }),
        makePrinting({ id: 'p3', cardId: 'c2', includeInMasterSet: false }),
      ],
      ownedPrintingIds: ['p1'],
    });
    const row = result.perSet[0];
    expect(row?.setId).toBe('set-a');
    // 1 owned card (c1) of 2 total cards.
    expect(row?.setPct).toBe(50);
    // 1 owned master printing of 2 master-set-included printings.
    expect(row?.masterPct).toBe(50);
    expect(row?.ownedMaster).toBe(1);
    expect(row?.totalMaster).toBe(2);
  });

  it('returns a zero-pct row when nothing is owned', () => {
    const result = computeCompletionForSet({
      setId: 'set-a',
      cards: [makeCard({ id: 'c1', setId: 'set-a' })],
      printings: [
        makePrinting({ id: 'p1', cardId: 'c1', includeInMasterSet: true }),
      ],
      ownedPrintingIds: [],
    });
    expect(result.perSet[0]?.setPct).toBe(0);
    expect(result.perSet[0]?.masterPct).toBe(0);
  });
});

describe('partitionPrintingsForDrillDown', () => {
  it('splits a printing list into owned + missing halves', () => {
    const printings = [
      makePrinting({ id: 'p1', cardId: 'c1', variantClass: 'HOLO' }),
      makePrinting({ id: 'p2', cardId: 'c1', variantClass: 'NON_HOLO' }),
      makePrinting({ id: 'p3', cardId: 'c2', variantClass: 'REVERSE_HOLO' }),
    ];
    const result = partitionPrintingsForDrillDown(printings, ['p2']);
    expect(result.owned.map((p) => p.id)).toEqual(['p2']);
    expect(result.missing.map((p) => p.id).sort()).toEqual(['p1', 'p3']);
  });

  it('returns empty arrays when no printings are supplied', () => {
    const result = partitionPrintingsForDrillDown([], ['p1']);
    expect(result.owned).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('sorts each half by variantClass then variantKey for stable display', () => {
    const printings = [
      makePrinting({ id: 'p1', cardId: 'c1', variantClass: 'REVERSE_HOLO', variantKey: 'b' }),
      makePrinting({ id: 'p2', cardId: 'c1', variantClass: 'HOLO', variantKey: 'a' }),
      makePrinting({ id: 'p3', cardId: 'c1', variantClass: 'HOLO', variantKey: 'b' }),
    ];
    const result = partitionPrintingsForDrillDown(printings, []);
    expect(result.missing.map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
  });
});
