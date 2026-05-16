import { describe, expect, it } from 'vitest';

import type { CardDto, PrintingDto, SetDto } from '@binderly/api-contracts';

import { evaluateAgainstCatalog, parseDslText, type CatalogPrintingRow } from './dsl';

describe('parseDslText', () => {
  it('returns empty for whitespace input', () => {
    expect(parseDslText('').status).toBe('empty');
    expect(parseDslText('   \n  ').status).toBe('empty');
  });

  it('returns json-error for malformed JSON', () => {
    const result = parseDslText('{ not json');
    expect(result.status).toBe('json-error');
    if (result.status === 'json-error') {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('returns dsl-error for valid JSON that fails the schema', () => {
    const result = parseDslText('{"type":"banana"}');
    expect(result.status).toBe('dsl-error');
    if (result.status === 'dsl-error') {
      expect(result.message).toMatch(/invalid/i);
      expect(Array.isArray(result.issues)).toBe(true);
    }
  });

  it('parses a simple eq expression and produces an explanation', () => {
    const result = parseDslText(
      JSON.stringify({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.expression).toEqual({
        type: 'eq',
        field: 'card.name',
        value: 'Charizard',
      });
      expect(result.explanation).toContain('card name');
      expect(result.explanation).toContain('Charizard');
    }
  });
});

// ============================================================
// evaluateAgainstCatalog fixtures
// ============================================================

function makeRow(partial: {
  cardName: string;
  printingId: string;
  rarity?: 'COMMON' | 'HOLO_RARE';
}): CatalogPrintingRow {
  const card: CardDto = {
    id: `card-${partial.printingId}`,
    canonicalKey: `en-card-${partial.printingId}`,
    setId: 'set-a',
    language: 'en',
    number: '1',
    name: partial.cardName,
    nameLocalized: null,
    type: null,
    subtype: null,
    hp: null,
    illustrator: null,
    flavorText: null,
    attacks: null,
    weakness: null,
    resistance: null,
    retreatCost: null,
    rarity: partial.rarity ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const set: SetDto = {
    id: 'set-a',
    canonicalKey: 'en-set-a',
    code: 'base1',
    language: 'en',
    name: 'Base Set',
    series: 'Original',
    releaseDate: '1999-01-09',
    printedTotal: 102,
    total: 102,
    logoUrl: null,
    symbolUrl: null,
    masterSetRules: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const printing: PrintingDto = {
    id: partial.printingId,
    variantKey: `${card.canonicalKey}-std`,
    cardId: card.id,
    variantClass: 'NON_HOLO',
    variantFlags: [],
    variantCode: 'std',
    includeInMasterSet: true,
    imageSmallUrl: null,
    imageLargeUrl: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  return { card, set, printing };
}

describe('evaluateAgainstCatalog', () => {
  it('filters by an eq expression on card.name', () => {
    const rows = [
      makeRow({ cardName: 'Charizard', printingId: 'p1' }),
      makeRow({ cardName: 'Blastoise', printingId: 'p2' }),
      makeRow({ cardName: 'Charizard', printingId: 'p3' }),
    ];
    const result = parseDslText(
      JSON.stringify({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const matches = evaluateAgainstCatalog(result.expression, rows, new Set());
    expect(matches.map((m) => m.printing.id)).toEqual(['p1', 'p3']);
  });

  it('preserves catalog order in the matches', () => {
    const rows = [
      makeRow({ cardName: 'Bulbasaur', printingId: 'p1' }),
      makeRow({ cardName: 'Charizard', printingId: 'p2' }),
      makeRow({ cardName: 'Squirtle', printingId: 'p3' }),
      makeRow({ cardName: 'Charizard', printingId: 'p4' }),
    ];
    const result = parseDslText(
      JSON.stringify({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    if (result.status !== 'ok') return;
    const matches = evaluateAgainstCatalog(result.expression, rows, new Set());
    expect(matches.map((m) => m.printing.id)).toEqual(['p2', 'p4']);
  });

  it('marks owned matches via the ownedPrintingIds set', () => {
    const rows = [
      makeRow({ cardName: 'Charizard', printingId: 'p1' }),
      makeRow({ cardName: 'Charizard', printingId: 'p2' }),
    ];
    const result = parseDslText(
      JSON.stringify({ type: 'eq', field: 'card.name', value: 'Charizard' }),
    );
    if (result.status !== 'ok') return;
    const matches = evaluateAgainstCatalog(result.expression, rows, new Set(['p1']));
    expect(matches[0]?.owned).toBe(true);
    expect(matches[1]?.owned).toBe(false);
  });

  it('honours collection.isOwned in the expression via the ownedPrintingIds set', () => {
    const rows = [
      makeRow({ cardName: 'Charizard', printingId: 'p1' }),
      makeRow({ cardName: 'Charizard', printingId: 'p2' }),
    ];
    const result = parseDslText(
      JSON.stringify({
        type: 'and',
        children: [
          { type: 'eq', field: 'card.name', value: 'Charizard' },
          { type: 'eq', field: 'collection.isOwned', value: true },
        ],
      }),
    );
    if (result.status !== 'ok') return;
    const matches = evaluateAgainstCatalog(result.expression, rows, new Set(['p2']));
    expect(matches.map((m) => m.printing.id)).toEqual(['p2']);
  });
});
