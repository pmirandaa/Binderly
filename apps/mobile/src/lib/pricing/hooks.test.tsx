import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';
import type { BinderlyClient } from '@binderly/api-client';
import type { PrintingCurrentPriceDto } from '@binderly/api-contracts';

import { useCurrentPriceQuery } from './hooks';
import { ApiClientProvider } from '../api-client';

import type { ReactNode } from 'react';

interface FakeClient {
  pricing: {
    getPrintingCurrentPrice: ReturnType<typeof vi.fn>;
  };
}

function buildClient(): FakeClient {
  return {
    pricing: {
      getPrintingCurrentPrice: vi.fn(),
    },
  };
}

function makePrice(
  partial: Partial<PrintingCurrentPriceDto> & { printingId: string },
): PrintingCurrentPriceDto {
  return {
    printingId: partial.printingId,
    gradeTier: partial.gradeTier ?? 'RAW_NM',
    market: partial.market ?? 'EBAY_US',
    currency: partial.currency ?? 'USD',
    periodStart: partial.periodStart ?? '2024-05-01',
    medianPrice: 'medianPrice' in partial ? (partial.medianPrice ?? null) : '5.00',
    meanPrice: 'meanPrice' in partial ? (partial.meanPrice ?? null) : '6.00',
    lowPrice: 'lowPrice' in partial ? (partial.lowPrice ?? null) : '2.00',
    highPrice: 'highPrice' in partial ? (partial.highPrice ?? null) : '10.00',
    sampleCount: partial.sampleCount ?? 4,
    computedAt: partial.computedAt ?? '2024-05-12T00:00:00Z',
    freshness: partial.freshness ?? 'fresh',
  };
}

function renderWithClient(client: FakeClient, printingId: string | undefined) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client as unknown as BinderlyClient}>
        {children}
      </ApiClientProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useCurrentPriceQuery({ printingId }), { wrapper });
}

describe('useCurrentPriceQuery', () => {
  it('returns the price DTO on a success response', async () => {
    const client = buildClient();
    client.pricing.getPrintingCurrentPrice.mockResolvedValue(makePrice({ printingId: 'p1' }));
    const { result } = renderWithClient(client, 'p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.printingId).toBe('p1');
    expect(client.pricing.getPrintingCurrentPrice).toHaveBeenCalledWith({ printingId: 'p1' });
  });

  it('collapses ApiNotFoundError into data: null', async () => {
    const client = buildClient();
    client.pricing.getPrintingCurrentPrice.mockRejectedValue(
      new ApiNotFoundError('No price', { status: 404 }),
    );
    const { result } = renderWithClient(client, 'p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('surfaces non-404 errors via isError', async () => {
    const client = buildClient();
    client.pricing.getPrintingCurrentPrice.mockRejectedValue(new Error('Boom'));
    const { result } = renderWithClient(client, 'p1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Boom');
  });

  it('does not fire when printingId is undefined', async () => {
    const client = buildClient();
    const { result } = renderWithClient(client, undefined);
    // Give react-query a tick to confirm the query stays disabled.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(client.pricing.getPrintingCurrentPrice).not.toHaveBeenCalled();
  });
});
