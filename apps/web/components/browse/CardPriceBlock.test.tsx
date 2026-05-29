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

describe('CardPriceBlock — trend (#FU-66 / Q-028)', () => {
  function renderPresent(
    overrides: Partial<PrintingCurrentPriceDto> = {},
  ): void {
    const price = makePrintingCurrentPrice({
      printingId: PRINTING_ID,
      ...overrides,
    });
    const api = createFakeBrowseApi({
      currentPricesByPrintingId: { [PRINTING_ID]: price },
    });
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
  }

  it('renders the up trend with an arrow + signed % change', async () => {
    renderPresent({ trendDirection: 'up', trend30dPct: '8.40' });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-trend-up')).toBeInTheDocument();
    });
    const chip = screen.getByTestId('card-prices-trend-up');
    expect(chip.textContent).toContain('+8.40%');
    expect(chip.textContent).toContain('\u25B2');
    expect(chip.textContent).toContain('30d');
  });

  it('renders the down trend with the negative % change', async () => {
    renderPresent({ trendDirection: 'down', trend30dPct: '-4.20' });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-trend-down')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-trend-down').textContent).toContain(
      '-4.20%',
    );
  });

  it('renders the flat trend', async () => {
    renderPresent({ trendDirection: 'flat', trend30dPct: '0.30' });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-trend-flat')).toBeInTheDocument();
    });
  });

  it('suppresses the trend chip when direction is unknown', async () => {
    renderPresent({ trendDirection: 'unknown', trend30dPct: null });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-present')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-trend-unknown')).toBeNull();
    expect(screen.queryByTestId('card-prices-trend-up')).toBeNull();
  });

  it('suppresses the trend chip when the DTO carries no trend fields (backward-compat)', async () => {
    renderPresent({ trendDirection: undefined, trend30dPct: undefined });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-present')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-trend-up')).toBeNull();
    expect(screen.queryByTestId('card-prices-trend-down')).toBeNull();
    expect(screen.queryByTestId('card-prices-trend-flat')).toBeNull();
  });

  it('suppresses the trend chip when direction is present but % is unformattable', async () => {
    renderPresent({ trendDirection: 'up', trend30dPct: null });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-present')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-trend-up')).toBeNull();
  });
});

describe('CardPriceBlock — last seen (#FU-66 / Q-028)', () => {
  function renderPresent(
    overrides: Partial<PrintingCurrentPriceDto> = {},
  ): void {
    const price = makePrintingCurrentPrice({
      printingId: PRINTING_ID,
      ...overrides,
    });
    const api = createFakeBrowseApi({
      currentPricesByPrintingId: { [PRINTING_ID]: price },
    });
    renderWithProviders(<CardPriceBlock api={api} printingId={PRINTING_ID} />);
  }

  it('renders the last-seen line from lastObservationAt', async () => {
    renderPresent({ lastObservationAt: '2026-05-20T09:30:00.000Z' });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-last-seen')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-last-seen').textContent).toMatch(
      /Last seen.*May 20, 2026/,
    );
  });

  it('omits the last-seen line when lastObservationAt is absent', async () => {
    renderPresent({ lastObservationAt: undefined });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-present')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-last-seen')).toBeNull();
  });

  it('omits the last-seen line when lastObservationAt is null', async () => {
    renderPresent({ lastObservationAt: null });
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-present')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-prices-last-seen')).toBeNull();
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
