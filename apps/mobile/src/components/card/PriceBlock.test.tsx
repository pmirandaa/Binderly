import { describe, expect, it, vi } from 'vitest';

import type { PrintingCurrentPriceDto } from '@binderly/api-contracts';

import { renderWithProvider } from '../../test-utils/render.js';

// `<PriceBlock>` reads `useCurrentPriceQuery` from the pricing lib
// barrel; mock it so these tests exercise the render branches
// directly without standing up react-query + the api-client.
const useCurrentPriceQuery = vi.fn();
vi.mock('../../lib/pricing/index.js', () => ({
  useCurrentPriceQuery: (args: { printingId: string | undefined }) =>
    useCurrentPriceQuery(args) as unknown,
}));

const { PriceBlock } = await import('./PriceBlock.js');

function makePrice(
  overrides: Partial<PrintingCurrentPriceDto> = {},
): PrintingCurrentPriceDto {
  return {
    printingId: 'pr-1',
    gradeTier: 'RAW_NM',
    market: 'EBAY_US',
    currency: 'USD',
    periodStart: '2026-05-12',
    medianPrice: '42.50',
    meanPrice: '45.10',
    lowPrice: '30.00',
    highPrice: '70.00',
    sampleCount: 18,
    computedAt: '2026-05-18T12:00:00.000Z',
    freshness: 'fresh',
    ...overrides,
  };
}

function mockSuccess(price: PrintingCurrentPriceDto): void {
  useCurrentPriceQuery.mockReturnValue({
    data: price,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe('<PriceBlock> (mobile) — trend (#FU-66 / Q-028)', () => {
  it('renders the up trend with arrow + signed % change', () => {
    mockSuccess(makePrice({ trendDirection: 'up', trend30dPct: '8.40' }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    const trend = result.getByTestId('card-prices-trend');
    expect(trend).toBeTruthy();
    expect(trend.textContent).toContain('+8.40%');
    expect(trend.textContent).toContain('\u25B2');
    expect(trend.textContent).toContain('30d');
  });

  it('renders the down trend with the negative % change', () => {
    mockSuccess(makePrice({ trendDirection: 'down', trend30dPct: '-4.20' }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    expect(result.getByTestId('card-prices-trend').textContent).toContain('-4.20%');
  });

  it('suppresses the trend when direction is unknown', () => {
    mockSuccess(makePrice({ trendDirection: 'unknown', trend30dPct: null }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    expect(result.queryByTestId('card-prices-trend')).toBeNull();
  });

  it('suppresses the trend when no trend fields are present (backward-compat)', () => {
    mockSuccess(makePrice({ trendDirection: undefined, trend30dPct: undefined }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    expect(result.queryByTestId('card-prices-trend')).toBeNull();
  });

  it('suppresses the trend when direction is present but % is unformattable', () => {
    mockSuccess(makePrice({ trendDirection: 'up', trend30dPct: null }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    expect(result.queryByTestId('card-prices-trend')).toBeNull();
  });
});

describe('<PriceBlock> (mobile) — last seen (#FU-66 / Q-028)', () => {
  it('renders the last-seen line from lastObservationAt', () => {
    mockSuccess(makePrice({ lastObservationAt: '2026-05-20T09:30:00.000Z' }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    const lastSeen = result.getByTestId('card-prices-last-seen');
    expect(lastSeen.textContent).toContain('Last seen');
    expect(lastSeen.textContent).toContain('May 20, 2026');
  });

  it('omits the last-seen line when lastObservationAt is absent', () => {
    mockSuccess(makePrice({ lastObservationAt: undefined }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    expect(result.queryByTestId('card-prices-last-seen')).toBeNull();
  });

  it('omits the last-seen line when lastObservationAt is null', () => {
    mockSuccess(makePrice({ lastObservationAt: null }));
    const result = renderWithProvider(<PriceBlock printingId="pr-1" />);
    expect(result.queryByTestId('card-prices-last-seen')).toBeNull();
  });
});
