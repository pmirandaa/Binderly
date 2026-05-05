// Tests for the pricing resource.

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import { ApiForbiddenError, ApiNotFoundError, ApiResponseDecodeError } from '../error.js';
import { errEnvelope, mockFetch, okEnvelope } from '../test-helpers.js';
import {
  FIXTURE_IDS,
  VALID_CURRENT_PRICE,
  VALID_FX_RATE,
  VALID_MARKET,
  VALID_PAGE,
  VALID_PRICE_AGGREGATE,
} from './_fixtures.js';
import { makePricingResource } from './pricing.js';

function makeResource(fetch: ReturnType<typeof mockFetch>): {
  fetch: ReturnType<typeof mockFetch>;
  pricing: ReturnType<typeof makePricingResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => 'jwt',
    fetch,
  });
  return { fetch, pricing: makePricingResource(http) };
}

describe('pricing.listMarkets', () => {
  it('returns the array on happy path', async () => {
    const { pricing } = makeResource(mockFetch({ status: 200, body: okEnvelope([VALID_MARKET]) }));
    const list = await pricing.listMarkets();
    expect(list).toHaveLength(1);
    expect(list[0]?.code).toBe('EBAY_US');
  });

  it('hits GET /v1/markets', async () => {
    const { fetch, pricing } = makeResource(
      mockFetch({ status: 200, body: okEnvelope([VALID_MARKET]) }),
    );
    await pricing.listMarkets();
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/markets');
  });
});

describe('pricing.getCurrentPrice', () => {
  it('returns the current price on happy path', async () => {
    const { pricing } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CURRENT_PRICE) }),
    );
    const price = await pricing.getCurrentPrice({
      printingId: FIXTURE_IDS.printingId,
      gradeTier: 'RAW_NM',
    });
    expect(price.medianPrice).toBe('120.00');
    expect(price.market).toBe('EBAY_US');
  });

  it('hits GET /v1/printings/{id}/prices/current with gradeTier query param', async () => {
    const { fetch, pricing } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_CURRENT_PRICE) }),
    );
    await pricing.getCurrentPrice({
      printingId: FIXTURE_IDS.printingId,
      gradeTier: 'PSA_10',
      market: 'EBAY_DE',
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v1/printings/${FIXTURE_IDS.printingId}/prices/current`);
    expect(url).toContain('gradeTier=PSA_10');
    expect(url).toContain('market=EBAY_DE');
  });

  it('throws ApiForbiddenError when the freemium gate fires (Pro feature)', async () => {
    const { pricing } = makeResource(mockFetch({ status: 403 }));
    await expect(
      pricing.getCurrentPrice({
        printingId: FIXTURE_IDS.printingId,
        gradeTier: 'RAW_NM',
      }),
    ).rejects.toBeInstanceOf(ApiForbiddenError);
  });

  it('throws ApiNotFoundError when no price row exists yet', async () => {
    const { pricing } = makeResource(
      mockFetch({ status: 404, body: errEnvelope({ code: 'NOT_FOUND', message: 'no data' }) }),
    );
    await expect(
      pricing.getCurrentPrice({
        printingId: FIXTURE_IDS.printingId,
        gradeTier: 'RAW_NM',
      }),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });
});

describe('pricing.getPriceHistory', () => {
  it('returns paginated price-aggregate rows on happy path', async () => {
    const { pricing } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_PRICE_AGGREGATE])) }),
    );
    const page = await pricing.getPriceHistory({
      printingId: FIXTURE_IDS.printingId,
      gradeTier: 'RAW_NM',
      period: '90d',
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.sampleCount).toBe(25);
  });

  it('hits GET /v1/printings/{id}/prices/history with period query param', async () => {
    const { fetch, pricing } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_PAGE([VALID_PRICE_AGGREGATE])) }),
    );
    await pricing.getPriceHistory({
      printingId: FIXTURE_IDS.printingId,
      gradeTier: 'BGS_10',
      market: 'EBAY_US',
      period: '30d',
      cursor: 'c',
      limit: 50,
    });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('gradeTier=BGS_10');
    expect(url).toContain('market=EBAY_US');
    expect(url).toContain('period=30d');
    expect(url).toContain('cursor=c');
    expect(url).toContain('limit=50');
  });

  it('throws ApiResponseDecodeError on shape drift', async () => {
    const { pricing } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ items: [{ broken: true }], nextCursor: null }),
      }),
    );
    await expect(
      pricing.getPriceHistory({
        printingId: FIXTURE_IDS.printingId,
        gradeTier: 'RAW_NM',
      }),
    ).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });
});

describe('pricing.getFxRate', () => {
  it('returns the fx-rate row on happy path', async () => {
    const { pricing } = makeResource(mockFetch({ status: 200, body: okEnvelope(VALID_FX_RATE) }));
    const fx = await pricing.getFxRate({ date: '2026-05-05', currency: 'EUR' });
    expect(fx.quoteCurrency).toBe('EUR');
    expect(fx.rate).toBe('0.92');
  });

  it('hits GET /v1/fx-rates/{date}/{currency}', async () => {
    const { fetch, pricing } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_FX_RATE) }),
    );
    await pricing.getFxRate({ date: '2026-05-05', currency: 'EUR' });
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/fx-rates/2026-05-05/EUR');
  });

  it('throws ApiNotFoundError when the rate is missing', async () => {
    const { pricing } = makeResource(mockFetch({ status: 404 }));
    await expect(pricing.getFxRate({ date: '1900-01-01', currency: 'XXX' })).rejects.toBeInstanceOf(
      ApiNotFoundError,
    );
  });
});
