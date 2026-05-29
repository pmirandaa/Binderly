// `usePrinting` (FU-34) — resolves a printing's name / set / collector
// number / thumbnail by id, with loading → success → error states, an
// id-gated disabled state, and a module-scope dedup cache.

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type { PrintingWithContextDto } from '@binderly/api-contracts';

import { ApiClientProvider } from '../../../lib/api-client.js';
import {
  __resetPrintingCache,
  printingToDisambigLookup,
  thumbnailUrlForPrinting,
  usePrinting,
} from '../use-printing.js';


import type { ReactNode } from 'react';

function makePrinting(
  over: Partial<PrintingWithContextDto> = {},
): PrintingWithContextDto {
  return {
    id: 'p1',
    variantKey: 'p1-holo',
    cardId: 'c1',
    variantClass: 'HOLO',
    variantFlags: [],
    variantCode: 'holo',
    includeInMasterSet: true,
    imageSmallUrl: 'https://img.example/p1-small.png',
    imageLargeUrl: 'https://img.example/p1-large.png',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    card: {
      id: 'c1',
      canonicalKey: 'en-c1',
      setId: 's1',
      language: 'en',
      number: '4/102',
      name: 'Charizard',
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
      rarity: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    set: {
      id: 's1',
      canonicalKey: 'en-base1',
      code: 'base1',
      language: 'en',
      name: 'Base Set',
      series: 'Base',
      releaseDate: '1999-01-09',
      printedTotal: 102,
      total: 102,
      logoUrl: null,
      symbolUrl: null,
      masterSetRules: {},
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    ...over,
  };
}

interface FakeClient {
  cards: { getPrinting: ReturnType<typeof vi.fn> };
}

function buildClient(): FakeClient {
  return { cards: { getPrinting: vi.fn() } };
}

function makeWrapper(client: FakeClient): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }) {
    return (
      <ApiClientProvider client={client as unknown as BinderlyClient}>
        {children}
      </ApiClientProvider>
    );
  };
}

afterEach(() => {
  __resetPrintingCache();
});

describe('usePrinting', () => {
  it('does not fetch when the id is undefined', () => {
    const client = buildClient();
    const { result } = renderHook(() => usePrinting(undefined), {
      wrapper: makeWrapper(client),
    });
    expect(client.cards.getPrinting).not.toHaveBeenCalled();
    expect(result.current.printing).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('resolves a printing and exposes name / set / thumbnail', async () => {
    const client = buildClient();
    client.cards.getPrinting.mockResolvedValue(makePrinting());

    const { result } = renderHook(() => usePrinting('p1'), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.printing).not.toBeNull());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.printing?.card.name).toBe('Charizard');
    expect(thumbnailUrlForPrinting(result.current.printing)).toBe(
      'https://img.example/p1-small.png',
    );
  });

  it('flags an error when the lookup rejects', async () => {
    const client = buildClient();
    client.cards.getPrinting.mockRejectedValue(new Error('404'));

    const { result } = renderHook(() => usePrinting('missing'), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.printing).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('dedups repeat lookups of the same id via the module cache', async () => {
    const client = buildClient();
    client.cards.getPrinting.mockResolvedValue(makePrinting());

    const first = renderHook(() => usePrinting('p1'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(first.result.current.printing).not.toBeNull());

    const second = renderHook(() => usePrinting('p1'), { wrapper: makeWrapper(client) });
    // Cache hit — resolves synchronously from the seed, no second fetch.
    await waitFor(() => expect(second.result.current.printing).not.toBeNull());
    expect(client.cards.getPrinting).toHaveBeenCalledTimes(1);
  });
});

describe('thumbnailUrlForPrinting', () => {
  it('prefers the small image, then the large, then null', () => {
    expect(thumbnailUrlForPrinting(makePrinting())).toBe('https://img.example/p1-small.png');
    expect(
      thumbnailUrlForPrinting(makePrinting({ imageSmallUrl: null })),
    ).toBe('https://img.example/p1-large.png');
    expect(
      thumbnailUrlForPrinting(makePrinting({ imageSmallUrl: null, imageLargeUrl: null })),
    ).toBeNull();
    expect(thumbnailUrlForPrinting(null)).toBeNull();
  });
});

describe('printingToDisambigLookup', () => {
  it('maps a resolved printing to the lookup shape', () => {
    const lookup = printingToDisambigLookup('p1', makePrinting());
    expect(lookup).toEqual({
      displayName: 'Charizard',
      setName: 'Base Set',
      collectorNumber: '4/102',
      thumbnailUrl: 'https://img.example/p1-small.png',
    });
  });

  it('falls back to the id when the printing is unresolved', () => {
    expect(printingToDisambigLookup('p9', null)).toEqual({
      displayName: 'p9',
      setName: '',
      collectorNumber: '',
      thumbnailUrl: null,
    });
  });
});
