// `FrankfurterClient` — thin wrapper around `RateLimitedClient` for the
// Frankfurter FX API (https://frankfurter.dev).
//
// Endpoints used:
//   - `GET /v1/latest`            → most recent business day's rates
//   - `GET /v1/{date}`            → single-day historical rates
//   - `GET /v1/{from}..{to}`      → multi-day historical range
//
// Query parameters: `?base=USD&symbols=EUR,GBP,JPY,AUD,CAD,MXN`.
//
// Rate-limit posture: 1 rps sustained, burst 5 (Frankfurter publishes
// no rate limit; this is a polite floor).
//
// Error policy: 404 (date too old, etc.) bubbles `NotFoundError` — the
// caller decides whether that's an empty result or an error. Malformed
// JSON surfaces `PermanentError` via `RateLimitedClient.json`. Schema
// validation failures (response shape we don't recognize) also surface
// as `PermanentError` so the runner knows it can't retry meaningfully.
//
// Host pinning: the constructor enforces that the `RateLimitedClient`
// is configured for `api.frankfurter.dev`. Mirrors the TCGdex
// adapter's defensive posture.

import {
  BINDERLY_FX_BASE_CURRENCY,
  BINDERLY_FX_QUOTE_CURRENCIES,
  frankfurterRangeResponseSchema,
  frankfurterRatesResponseSchema,
  type FrankfurterRangeResponse,
  type FrankfurterRatesResponse,
} from './types.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { PermanentError, type AdapterContext } from '../../interfaces/adapter.js';

export const FRANKFURTER_HOST = 'api.frankfurter.dev' as const;
export const FRANKFURTER_DEFAULT_BASE_URL = 'https://api.frankfurter.dev' as const;
export const FRANKFURTER_BASE_PATH = '/v1' as const;
/**
 * String tag stored in `fx_rate.source` for every row this client
 * helps populate. Pinned as a constant so the runner and the schema
 * commentary agree.
 */
export const FRANKFURTER_SOURCE = 'frankfurter' as const;

/** Conservative default rate limit — see elaborated task spec. */
export const FRANKFURTER_DEFAULT_RPS = 1;
export const FRANKFURTER_DEFAULT_BURST = 5;

/** Default User-Agent for the Frankfurter client when none is supplied. */
export const FRANKFURTER_DEFAULT_USER_AGENT =
  'binderly-data-pipeline/1.0 (+https://github.com/pmirandaa/Binderly)';

export interface FrankfurterClientConfig {
  /** RateLimitedClient pinned to `api.frankfurter.dev`. */
  http: RateLimitedClient;
  /**
   * Base path under the host. Defaults to `/v1`. Override in tests
   * that need to exercise an alternate prefix.
   */
  basePath?: string;
  /** Optional shared adapter context (logger, env). */
  context?: AdapterContext;
}

export interface FrankfurterRequestOptions {
  /**
   * Override base currency. Defaults to `BINDERLY_FX_BASE_CURRENCY`
   * (`'USD'`). Tests use this; production callers don't.
   */
  base?: string;
  /**
   * Override the symbols list. Defaults to
   * `BINDERLY_FX_QUOTE_CURRENCIES`. Pass an empty array to omit the
   * `symbols` query param entirely (Frankfurter then returns every
   * supported currency).
   */
  symbols?: ReadonlyArray<string>;
}

export class FrankfurterClient {
  private readonly http: RateLimitedClient;
  private readonly basePath: string;
  private readonly logger: AdapterContext['logger'] | undefined;

  constructor(config: FrankfurterClientConfig) {
    if (!config.http) {
      throw new Error('FrankfurterClient: `http` (RateLimitedClient) is required');
    }
    if (config.http.host !== FRANKFURTER_HOST) {
      throw new Error(
        `FrankfurterClient: RateLimitedClient must be pinned to ${FRANKFURTER_HOST} (got ${config.http.host})`,
      );
    }
    this.http = config.http;
    this.basePath = (config.basePath ?? FRANKFURTER_BASE_PATH).replace(/\/$/, '');
    this.logger = config.context?.logger;
  }

  /**
   * `GET /v1/latest?base=USD&symbols=…` — most recent business-day
   * publication. Frankfurter returns the actual `date` of the
   * publication in the response body; weekends / holidays surface
   * Friday's (or whichever the most-recent business day is) rates.
   */
  getLatest(options: FrankfurterRequestOptions = {}): Promise<FrankfurterRatesResponse> {
    return this.fetchRates(this.path('/latest', options));
  }

  /**
   * `GET /v1/{date}?base=USD&symbols=…` — historical rates for a
   * specific date. If the date predates Frankfurter's coverage (1999
   * for EUR-base, varies for others) the upstream returns 404, which
   * bubbles as `NotFoundError`.
   *
   * NOTE: like `/latest`, weekend / holiday requests are silently
   * remapped server-side to the most recent prior business day; the
   * response's `date` reflects the actual rate date, not the
   * requested one. Callers MUST persist on the returned `date`.
   */
  async getHistorical(
    date: string,
    options: FrankfurterRequestOptions = {},
  ): Promise<FrankfurterRatesResponse> {
    if (!isIsoDate(date)) {
      throw new Error(`FrankfurterClient.getHistorical: invalid ISO date "${date}"`);
    }
    return this.fetchRates(this.path(`/${date}`, options));
  }

  /**
   * `GET /v1/{from}..{to}?base=USD&symbols=…` — historical rates for a
   * range of dates. Holes (weekends / holidays) are absent from the
   * response's `rates` map; the runner skips them.
   */
  async getRange(
    fromDate: string,
    toDate: string,
    options: FrankfurterRequestOptions = {},
  ): Promise<FrankfurterRangeResponse> {
    if (!isIsoDate(fromDate)) {
      throw new Error(`FrankfurterClient.getRange: invalid from date "${fromDate}"`);
    }
    if (!isIsoDate(toDate)) {
      throw new Error(`FrankfurterClient.getRange: invalid to date "${toDate}"`);
    }
    if (fromDate > toDate) {
      throw new Error(`FrankfurterClient.getRange: from (${fromDate}) is after to (${toDate})`);
    }
    const target = this.path(`/${fromDate}..${toDate}`, options);
    const body = await this.http.json<unknown>(target);
    const parsed = frankfurterRangeResponseSchema.safeParse(body);
    if (!parsed.success) {
      this.logger?.error(
        { source: FRANKFURTER_SOURCE, target, issues: parsed.error.issues },
        'frankfurter.range.invalid_response',
      );
      throw new PermanentError(`FrankfurterClient: response did not match range schema`, {
        source: FRANKFURTER_HOST,
        target,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  private async fetchRates(target: string): Promise<FrankfurterRatesResponse> {
    const body = await this.http.json<unknown>(target);
    const parsed = frankfurterRatesResponseSchema.safeParse(body);
    if (!parsed.success) {
      this.logger?.error(
        { source: FRANKFURTER_SOURCE, target, issues: parsed.error.issues },
        'frankfurter.rates.invalid_response',
      );
      throw new PermanentError(`FrankfurterClient: response did not match rates schema`, {
        source: FRANKFURTER_HOST,
        target,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  private path(suffix: string, options: FrankfurterRequestOptions): string {
    const base = options.base ?? BINDERLY_FX_BASE_CURRENCY;
    const symbols =
      options.symbols === undefined
        ? [...BINDERLY_FX_QUOTE_CURRENCIES]
        : Array.from(options.symbols);
    const params = new URLSearchParams();
    params.set('base', base);
    if (symbols.length > 0) {
      params.set('symbols', symbols.join(','));
    }
    const qs = params.toString();
    const path = `${this.basePath}${suffix}`;
    return qs ? `${path}?${qs}` : path;
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

/**
 * Convenience factory: build a `FrankfurterClient` from an optional
 * pre-configured rate-limited client, defaulting to the conservative
 * Frankfurter floor (1 rps / burst 5) and the documented Binderly
 * User-Agent.
 *
 * Production callers (the CLI / cron entry) typically use this; tests
 * pass a hand-rolled client with `fetchImpl` injected.
 */
export function createFrankfurterClient(
  options: {
    http?: RateLimitedClient;
    httpOverrides?: Partial<ConstructorParameters<typeof RateLimitedClient>[0]>;
    context?: AdapterContext;
    basePath?: string;
  } = {},
): FrankfurterClient {
  const http =
    options.http ??
    new RateLimitedClient({
      host: FRANKFURTER_HOST,
      requestsPerSecond: FRANKFURTER_DEFAULT_RPS,
      burst: FRANKFURTER_DEFAULT_BURST,
      userAgent: FRANKFURTER_DEFAULT_USER_AGENT,
      ...(options.httpOverrides ?? {}),
    });
  const config: FrankfurterClientConfig = { http };
  if (options.context !== undefined) config.context = options.context;
  if (options.basePath !== undefined) config.basePath = options.basePath;
  return new FrankfurterClient(config);
}
