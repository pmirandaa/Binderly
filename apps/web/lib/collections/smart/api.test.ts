import { describe, expect, it } from 'vitest';

import { indexOwnedItems, projectCandidateItem } from './api';
import {
  fixtureCatalogPreview,
  makeCollectionItem,
  SMART_FIXTURE_CARDS,
} from './fixtures';

describe('indexOwnedItems', () => {
  it('keys items by printingId', () => {
    const items = [
      makeCollectionItem({ id: 'i-1', printingId: 'p-1' }),
      makeCollectionItem({ id: 'i-2', printingId: 'p-2' }),
    ];
    const map = indexOwnedItems(items);
    expect(map.size).toBe(2);
    expect(map.get('p-1')?.id).toBe('i-1');
    expect(map.get('p-2')?.id).toBe('i-2');
  });

  it('keeps the last item when multiple share a printingId', () => {
    const items = [
      makeCollectionItem({ id: 'i-1', printingId: 'p-1' }),
      makeCollectionItem({ id: 'i-2', printingId: 'p-1' }),
    ];
    const map = indexOwnedItems(items);
    expect(map.get('p-1')?.id).toBe('i-2');
  });
});

describe('projectCandidateItem', () => {
  it('projects all DSL-visible fields off a printing/card/set bundle', () => {
    const preview = fixtureCatalogPreview();
    const printing = preview.printings.find((p) => p.id === 'p-base-charizard-holo');
    expect(printing).toBeDefined();
    const candidate = projectCandidateItem(
      printing!,
      preview.cardsById,
      preview.setsById,
      new Map(),
    );
    expect(candidate).not.toBeNull();
    expect(candidate?.card.name).toBe('Charizard');
    expect(candidate?.set.code).toBe('base1');
    expect(candidate?.printing.variantClass).toBe('HOLO');
    expect(candidate?.collection).toBeUndefined();
  });

  it('returns null when the parent card is missing from the lookup', () => {
    const preview = fixtureCatalogPreview();
    const printing = preview.printings[0]!;
    const candidate = projectCandidateItem(
      printing,
      new Map(),
      preview.setsById,
      new Map(),
    );
    expect(candidate).toBeNull();
  });

  it('attaches the collection slot when the user owns the printing', () => {
    const preview = fixtureCatalogPreview();
    const printing = preview.printings[0]!;
    const owned = indexOwnedItems([
      makeCollectionItem({ printingId: printing.id, quantity: 3, condition: 'LIGHTLY_PLAYED' }),
    ]);
    const candidate = projectCandidateItem(printing, preview.cardsById, preview.setsById, owned);
    expect(candidate?.collection?.quantity).toBe(3);
    expect(candidate?.collection?.condition).toBe('LIGHTLY_PLAYED');
  });
});

describe('fixtureCatalogPreview', () => {
  it('exposes every printing on every card', () => {
    const preview = fixtureCatalogPreview();
    const expected = SMART_FIXTURE_CARDS.flatMap((c) => c.printings).length;
    expect(preview.printings).toHaveLength(expected);
  });
});
