// Tests for the printing current-price endpoint.

import { describe, expect, it } from 'vitest';

import { makeHandler } from '../dispatch.ts';
import { ROUTES } from '../routes-table.ts';
import {
  buildRequest,
  createFakeSupabase,
  makeFakeJwt,
  readErrorBody,
  readSuccessBody,
} from '../test-helpers.ts';
import { computeFreshness } from './currentPrice.ts';

const ENV_GETTER = (name: string): string | undefined => {
  switch (name) {
    case 'SUPABASE_URL':
      return 'https://test.supabase.test';
    case 'SUPABASE_ANON_KEY':
      return 'anon';
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return 'service-role';
    case 'CORS_ALLOW_ORIGINS':
      return '*';
    default:
      return undefined;
  }
};

const PRINTING_ID = '33333333-3333-4333-8333-333333333333';

interface CurrentPriceResponse {
  printingId: string;
  gradeTier: string;
  market: string;
  currency: string;
  periodStart: string;
  medianPrice: string | null;
  meanPrice: string | null;
  lowPrice: string | null;
  highPrice: string | null;
  sampleCount: number;
  computedAt: string;
  freshness: 'fresh' | 'stale' | 'stale_old';
}

function fakeMvRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    printing_id: PRINTING_ID,
    grade_tier: 'RAW_NM',
    market: 'EBAY_US',
    currency: 'USD',
    period_start: '2026-05-19',
    median_price: '12.50',
    mean_price: '13.10',
    low_price: '9.00',
    high_price: '18.00',
    sample_count: 22,
    computed_at: '2026-05-19T08:00:00.000Z',
    ...overrides,
  };
}

function makeHandlerWithFake(fake: ReturnType<typeof createFakeSupabase>) {
  return makeHandler({
    getEnv: ENV_GETTER,
    routes: ROUTES,
    deps: { createClient: () => fake.client },
  });
}

describe('GET /v1/printings/:id/current-price', () => {
  it('returns the typed row on the happy path with default params', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        mv_current_price: [{ data: fakeMvRow(), error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: `http://localhost/v1/printings/${PRINTING_ID}/current-price`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(200);
    const body = await readSuccessBody<CurrentPriceResponse>(response);
    expect(body.printingId).toBe(PRINTING_ID);
    expect(body.gradeTier).toBe('RAW_NM');
    expect(body.market).toBe('EBAY_US');
    expect(body.medianPrice).toBe('12.50');
    expect(body.sampleCount).toBe(22);
    expect(body.freshness).toBeDefined();
  });

  it('honors gradeTier and market query params', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        mv_current_price: [
          {
            data: fakeMvRow({ grade_tier: 'PSA_10', market: 'CARDMARKET_EU', currency: 'EUR' }),
            error: null,
          },
        ],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: `http://localhost/v1/printings/${PRINTING_ID}/current-price?gradeTier=PSA_10&market=CARDMARKET_EU`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    const body = await readSuccessBody<CurrentPriceResponse>(response);
    expect(body.gradeTier).toBe('PSA_10');
    expect(body.market).toBe('CARDMARKET_EU');
    expect(body.currency).toBe('EUR');
    // confirm the eq filters were applied
    const eqCalls = fake.calls.filter((c) => c.method === 'eq');
    expect(eqCalls.some((c) => c.args[0] === 'grade_tier' && c.args[1] === 'PSA_10')).toBe(true);
    expect(eqCalls.some((c) => c.args[0] === 'market' && c.args[1] === 'CARDMARKET_EU')).toBe(true);
  });

  it('returns 400 when printing id is not a UUID', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: 'http://localhost/v1/printings/not-a-uuid/current-price',
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('VALIDATION');
  });

  it('returns 400 on an unknown gradeTier query', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: `http://localhost/v1/printings/${PRINTING_ID}/current-price?gradeTier=NONSENSE`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 on an unknown market query', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: `http://localhost/v1/printings/${PRINTING_ID}/current-price?market=MARS`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 401 envelope for an anonymous caller', async () => {
    const fake = createFakeSupabase();
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: `http://localhost/v1/printings/${PRINTING_ID}/current-price`,
        method: 'GET',
      }),
    );
    expect(response.status).toBe(401);
  });

  it('returns 404 when no row matches', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        mv_current_price: [{ data: null, error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: `http://localhost/v1/printings/${PRINTING_ID}/current-price`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(404);
    const body = await readErrorBody(response);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('translates a PostgREST error into INTERNAL envelope', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        mv_current_price: [
          {
            data: null,
            error: { code: 'XX000', message: 'something broke' },
          },
        ],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      buildRequest({
        url: `http://localhost/v1/printings/${PRINTING_ID}/current-price`,
        method: 'GET',
        token: makeFakeJwt(),
      }),
    );
    expect(response.status).toBe(500);
  });

  it('propagates x-request-id on the success response', async () => {
    const fake = createFakeSupabase({
      tableResponses: {
        mv_current_price: [{ data: fakeMvRow(), error: null }],
      },
    });
    const response = await makeHandlerWithFake(fake)(
      new Request(`http://localhost/v1/printings/${PRINTING_ID}/current-price`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${makeFakeJwt()}`,
          'x-request-id': 'rid-cp-1',
        },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('rid-cp-1');
  });
});

describe('computeFreshness (unit)', () => {
  const NOW = Date.parse('2026-05-19T12:00:00.000Z');

  it('returns `fresh` when computed_at is within 7 days', () => {
    expect(computeFreshness('2026-05-15T12:00:00.000Z', () => NOW)).toBe('fresh');
  });

  it('returns `fresh` exactly at the 7-day boundary', () => {
    expect(computeFreshness('2026-05-12T12:00:00.000Z', () => NOW)).toBe('fresh');
  });

  it('returns `stale` between 7 and 30 days', () => {
    expect(computeFreshness('2026-05-01T12:00:00.000Z', () => NOW)).toBe('stale');
  });

  it('returns `stale_old` past 30 days', () => {
    expect(computeFreshness('2026-04-01T12:00:00.000Z', () => NOW)).toBe('stale_old');
  });

  it('defends against unparseable timestamps', () => {
    expect(computeFreshness('not-a-date', () => NOW)).toBe('stale_old');
  });
});
