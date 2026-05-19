import { describe, expect, it } from 'vitest';

import type { SmartPreviewItemDto, SmartPreviewResponseDto } from '@binderly/api-contracts';

import {
  fixtureCatalogPreview,
  makeCollectionItem,
  SMART_FIXTURE_EXPRESSION,
} from './fixtures';
import {
  mapSmartPreviewResponse,
  parseSmartExpressionInput,
  previewItemToView,
  runExpression,
  runMatchToView,
} from './run';

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

describe('runMatchToView', () => {
  it('projects a SmartRunMatch to the narrow display shape', () => {
    const preview = fixtureCatalogPreview();
    const result = runExpression(SMART_FIXTURE_EXPRESSION, preview, []);
    const view = runMatchToView(result.matches[0]!);
    expect(view.printingId).toBe(result.matches[0]!.printing.id);
    expect(view.cardName).toBe(result.matches[0]!.card.name);
    expect(view.cardNumber).toBe(result.matches[0]!.card.number);
    expect(view.setName).toBe(result.matches[0]!.set.name);
    expect(view.variantLabel.length).toBeGreaterThan(0);
    expect(view.imageSmallUrl).toBe(result.matches[0]!.printing.imageSmallUrl);
  });

  it('humanises the variant class label', () => {
    const preview = fixtureCatalogPreview();
    const result = runExpression(SMART_FIXTURE_EXPRESSION, preview, []);
    const view = runMatchToView(result.matches[0]!);
    expect(view.variantLabel).not.toContain('_');
    expect(view.variantLabel).toBe(view.variantLabel.toLowerCase());
  });
});

describe('previewItemToView', () => {
  it('projects a SmartPreviewItemDto verbatim into the display shape', () => {
    const item: SmartPreviewItemDto = {
      printingId: '11111111-1111-1111-1111-111111111111',
      cardId: '22222222-2222-2222-2222-222222222222',
      setId: '33333333-3333-3333-3333-333333333333',
      cardName: 'Charizard',
      cardNumber: '4',
      setName: 'Base Set',
      setCode: 'base1',
      variantLabel: 'Holo',
      imageSmallUrl: null,
    };
    const view = previewItemToView(item);
    expect(view.printingId).toBe(item.printingId);
    expect(view.cardName).toBe(item.cardName);
    expect(view.variantLabel).toBe('Holo');
    expect(view.imageSmallUrl).toBeNull();
  });
});

describe('mapSmartPreviewResponse', () => {
  it('maps items into views and forwards totalCount / nextOffset', () => {
    const response: SmartPreviewResponseDto = {
      items: [
        {
          printingId: '11111111-1111-1111-1111-111111111111',
          cardId: '22222222-2222-2222-2222-222222222222',
          setId: '33333333-3333-3333-3333-333333333333',
          cardName: 'Charizard',
          cardNumber: '4',
          setName: 'Base Set',
          setCode: 'base1',
          variantLabel: 'Holo',
          imageSmallUrl: null,
        },
      ],
      totalCount: 42,
      nextOffset: 1,
    };
    const out = mapSmartPreviewResponse(response);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]?.printingId).toBe(response.items[0]?.printingId);
    expect(out.totalCount).toBe(42);
    expect(out.nextOffset).toBe(1);
  });

  it('returns an empty view for an empty response', () => {
    const out = mapSmartPreviewResponse({ items: [], totalCount: 0, nextOffset: null });
    expect(out.matches).toEqual([]);
    expect(out.totalCount).toBe(0);
    expect(out.nextOffset).toBeNull();
  });
});
