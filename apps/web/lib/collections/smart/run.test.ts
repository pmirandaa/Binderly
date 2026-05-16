import { describe, expect, it } from 'vitest';

import {
  fixtureCatalogPreview,
  makeCollectionItem,
  SMART_FIXTURE_EXPRESSION,
} from './fixtures';
import { parseSmartExpressionInput, runExpression } from './run';

describe('parseSmartExpressionInput', () => {
  it('returns kind=empty for whitespace-only input', () => {
    expect(parseSmartExpressionInput('').kind).toBe('empty');
    expect(parseSmartExpressionInput('   \n\t').kind).toBe('empty');
  });

  it('returns kind=json-error for malformed JSON', () => {
    const result = parseSmartExpressionInput('{ "type": ');
    expect(result.kind).toBe('json-error');
    if (result.kind !== 'json-error') throw new Error('unexpected');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('returns kind=dsl-error when JSON parses but DSL rejects', () => {
    const result = parseSmartExpressionInput(
      JSON.stringify({ type: 'eq', field: 'card.namez', value: 'Charizard' }),
    );
    expect(result.kind).toBe('dsl-error');
    if (result.kind !== 'dsl-error') throw new Error('unexpected');
    expect(result.message).toContain('invalid smart-collection expression');
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it('returns kind=parsed with explanation when input is a valid expression', () => {
    const result = parseSmartExpressionInput(JSON.stringify(SMART_FIXTURE_EXPRESSION));
    expect(result.kind).toBe('parsed');
    if (result.kind !== 'parsed') throw new Error('unexpected');
    expect(result.explanation).toContain('Charizard');
    expect(result.expression.type).toBe('and');
  });
});

describe('runExpression', () => {
  it('matches the three Charizards in the fixture for the default expression', () => {
    const preview = fixtureCatalogPreview();
    const result = runExpression(SMART_FIXTURE_EXPRESSION, preview, [], {
      now: () => '2026-05-15T20:00:00.000Z',
    });
    // Fixture has three "Charizard" cards — base (en, 2 printings),
    // swsh (en, 2 printings), jp (1 printing). The expression
    // requires `card.language === 'en'`, so JP is excluded —
    // 4 matches total.
    expect(result.matches).toHaveLength(4);
    for (const match of result.matches) {
      expect(match.card.name).toBe('Charizard');
      expect(match.set.language).toBe('en');
    }
  });

  it('reports the total scanned and the explainer string', () => {
    const preview = fixtureCatalogPreview();
    const result = runExpression(SMART_FIXTURE_EXPRESSION, preview, []);
    expect(result.scanned).toBe(preview.printings.length);
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('honours the owned-items context when the rule references collection.isOwned', () => {
    const preview = fixtureCatalogPreview();
    const owned = [makeCollectionItem({ printingId: 'p-base-charizard-holo' })];
    const result = runExpression(
      {
        type: 'and',
        children: [
          { type: 'eq', field: 'card.name', value: 'Charizard' },
          { type: 'eq', field: 'collection.isOwned', value: true },
        ],
      },
      preview,
      owned,
    );
    expect(result.matches.map((m) => m.printing.id)).toEqual(['p-base-charizard-holo']);
  });

  it('returns no matches when the rule rejects every printing', () => {
    const preview = fixtureCatalogPreview();
    const result = runExpression(
      { type: 'eq', field: 'card.name', value: 'Mew' },
      preview,
      [],
    );
    expect(result.matches).toHaveLength(0);
  });

  it('uses the injected now() for the evaluatedAt timestamp', () => {
    const preview = fixtureCatalogPreview();
    const result = runExpression(SMART_FIXTURE_EXPRESSION, preview, [], {
      now: () => '2099-12-31T23:59:59.000Z',
    });
    expect(result.evaluatedAt).toBe('2099-12-31T23:59:59.000Z');
  });
});
