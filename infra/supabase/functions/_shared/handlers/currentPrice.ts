// Handler for `GET /v1/printings/:id/current-price`.
//
// Returns the headline price for one printing (one grade tier, one
// market, one currency) from `mv_current_price`. Mirrors
// `printingCurrentPriceDto` in
// `packages/api-contracts/src/pricing.ts`.
//
// The query takes two optional query params:
//
//   - `gradeTier` — defaults to `'RAW_NM'`. Validated against
//     `GRADE_TIERS` below; an invalid value is a 400 envelope so
//     misconfigured frontends don't silently get an unrelated row.
//   - `market` — defaults to `'EBAY_US'`. Validated against
//     `MARKET_CODES` below.
//
// The endpoint is authed because pricing data is product-tier-gated
// in `PROJECT.md` § 13. We use the user-scoped client, but the
// `mv_current_price` table is public-read (granted to
// `anon, authenticated` in migration `0013`) so the JWT just gates
// the access path, not the row visibility.
//
// Freshness band derivation. `mv_current_price.computed_at` is the
// wall-clock time the rollup job last touched this slice; we
// bucketize:
//
//   - `'fresh'`     — computed_at ≤ 7 days ago
//   - `'stale'`     — 7 < computed_at ≤ 30 days ago
//   - `'stale_old'` — computed_at > 30 days ago
//
// Pre-bucketing server-side keeps the SSR HTML + client cache + OG
// image in lockstep without timezone / rounding drift (see Q-006
// in `open-questions.md`).

import { ApiError, apiOk } from '../errors.ts';
import { requireUser, translatePostgrestError } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

// Mirror the canonical enums from `packages/api-contracts/src/common.ts`.
// The mirror tests in `contracts.test.ts` enforce no drift.
const GRADE_TIERS = new Set([
  'RAW_NM',
  'RAW_LP',
  'RAW_MP',
  'RAW_HP',
  'RAW_DMG',
  'RAW_UNKNOWN',
  'PSA_10',
  'PSA_9',
  'PSA_8',
  'PSA_7',
  'PSA_LOWER',
  'BGS_10_BLACK',
  'BGS_10',
  'BGS_9_5',
  'BGS_9',
  'BGS_LOWER',
  'CGC_10_PRISTINE',
  'CGC_10',
  'CGC_9_5',
  'CGC_9',
  'CGC_LOWER',
  'OTHER_GRADED',
]);

const MARKET_CODES = new Set([
  'EBAY_US',
  'EBAY_DE',
  'EBAY_UK',
  'EBAY_JP',
  'CARDMARKET_EU',
  'TCGPLAYER_DERIVED',
  'OTHER',
]);

const DEFAULT_GRADE_TIER = 'RAW_NM';
const DEFAULT_MARKET = 'EBAY_US';
const MV_CURRENT_PRICE = 'mv_current_price';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface MvCurrentPriceRow {
  readonly printing_id: string;
  readonly grade_tier: string;
  readonly market: string;
  readonly currency: string;
  readonly period_start: string;
  readonly median_price: string | null;
  readonly mean_price: string | null;
  readonly low_price: string | null;
  readonly high_price: string | null;
  readonly sample_count: number;
  readonly computed_at: string;
  // v2 trend + freshness enrichment (migration
  // `0028_pricing_current_view_v2.sql`, #FU-5). `numeric` columns
  // arrive as decimal strings over PostgREST; `sample_count_30d` is an
  // `integer`; `trend_direction` is always populated server-side.
  readonly current_price: string | null;
  readonly trend_30d_pct: string | null;
  readonly trend_90d_pct: string | null;
  readonly trend_all_time_pct: string | null;
  readonly trend_direction: 'up' | 'down' | 'flat' | 'unknown';
  readonly sample_count_30d: number;
  readonly last_observation_at: string | null;
}

export async function handleGetPrintingCurrentPrice(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const printingId = match.params['id'];
  if (printingId === undefined || !UUID_REGEX.test(printingId)) {
    throw new ApiError('VALIDATION', 'printing id must be a UUID.');
  }
  const gradeTier = (match.searchParams.get('gradeTier') ?? DEFAULT_GRADE_TIER).trim();
  const market = (match.searchParams.get('market') ?? DEFAULT_MARKET).trim();
  if (!GRADE_TIERS.has(gradeTier)) {
    throw new ApiError('VALIDATION', `Invalid gradeTier: ${gradeTier}.`);
  }
  if (!MARKET_CODES.has(market)) {
    throw new ApiError('VALIDATION', `Invalid market: ${market}.`);
  }

  const { data, error } = await session.supabase
    .from(MV_CURRENT_PRICE)
    .select(
      'printing_id, grade_tier, market, currency, period_start, median_price, mean_price, low_price, high_price, sample_count, computed_at, current_price, trend_30d_pct, trend_90d_pct, trend_all_time_pct, trend_direction, sample_count_30d, last_observation_at',
    )
    .eq('printing_id', printingId)
    .eq('grade_tier', gradeTier)
    .eq('market', market)
    .maybeSingle();

  if (error !== null) {
    throw translatePostgrestError(error);
  }
  if (data === null) {
    throw new ApiError(
      'NOT_FOUND',
      `No current price for printing ${printingId} (gradeTier=${gradeTier}, market=${market}).`,
    );
  }
  const row = data as MvCurrentPriceRow;

  const wire = {
    printingId: row.printing_id,
    gradeTier: row.grade_tier,
    market: row.market,
    currency: row.currency,
    periodStart: row.period_start,
    medianPrice: row.median_price,
    meanPrice: row.mean_price,
    lowPrice: row.low_price,
    highPrice: row.high_price,
    sampleCount: row.sample_count,
    computedAt: row.computed_at,
    freshness: computeFreshness(row.computed_at, () => Date.now()),
    // v2 trend + freshness enrichment, surfaced straight from the
    // materialized view (migration `0028`, #FU-5). `freshness` above
    // keeps its `computedAt`-derived semantics; `lastObservationAt`
    // exposes the raw last-seen timestamp alongside it.
    currentPrice: row.current_price,
    trend30dPct: row.trend_30d_pct,
    trend90dPct: row.trend_90d_pct,
    trendAllTimePct: row.trend_all_time_pct,
    trendDirection: row.trend_direction,
    sampleCount30d: row.sample_count_30d,
    lastObservationAt: row.last_observation_at,
  };

  return apiOk(request, ctx.cors, ctx.requestId, wire);
}

/**
 * Bucketize the materialized view's `computed_at` into the
 * canonical 3-bucket vocabulary the DTO carries.
 *
 * Exported for the unit tests; production calls it inline.
 */
export function computeFreshness(
  computedAt: string,
  now: () => number,
): 'fresh' | 'stale' | 'stale_old' {
  const parsed = Date.parse(computedAt);
  if (Number.isNaN(parsed)) {
    // Defensive — if the materialized view ever serialized an
    // un-parseable string we'd rather bucketize as `stale_old` than
    // crash. The mv has a `timestamptz` column so this should never
    // hit in practice.
    return 'stale_old';
  }
  const ageMs = now() - parsed;
  if (ageMs <= SEVEN_DAYS_MS) return 'fresh';
  if (ageMs <= THIRTY_DAYS_MS) return 'stale';
  return 'stale_old';
}
