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
  type CurrentPriceDto,
  type FxRateDto,
  type GradeTier,
  type MarketCode,
  type MarketDto,
  type PaginatedResponse,
  type PriceAggregateDto,
  type PriceHistoryPeriod,
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

export interface PricingResource {
  readonly listMarkets: (options?: { readonly signal?: AbortSignal }) => Promise<MarketDto[]>;
  readonly getCurrentPrice: (options: GetCurrentPriceOptions) => Promise<CurrentPriceDto>;
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
