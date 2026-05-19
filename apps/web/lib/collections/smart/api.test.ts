import { describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type { SmartPreviewResponseDto } from '@binderly/api-contracts';

import { apiToSmartCollectionsApi, indexOwnedItems, projectCandidateItem } from './api';
import {
  fixtureCatalogPreview,
  makeCollectionItem,
  SMART_FIXTURE_CARDS,
  SMART_FIXTURE_EXPRESSION,
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

describe('apiToSmartCollectionsApi.runServerPreview', () => {
  const emptyResponse: SmartPreviewResponseDto = {
    items: [],
    totalCount: 0,
    nextOffset: null,
  };

  type PreviewFn = BinderlyClient['smartCollections']['preview'];

  function makePreviewMock(impl?: PreviewFn): ReturnType<typeof vi.fn<PreviewFn>> {
    const defaultImpl: PreviewFn = async () => emptyResponse;
    return vi.fn<PreviewFn>(impl ?? defaultImpl);
  }

  function makeFakeClient(preview: ReturnType<typeof makePreviewMock>): BinderlyClient {
    return {
      smartCollections: { preview },
    } as unknown as BinderlyClient;
  }

  it('delegates to client.smartCollections.preview with the typed request body', async () => {
    const preview = makePreviewMock();
    const client = makeFakeClient(preview);
    const api = apiToSmartCollectionsApi(client);
    await api.runServerPreview({ expression: SMART_FIXTURE_EXPRESSION });
    expect(preview).toHaveBeenCalledTimes(1);
    const firstCall = preview.mock.calls[0];
    expect(firstCall?.[0]).toEqual({
      expression: SMART_FIXTURE_EXPRESSION,
    });
  });

  it('forwards an AbortSignal when one is provided', async () => {
    const preview = makePreviewMock();
    const client = makeFakeClient(preview);
    const api = apiToSmartCollectionsApi(client);
    const controller = new AbortController();
    await api.runServerPreview({ expression: SMART_FIXTURE_EXPRESSION }, controller.signal);
    const firstCall = preview.mock.calls[0];
    expect(firstCall?.[1]).toEqual({ signal: controller.signal });
  });

  it('omits the signal key when none is provided', async () => {
    const preview = makePreviewMock();
    const client = makeFakeClient(preview);
    const api = apiToSmartCollectionsApi(client);
    await api.runServerPreview({ expression: SMART_FIXTURE_EXPRESSION });
    const firstCall = preview.mock.calls[0];
    expect(firstCall?.[1]).toEqual({});
  });

  it('propagates the underlying client error verbatim', async () => {
    const error = new Error('preview compile failed');
    const preview = makePreviewMock(async () => {
      throw error;
    });
    const client = makeFakeClient(preview);
    const api = apiToSmartCollectionsApi(client);
    await expect(
      api.runServerPreview({ expression: SMART_FIXTURE_EXPRESSION }),
    ).rejects.toBe(error);
  });

  it('returns the response shape verbatim (no projection)', async () => {
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
    const preview = makePreviewMock(async () => response);
    const client = makeFakeClient(preview);
    const api = apiToSmartCollectionsApi(client);
    const out = await api.runServerPreview({ expression: SMART_FIXTURE_EXPRESSION });
    expect(out).toBe(response);
  });
});
