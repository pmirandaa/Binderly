import { describe, expect, it } from 'vitest';

import { computeAllPokemonPct } from './all-pokemon-pct.js';
import {
  brilliantStars,
  card,
  hiddenFates,
  multiSetRoster,
  printing,
  printingId,
} from './test-fixtures.js';

describe('computeAllPokemonPct — empty / boundary inputs', () => {
  it('empty cards + empty owned ⇒ pct=0, totals=0', () => {
    const result = computeAllPokemonPct({
      cards: [],
      printings: [],
      ownedPrintingIds: [],
    });
    expect(result).toEqual({
      pct: 0,
      uniqueCardsOwned: 0,
      uniqueCardsTotal: 0,
    });
  });

  it('empty owned, non-empty cards ⇒ pct=0, total=count', () => {
    const fx = multiSetRoster();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.uniqueCardsOwned).toBe(0);
    expect(result.uniqueCardsTotal).toBe(5);
    expect(result.pct).toBe(0);
  });

  it('owned but no cards in scope ⇒ pct=0', () => {
    const fx = multiSetRoster();
    const result = computeAllPokemonPct({
      cards: [],
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    expect(result.pct).toBe(0);
    expect(result.uniqueCardsOwned).toBe(0);
    expect(result.uniqueCardsTotal).toBe(0);
  });
});

describe('computeAllPokemonPct — full / partial', () => {
  it('owns ≥1 printing of every card ⇒ pct=100', () => {
    const fx = multiSetRoster();
    const oneOfEachCard = new Map<string, string>();
    for (const p of fx.printings) {
      if (!oneOfEachCard.has(p.cardId)) oneOfEachCard.set(p.cardId, p.printingId);
    }
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [...oneOfEachCard.values()],
    });
    expect(result.pct).toBe(100);
    expect(result.uniqueCardsOwned).toBe(5);
    expect(result.uniqueCardsTotal).toBe(5);
  });

  it('owns 1 of 5 distinct cards ⇒ pct=20', () => {
    const fx = multiSetRoster();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId('set:brilliant-stars', '001', 'holo')],
    });
    expect(result.pct).toBe(20);
    expect(result.uniqueCardsOwned).toBe(1);
    expect(result.uniqueCardsTotal).toBe(5);
  });

  it('owns 2 of 5 distinct cards ⇒ pct=40', () => {
    const fx = multiSetRoster();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId('set:brilliant-stars', '001', 'holo'),
        printingId('set:hidden-fates', 'SV001', 'holo'),
      ],
    });
    expect(result.pct).toBe(40);
    expect(result.uniqueCardsOwned).toBe(2);
  });

  it('owns 3 of 5 distinct cards ⇒ pct=60', () => {
    const fx = multiSetRoster();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId('set:brilliant-stars', '001', 'holo'),
        printingId('set:brilliant-stars', '002', 'reverse'),
        printingId('set:hidden-fates', 'SV001', 'holo'),
      ],
    });
    expect(result.pct).toBe(60);
  });

  it('owns 4 of 5 distinct cards ⇒ pct=80', () => {
    const fx = multiSetRoster();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId('set:brilliant-stars', '001', 'holo'),
        printingId('set:brilliant-stars', '002', 'reverse'),
        printingId('set:brilliant-stars', '003', 'staff'),
        printingId('set:hidden-fates', 'SV001', 'holo'),
      ],
    });
    expect(result.pct).toBe(80);
  });
});

describe('computeAllPokemonPct — variant-independence', () => {
  it('owning a SINGLE printing of a card credits the card', () => {
    const fx = brilliantStars();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'holo')],
    });
    expect(result.uniqueCardsOwned).toBe(1);
  });

  it('owning ALL variants of one card still credits the card ONCE', () => {
    const fx = brilliantStars();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId(fx.setId, '001', 'holo'),
        printingId(fx.setId, '001', 'reverse'),
        printingId(fx.setId, '001', 'altart'),
      ],
    });
    expect(result.uniqueCardsOwned).toBe(1);
  });

  it('owning a non-master printing still credits the card', () => {
    // Pablo's spec: "if I have only the normal one of a card in
    // one set, count like ok, you have that card." The "normal"
    // can be a STAFF promo or anything else — it's about the card.
    const fx = brilliantStars();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '003', 'staff')],
    });
    expect(result.uniqueCardsOwned).toBe(1);
  });
});

describe('computeAllPokemonPct — caller-supplied scoping (denominator filter)', () => {
  it('passing only Brilliant Stars cards/printings scopes the denominator to 3', () => {
    const fx = multiSetRoster();
    const bsOnlyCards = fx.cards.filter((c) => c.setId === 'set:brilliant-stars');
    const bsOnlyPrintings = fx.printings.filter((p) => p.setId === 'set:brilliant-stars');
    const result = computeAllPokemonPct({
      cards: bsOnlyCards,
      printings: bsOnlyPrintings,
      ownedPrintingIds: [printingId('set:brilliant-stars', '001', 'holo')],
    });
    expect(result.uniqueCardsTotal).toBe(3);
    expect(result.uniqueCardsOwned).toBe(1);
    expect(result.pct).toBeCloseTo((1 / 3) * 100, 6);
  });

  it('passing only Hidden Fates ⇒ denominator=2', () => {
    const fx = hiddenFates();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, 'SV001', 'holo')],
    });
    expect(result.uniqueCardsTotal).toBe(2);
    expect(result.pct).toBe(50);
  });

  it('a "generation" filter ⇒ caller pre-filters; numerator/denominator both contract', () => {
    // Simulate "Sword & Shield generation only" by filtering the
    // multi-set roster down to set:brilliant-stars (a SwSh-era
    // set). User owns one printing in each of the two sets; only
    // the BS one should count toward both numerator AND
    // denominator.
    const fx = multiSetRoster();
    const swshScopedCards = fx.cards.filter((c) => c.setId === 'set:brilliant-stars');
    const swshScopedPrintings = fx.printings.filter((p) => p.setId === 'set:brilliant-stars');
    const result = computeAllPokemonPct({
      cards: swshScopedCards,
      printings: swshScopedPrintings,
      ownedPrintingIds: [
        printingId('set:brilliant-stars', '001', 'holo'),
        printingId('set:hidden-fates', 'SV001', 'holo'),
      ],
    });
    expect(result.uniqueCardsTotal).toBe(3);
    expect(result.uniqueCardsOwned).toBe(1);
  });

  it('owning a card whose row was filtered out by scope is NOT counted', () => {
    const fx = multiSetRoster();
    // Scope: BS only (3 cards). User owns an HF printing — should
    // NOT credit (the HF card is out of scope).
    const result = computeAllPokemonPct({
      cards: fx.cards.filter((c) => c.setId === 'set:brilliant-stars'),
      printings: fx.printings,
      ownedPrintingIds: [printingId('set:hidden-fates', 'SV001', 'holo')],
    });
    expect(result.uniqueCardsOwned).toBe(0);
    expect(result.uniqueCardsTotal).toBe(3);
  });
});

describe('computeAllPokemonPct — robustness', () => {
  it('owned printing not in roster is silently ignored', () => {
    const fx = brilliantStars();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [printingId(fx.setId, '001', 'holo'), 'printing:ghost'],
    });
    expect(result.uniqueCardsOwned).toBe(1);
  });

  it('duplicate ownedPrintingIds collapse', () => {
    const fx = brilliantStars();
    const id = printingId(fx.setId, '001', 'holo');
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [id, id, id],
    });
    expect(result.uniqueCardsOwned).toBe(1);
  });

  it('duplicate cards collapse (defensive: caller hands us a denormalized projection)', () => {
    const fx = brilliantStars();
    const dupedCards = [...fx.cards, ...fx.cards];
    const result = computeAllPokemonPct({
      cards: dupedCards,
      printings: fx.printings,
      ownedPrintingIds: [],
    });
    expect(result.uniqueCardsTotal).toBe(3);
  });

  it('owning a printing whose cardId is not represented in cards array ⇒ not counted', () => {
    const setId = 'set:orphan';
    const result = computeAllPokemonPct({
      cards: [card(setId, '001')],
      printings: [
        printing(setId, '001', 'holo'),
        // Orphan: belongs to setId but cardId not in `cards`.
        {
          printingId: 'orphan-printing',
          cardId: 'orphan-card',
          setId,
          includeInMasterSet: true,
        },
      ],
      ownedPrintingIds: ['orphan-printing'],
    });
    expect(result.uniqueCardsOwned).toBe(0);
    expect(result.uniqueCardsTotal).toBe(1);
  });
});

describe('computeAllPokemonPct — idempotency / determinism', () => {
  it('two identical calls return deeply-equal results', () => {
    const fx = multiSetRoster();
    const args = {
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: [
        printingId('set:brilliant-stars', '001', 'holo'),
        printingId('set:hidden-fates', 'SV002', 'holo'),
      ],
    };
    expect(computeAllPokemonPct(args)).toEqual(computeAllPokemonPct(args));
  });

  it('reordering input arrays does not change the result', () => {
    const fx = multiSetRoster();
    const owned = [
      printingId('set:brilliant-stars', '001', 'holo'),
      printingId('set:hidden-fates', 'SV002', 'holo'),
    ];
    const a = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    const b = computeAllPokemonPct({
      cards: [...fx.cards].reverse(),
      printings: [...fx.printings].reverse(),
      ownedPrintingIds: [...owned].reverse(),
    });
    expect(a).toEqual(b);
  });

  it('does not mutate input arrays', () => {
    const fx = multiSetRoster();
    const cardsCopy = JSON.parse(JSON.stringify(fx.cards));
    const printingsCopy = JSON.parse(JSON.stringify(fx.printings));
    const owned = [printingId('set:brilliant-stars', '001', 'holo')];
    const ownedCopy = [...owned];
    computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: owned,
    });
    expect(fx.cards).toEqual(cardsCopy);
    expect(fx.printings).toEqual(printingsCopy);
    expect(owned).toEqual(ownedCopy);
  });
});

describe('computeAllPokemonPct — output shape', () => {
  it('result has only the three documented keys', () => {
    const result = computeAllPokemonPct({
      cards: [],
      printings: [],
      ownedPrintingIds: [],
    });
    expect(Object.keys(result).sort()).toEqual(['pct', 'uniqueCardsOwned', 'uniqueCardsTotal']);
  });

  it('numerator never exceeds denominator', () => {
    const fx = multiSetRoster();
    const result = computeAllPokemonPct({
      cards: fx.cards,
      printings: fx.printings,
      ownedPrintingIds: fx.printings.map((p) => p.printingId),
    });
    expect(result.uniqueCardsOwned).toBeLessThanOrEqual(result.uniqueCardsTotal);
  });
});
