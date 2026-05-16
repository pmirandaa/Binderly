import { describe, expect, it } from 'vitest';

import { computeSetPct } from './set-pct.js';
import {
  brilliantStars,
  card,
  cardId,
  hiddenFates,
  printing,
  printingId,
} from './test-fixtures.js';

describe('computeSetPct — empty / boundary inputs', () => {
  it('empty cards + empty owned ⇒ pct=0, totals=0', () => {
    const result = computeSetPct({
      setId: 'set:nope',
      cards: [],
      printings: [],
      ownedPrintingIds: [],
    });
    expect(result).toEqual({
      setId: 'set:nope',
      pct: 0,
      ownedNumbered: 0,
      totalNumbered: 0,
    });
  });

  it('empty cards but non-empty owned ⇒ still pct=0', () => {
    const result = computeSetPct({
      setId: 'set:nope',
      cards: [],
      printings: [],
      ownedPrintingIds: ['printing:nonexistent'],
    });
    expect(result.pct).toBe(0);
    expect(result.totalNumbered).toBe(0);
    expect(result.ownedNumbered).toBe(0);
  });

  it('cards present but ownedPrintingIds empty ⇒ pct=0, owned=0', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.pct).toBe(0);
    expect(result.ownedNumbered).toBe(0);
    expect(result.totalNumbered).toBe(3);
  });

  it('cards in a different set are not counted in totalNumbered', () => {
    const fx = brilliantStars();
    const otherSet = card('set:elsewhere', '999');
    const result = computeSetPct({
      setId: fx.setId,
      cards: [...fx.cards, otherSet],
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.totalNumbered).toBe(3);
  });
});

describe('computeSetPct — full / partial collections', () => {
  it('owns one HOLO printing of every card ⇒ pct=100', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId(fx.setId, '001', 'holo'),
        printingId(fx.setId, '002', 'nonholo'),
        printingId(fx.setId, '003', 'nonholo'),
      ],
    });
    expect(result).toEqual({
      setId: fx.setId,
      pct: 100,
      ownedNumbered: 3,
      totalNumbered: 3,
    });
  });

  it('owns 2 of 3 cards (no matter which printing) ⇒ pct ≈ 66.66', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId(fx.setId, '001', 'altart'),
        printingId(fx.setId, '002', 'reverse'),
      ],
    });
    expect(result.ownedNumbered).toBe(2);
    expect(result.totalNumbered).toBe(3);
    expect(result.pct).toBeCloseTo((2 / 3) * 100, 6);
  });

  it('partial 50% boundary (2 of 4 cards owned)', () => {
    const setId = 'set:half';
    const cards = [card(setId, '001'), card(setId, '002'), card(setId, '003'), card(setId, '004')];
    const printings = [
      printing(setId, '001', 'holo'),
      printing(setId, '002', 'holo'),
      printing(setId, '003', 'holo'),
      printing(setId, '004', 'holo'),
    ];
    const result = computeSetPct({
      setId,
      cards,
      printings,
      ownedPrintingIds: [printingId(setId, '001', 'holo'), printingId(setId, '002', 'holo')],
    });
    expect(result.pct).toBe(50);
    expect(result.ownedNumbered).toBe(2);
    expect(result.totalNumbered).toBe(4);
  });

  it('partial 25% boundary (1 of 4 cards owned)', () => {
    const setId = 'set:quarter';
    const cards = [card(setId, '001'), card(setId, '002'), card(setId, '003'), card(setId, '004')];
    const printings = cards.map((c) => printing(setId, c.cardId.split('-').pop() ?? '', 'holo'));
    const result = computeSetPct({
      setId,
      cards,
      printings,
      ownedPrintingIds: [printings[0]!.printingId],
    });
    expect(result.pct).toBe(25);
  });

  it('partial 75% boundary (3 of 4 cards owned)', () => {
    const setId = 'set:three-q';
    const cards = [card(setId, '001'), card(setId, '002'), card(setId, '003'), card(setId, '004')];
    const printings = cards.map((_, idx) => printing(setId, String(idx + 1).padStart(3, '0'), 'h'));
    const result = computeSetPct({
      setId,
      cards,
      printings,
      ownedPrintingIds: [
        printings[0]!.printingId,
        printings[1]!.printingId,
        printings[2]!.printingId,
      ],
    });
    expect(result.pct).toBe(75);
    expect(result.ownedNumbered).toBe(3);
  });
});

describe('computeSetPct — variant-agnostic semantics (PROJECT.md § 8)', () => {
  it('owning ONLY a reverse-holo of every card credits every card', () => {
    const fx = brilliantStars();
    const reverseOnlyOwned = fx.printings
      .filter((p) => p.printingId.endsWith('reverse'))
      .map((p) => p.printingId);
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: reverseOnlyOwned,
    });
    expect(result.ownedNumbered).toBe(2);
    expect(result.totalNumbered).toBe(3);
  });

  it('owning ONLY the alt-art of card 001 credits card 001', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'altart')],
    });
    expect(result.ownedNumbered).toBe(1);
  });

  it('owning the STAFF promo of card 003 (NOT in master) STILL credits card 003 toward Set %', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '003', 'staff')],
    });
    expect(result.ownedNumbered).toBe(1);
  });

  it('owning multiple variants of the same card counts the card once', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId(fx.setId, '001', 'holo'),
        printingId(fx.setId, '001', 'reverse'),
        printingId(fx.setId, '001', 'altart'),
      ],
    });
    expect(result.ownedNumbered).toBe(1);
  });
});

describe('computeSetPct — robustness', () => {
  it('owned printing that does not exist in roster is silently ignored', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'holo'), 'printing:ghost'],
    });
    expect(result.ownedNumbered).toBe(1);
  });

  it('duplicate ownedPrintingIds collapse', () => {
    const fx = brilliantStars();
    const id = printingId(fx.setId, '001', 'holo');
    const result = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [id, id, id],
    });
    expect(result.ownedNumbered).toBe(1);
  });

  it('printings of OTHER sets in the roster are not counted', () => {
    const bs = brilliantStars();
    const hf = hiddenFates();
    const result = computeSetPct({
      setId: bs.setId,
      cards: [...bs.cards, ...hf.cards],
      printings: [...bs.printings, ...hf.printings],
      ownedPrintingIds: [
        // Owns one BS card and one HF card.
        printingId(bs.setId, '001', 'holo'),
        printingId(hf.setId, 'SV001', 'holo'),
      ],
    });
    expect(result.totalNumbered).toBe(3);
    expect(result.ownedNumbered).toBe(1);
  });

  it('querying a setId not present in the roster ⇒ pct=0, totals=0', () => {
    const fx = brilliantStars();
    const result = computeSetPct({
      setId: 'set:does-not-exist',
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'holo')],
    });
    expect(result).toEqual({
      setId: 'set:does-not-exist',
      pct: 0,
      ownedNumbered: 0,
      totalNumbered: 0,
    });
  });

  it('result.setId mirrors the input setId verbatim', () => {
    const result = computeSetPct({
      setId: 'set:exact-match-please',
      cards: [],
      printings: [],
      ownedPrintingIds: [],
    });
    expect(result.setId).toBe('set:exact-match-please');
  });
});

describe('computeSetPct — idempotency / determinism', () => {
  it('two identical calls return deeply-equal results', () => {
    const fx = brilliantStars();
    const args = {
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId(fx.setId, '001', 'holo'),
        printingId(fx.setId, '002', 'reverse'),
      ],
    };
    const a = computeSetPct(args);
    const b = computeSetPct(args);
    expect(a).toEqual(b);
  });

  it('reordering printings does not change the result (order-independent)', () => {
    const fx = brilliantStars();
    const owned = [printingId(fx.setId, '001', 'holo'), printingId(fx.setId, '002', 'reverse')];
    const a = computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    const b = computeSetPct({
      setId: fx.setId,
      cards: [...fx.cards].reverse(),
      printings: [...fx.printings].reverse(),
      ownedPrintingIds: [...owned].reverse(),
    });
    expect(a).toEqual(b);
  });

  it('does not mutate input arrays', () => {
    const fx = brilliantStars();
    const cardsCopy = JSON.parse(JSON.stringify(fx.cards));
    const printingsCopy = JSON.parse(JSON.stringify(fx.printings));
    const owned = [printingId(fx.setId, '001', 'holo')];
    const ownedCopy = [...owned];
    computeSetPct({
      setId: fx.setId,
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    expect(fx.cards).toEqual(cardsCopy);
    expect(fx.printings).toEqual(printingsCopy);
    expect(owned).toEqual(ownedCopy);
  });
});

describe('computeSetPct — type sanity (compile-time + runtime)', () => {
  it('result has only the four documented keys', () => {
    const result = computeSetPct({
      setId: 'set:any',
      cards: [],
      printings: [],
      ownedPrintingIds: [],
    });
    expect(Object.keys(result).sort()).toEqual(['ownedNumbered', 'pct', 'setId', 'totalNumbered']);
  });

  it('result is shaped consistently across input scales', () => {
    const small = computeSetPct({
      setId: 'set:a',
      cards: [card('set:a', '001')],
      printings: [printing('set:a', '001', 'h')],
      ownedPrintingIds: [printingId('set:a', '001', 'h')],
    });
    expect(small).toEqual({
      setId: 'set:a',
      pct: 100,
      ownedNumbered: 1,
      totalNumbered: 1,
    });
  });

  it('uses cardId for grouping (not printingId) — alias check', () => {
    // Two printings of the SAME card; owning one credits the
    // card. (Belt-and-suspenders for the variant-agnostic rule.)
    const setId = 'set:alias';
    const cards = [card(setId, '042')];
    const printings = [
      printing(setId, '042', 'a'),
      printing(setId, '042', 'b'),
      printing(setId, '042', 'c'),
    ];
    expect(printings.every((p) => p.cardId === cardId(setId, '042'))).toBe(true);
    const result = computeSetPct({
      setId,
      cards,
      printings,
      ownedPrintingIds: [printings[2]!.printingId],
    });
    expect(result.ownedNumbered).toBe(1);
  });
});
