import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PrintingCurrentPriceDto } from '@binderly/api-contracts';

import { CardPriceBlock } from './CardPriceBlock';
import {
  createFakeBrowseApi,
  makePrintingCurrentPrice,
} from '../../lib/browse/fixtures';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/cards/abc',
  useSearchParams: () => new URLSearchParams(),
}));

const PRINTING_ID = 'pr-1';

describe('CardPriceBlock — loading', () => {
  it('shows the loading state while the read is in flight', async () => {
    let resolvePrice:
      | ((v: PrintingCurrentPriceDto | null) => void)
      | null = null;
    const api = createFakeBrowseApi();
    api.getCurrentPrice.mockImplementation(
      () =>
        new Promise((r) => {
          resolvePrice = r as (v: PrintingCurrentPriceDto | null) => void;
        }),
    );
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
    expect(screen.getByTestId('card-prices-loading')).toBeInTheDocument();
    await act(async () => {
      resolvePrice?.(null);
    });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-absent')).toBeInTheDocument();
    });
  });
});

describe('CardPriceBlock — absent (404) state', () => {
  it('renders the absent state when the fixture has no row for this printing', async () => {
    const api = createFakeBrowseApi();
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-absent')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-absent').textContent).toMatch(
      /no pricing data yet/i,
    );
  });

  it('does NOT render the present chip when the price is null', async () => {
    const api = createFakeBrowseApi();
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-absent')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-present')).toBeNull();
    expect(screen.queryByTestId('card-prices-median')).toBeNull();
  });
});

describe('CardPriceBlock — error state', () => {
  it('renders the error state when getCurrentPrice rejects with a generic Error', async () => {
    const api = createFakeBrowseApi();
    api.getCurrentPrice.mockRejectedValue(new Error('upstream down'));
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-error')).toHaveTextContent(
      'upstream down',
    );
  });

  it('falls back to a generic copy when the error has no message', async () => {
    const api = createFakeBrowseApi();
    api.getCurrentPrice.mockRejectedValue(new Error(''));
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-error').textContent).toMatch(
      /Failed to load pricing data/i,
    );
  });
});

describe('CardPriceBlock — present state', () => {
  function renderPresent(
    overrides: Partial<PrintingCurrentPriceDto> = {},
  ): ReturnType<typeof createFakeBrowseApi> {
    const price = makePrintingCurrentPrice({
      printingId: PRINTING_ID,
      ...overrides,
    });
    const api = createFakeBrowseApi({
      currentPricesByPrintingId: { [PRINTING_ID]: price },
    });
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
    return api;
  }

  it('renders the median price using formatPrice', async () => {
    renderPresent({ medianPrice: '42.50', currency: 'USD' });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-median')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-median').textContent).toContain(
      '$42.50',
    );
  });

  it('renders the price range using formatPrice', async () => {
    renderPresent({ lowPrice: '30.00', highPrice: '70.00', currency: 'USD' });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-range')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-range').textContent).toMatch(
      /\$30\.00.*\$70\.00/,
    );
  });

  it('renders the freshness badge for the fresh band', async () => {
    renderPresent({ freshness: 'fresh' });
    await waitFor(() => {
      expect(
        screen.getByTestId('card-prices-freshness-fresh'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-freshness-fresh')).toHaveTextContent(
      'Fresh',
    );
  });

  it('renders the freshness badge for the stale_old band as "Outdated"', async () => {
    renderPresent({ freshness: 'stale_old' });
    await waitFor(() => {
      expect(
        screen.getByTestId('card-prices-freshness-stale_old'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('card-prices-freshness-stale_old'),
    ).toHaveTextContent('Outdated');
  });

  it('renders the supporting metadata (sample count + computed date)', async () => {
    renderPresent({
      sampleCount: 18,
      computedAt: '2026-05-18T12:00:00.000Z',
    });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-meta')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-meta').textContent).toMatch(
      /18 observations/,
    );
    expect(screen.getByTestId('card-prices-meta').textContent).toMatch(
      /May 18, 2026/,
    );
  });

  it('treats sampleCount of 1 with the singular noun', async () => {
    renderPresent({ sampleCount: 1 });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-meta')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-meta').textContent).toMatch(
      /1 observation\b/,
    );
  });

  it('treats a degenerate all-null-prices row as the absent state', async () => {
    renderPresent({
      medianPrice: null,
      meanPrice: null,
      lowPrice: null,
      highPrice: null,
      sampleCount: 0,
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('card-prices-empty-row'),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-median')).toBeNull();
  });

  it('omits the range row when only median is present', async () => {
    renderPresent({ lowPrice: null, highPrice: null });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-median')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-range')).toBeNull();
  });
});

describe('CardPriceBlock — api wiring', () => {
  it('calls api.getCurrentPrice with the printingId + AbortSignal', async () => {
    const api = createFakeBrowseApi();
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(api.getCurrentPrice).toHaveBeenCalledTimes(1);
    });
    const args = api.getCurrentPrice.mock.calls[0];
    expect(args?.[0]).toBe(PRINTING_ID);
    expect(args?.[1]).toBeInstanceOf(AbortSignal);
  });
});
