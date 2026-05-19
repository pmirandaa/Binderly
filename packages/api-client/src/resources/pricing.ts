// Pricing resource — current price (over `mv_current_price`),
// price history (over `price_aggregate`), market catalog reads,
// and FX-rate lookups.
//
// All methods are read-only. Pricing tables are public-read per
// `context/data-model.md` "RLS policies (summary)" so anonymous
// callers can hit the catalog endpoints; per-printing reads on
// `mv_current_price` may be gated by the freemium tier in
// production (PROJECT.md §16: "Pricing graphs / history" is a
// Pro feature). The Edge Function layer (T-BE-EDGE-FUNCTIONS)
// owns that gating; this client just calls the endpoint and
// surfaces 403 as `ApiForbiddenError`.

import { z } from 'zod';

import {
  currentPriceDto,
  fxRateDto,
  marketDto,
  paginatedResponseSchema,
  priceAggregateDto,
  printingCurrentPriceDto,
  type CurrentPriceDto,
  type FxRateDto,
  type GradeTier,
  type MarketCode,
  type MarketDto,
  type PaginatedResponse,
  type PriceAggregateDto,
  type PriceHistoryPeriod,
  type PrintingCurrentPriceDto,
} from '@binderly/api-contracts';

import type { HttpClient } from '../client.js';

export interface GetCurrentPriceOptions {
  readonly printingId: string;
  readonly gradeTier: GradeTier;
  /** Defaults to user's preferred market server-side (then to `EBAY_US`). */
  readonly market?: MarketCode;
  readonly signal?: AbortSignal;
}

export interface GetPriceHistoryOptions {
  readonly printingId: string;
  readonly gradeTier: GradeTier;
  readonly market?: MarketCode;
  /** `'30d'` (default) | `'90d'` | `'all'`. */
  readonly period?: PriceHistoryPeriod;
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface GetFxRateOptions {
  /** ISO date string (`YYYY-MM-DD`). */
  readonly date: string;
  /** Quote currency (e.g. `EUR`, `JPY`). Base is always USD. */
  readonly currency: string;
  readonly signal?: AbortSignal;
}

/**
 * Options for the headline-price endpoint
 * (`GET /v1/printings/:id/current-price`). `gradeTier` and
 * `market` default server-side to `RAW_NM` and `EBAY_US`.
 */
export interface GetPrintingCurrentPriceOptions {
  readonly printingId: string;
  readonly gradeTier?: GradeTier;
  readonly market?: MarketCode;
  readonly signal?: AbortSignal;
}

export interface PricingResource {
  readonly listMarkets: (options?: { readonly signal?: AbortSignal }) => Promise<MarketDto[]>;
  readonly getCurrentPrice: (options: GetCurrentPriceOptions) => Promise<CurrentPriceDto>;
  /**
   * Headline price for a single printing. Reads
   * `mv_current_price` for the default `(RAW_NM, EBAY_US)` slice
   * unless overridden. Sibling to {@link getCurrentPrice}, which
   * targets the all-tiers / all-markets `/prices/current` URL.
   */
  readonly getPrintingCurrentPrice: (
    options: GetPrintingCurrentPriceOptions,
  ) => Promise<PrintingCurrentPriceDto>;
  readonly getPriceHistory: (
    options: GetPriceHistoryOptions,
  ) => Promise<PaginatedResponse<PriceAggregateDto>>;
  readonly getFxRate: (options: GetFxRateOptions) => Promise<FxRateDto>;
}

const marketArraySchema = z.array(marketDto);
const priceHistorySchema = paginatedResponseSchema(priceAggregateDto);

export function makePricingResource(http: HttpClient): PricingResource {
  return {
    async listMarkets(options = {}): Promise<MarketDto[]> {
      return http.request(
        {
          path: '/v1/markets',
          method: 'GET',
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        marketArraySchema,
      );
    },

    async getCurrentPrice({ printingId, gradeTier, market, signal }): Promise<CurrentPriceDto> {
      return http.request(
        {
          path: `/v1/printings/${encodeURIComponent(printingId)}/prices/current`,
          method: 'GET',
          query: { gradeTier, market },
          ...(signal !== undefined ? { signal } : {}),
        },
        currentPriceDto,
      );
    },

    async getPrintingCurrentPrice({
      printingId,
      gradeTier,
      market,
      signal,
    }): Promise<PrintingCurrentPriceDto> {
      return http.request(
        {
          path: `/v1/printings/${encodeURIComponent(printingId)}/current-price`,
          method: 'GET',
          query: { gradeTier, market },
          ...(signal !== undefined ? { signal } : {}),
        },
        printingCurrentPriceDto,
      );
    },

    async getPriceHistory({
      printingId,
      gradeTier,
      market,
      period,
      cursor,
      limit,
      signal,
    }): Promise<PaginatedResponse<PriceAggregateDto>> {
      return http.request(
        {
          path: `/v1/printings/${encodeURIComponent(printingId)}/prices/history`,
          method: 'GET',
          query: { gradeTier, market, period, cursor, limit },
          ...(signal !== undefined ? { signal } : {}),
        },
        priceHistorySchema,
      );
    },

    async getFxRate({ date, currency, signal }): Promise<FxRateDto> {
      return http.request(
        {
          path: `/v1/fx-rates/${encodeURIComponent(date)}/${encodeURIComponent(currency)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        fxRateDto,
      );
    },
  };
}
