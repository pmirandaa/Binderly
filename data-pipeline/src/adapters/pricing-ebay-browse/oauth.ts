// `EbayOAuthClient` — handles eBay's client-credentials Application
// Token exchange.
//
// Flow:
//   1. POST `/identity/v1/oauth2/token` to `api.ebay.com`
//      with `Authorization: Basic base64(clientId:clientSecret)` and
//      body `grant_type=client_credentials&scope=...`.
//   2. eBay returns `{ access_token, expires_in, token_type }`.
//   3. We cache the token in-process and refresh ~120 s before
//      `expires_in` to absorb clock skew + in-flight requests.
//
// Error policy:
//   - 401 / 403  → `PermanentError` (bad credentials; not retried).
//   - 4xx (other) → `PermanentError` (contract bug — surface fast).
//   - 429 / 5xx  → owned by `RateLimitedClient` retry policy; if the
//                  retry budget is exhausted, the typed error bubbles.
//   - Schema-mismatched response → `PermanentError`.

import { ebayOAuthTokenResponseSchema, type EbayOAuthTokenResponse } from './types.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { PermanentError, type AdapterContext } from '../../interfaces/adapter.js';

/** Production host for both auth and Browse calls. */
export const EBAY_API_HOST = 'api.ebay.com' as const;

/** Path under `EBAY_API_HOST` for the client-credentials grant. */
export const EBAY_OAUTH_TOKEN_PATH = '/identity/v1/oauth2/token' as const;

/**
 * Single scope that grants the Browse API access. eBay accepts the
 * scope as the URL `https://api.ebay.com/oauth/api_scope` per the
 * client-credentials docs.
 */
export const EBAY_OAUTH_DEFAULT_SCOPE = 'https://api.ebay.com/oauth/api_scope' as const;

/**
 * Refresh a cached token this many ms before its server-declared
 * `expires_in` to absorb clock skew + in-flight latency. eBay tokens
 * are valid 7200 s by default; 120 s is well under 2% of that.
 */
export const EBAY_OAUTH_TOKEN_REFRESH_SKEW_MS = 120_000;

export interface EbayOAuthClientConfig {
  /** RateLimitedClient pinned to `api.ebay.com`. */
  http: RateLimitedClient;
  /** eBay App ID (Client ID). Pulled from env at the runner level. */
  clientId: string;
  /** eBay Cert ID (Client Secret). Pulled from env at the runner level. */
  clientSecret: string;
  /** Scope — defaults to `EBAY_OAUTH_DEFAULT_SCOPE`. */
  scope?: string;
  /** Optional shared adapter context (logger, env). */
  context?: AdapterContext;
  /** Override for tests — defaults to `() => Date.now()`. */
  now?: () => number;
}

interface CachedToken {
  /** The bearer token to put on the `Authorization` header. */
  readonly accessToken: string;
  /** UNIX ms when this token should be considered stale. */
  readonly expiresAt: number;
}

export class EbayOAuthClient {
  private readonly http: RateLimitedClient;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope: string;
  private readonly logger: AdapterContext['logger'] | undefined;
  private readonly now: () => number;

  /** Most recently fetched token; null when uninitialised. */
  private cached: CachedToken | null = null;
  /**
   * In-flight token-fetch promise (deduped). When two callers race
   * for `getApplicationToken()` past a cache miss, only one HTTP call
   * fires; the second awaits the first's promise.
   */
  private pendingFetch: Promise<CachedToken> | null = null;

  constructor(config: EbayOAuthClientConfig) {
    if (!config.http) {
      throw new Error('EbayOAuthClient: `http` (RateLimitedClient) is required');
    }
    if (config.http.host !== EBAY_API_HOST) {
      throw new Error(
        `EbayOAuthClient: RateLimitedClient must be pinned to ${EBAY_API_HOST} (got ${config.http.host})`,
      );
    }
    if (!config.clientId) {
      throw new Error('EbayOAuthClient: `clientId` is required');
    }
    if (!config.clientSecret) {
      throw new Error('EbayOAuthClient: `clientSecret` is required');
    }
    this.http = config.http;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.scope = config.scope ?? EBAY_OAUTH_DEFAULT_SCOPE;
    this.logger = config.context?.logger;
    this.now = config.now ?? ((): number => Date.now());
  }

  /**
   * Return a valid Application Token, fetching + caching as needed.
   * Concurrent callers share a single in-flight fetch.
   */
  async getApplicationToken(): Promise<string> {
    const nowMs = this.now();
    if (this.cached && nowMs < this.cached.expiresAt) {
      return this.cached.accessToken;
    }
    if (this.pendingFetch) {
      const t = await this.pendingFetch;
      return t.accessToken;
    }
    this.pendingFetch = this.fetchFreshToken().finally(() => {
      this.pendingFetch = null;
    });
    const token = await this.pendingFetch;
    this.cached = token;
    return token.accessToken;
  }

  /** Drop the cache. Tests use this to force a refresh. */
  invalidate(): void {
    this.cached = null;
  }

  private async fetchFreshToken(): Promise<CachedToken> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`, 'utf8').toString('base64');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: this.scope,
    }).toString();

    const res = await this.http.request(EBAY_OAUTH_TOKEN_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });

    let parsedJson: unknown;
    try {
      parsedJson = await res.json();
    } catch (cause) {
      throw new PermanentError('EbayOAuthClient: token response is not valid JSON', {
        source: EBAY_API_HOST,
        target: EBAY_OAUTH_TOKEN_PATH,
        cause,
      });
    }

    const validated = ebayOAuthTokenResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
      this.logger?.error(
        {
          source: 'ebay_browse',
          target: EBAY_OAUTH_TOKEN_PATH,
          issues: validated.error.issues,
        },
        'ebay-browse.oauth.invalid_response',
      );
      throw new PermanentError('EbayOAuthClient: token response did not match schema', {
        source: EBAY_API_HOST,
        target: EBAY_OAUTH_TOKEN_PATH,
        cause: validated.error,
      });
    }

    const tok: EbayOAuthTokenResponse = validated.data;
    const ttlMs = Math.max(0, tok.expires_in * 1000 - EBAY_OAUTH_TOKEN_REFRESH_SKEW_MS);
    const expiresAt = this.now() + ttlMs;
    this.logger?.info(
      {
        source: 'ebay_browse',
        expires_in_s: tok.expires_in,
        refresh_skew_ms: EBAY_OAUTH_TOKEN_REFRESH_SKEW_MS,
      },
      'ebay-browse.oauth.token_refreshed',
    );
    return { accessToken: tok.access_token, expiresAt };
  }
}

/**
 * Convenience factory — defaults the rate-limit floor and User-Agent
 * to the documented Binderly conservative values for `api.ebay.com`.
 *
 * Production callers (the CLI) typically use this; tests pass a
 * hand-rolled `RateLimitedClient` with `fetchImpl` injected.
 */
export function createEbayOAuthClient(config: {
  clientId: string;
  clientSecret: string;
  http?: RateLimitedClient;
  httpOverrides?: Partial<ConstructorParameters<typeof RateLimitedClient>[0]>;
  scope?: string;
  context?: AdapterContext;
  now?: () => number;
}): EbayOAuthClient {
  const http =
    config.http ??
    new RateLimitedClient({
      host: EBAY_API_HOST,
      requestsPerSecond: 1,
      burst: 5,
      userAgent: 'binderly-data-pipeline/1.0 (+https://github.com/pmirandaa/Binderly)',
      ...(config.httpOverrides ?? {}),
    });
  const ctorConfig: EbayOAuthClientConfig = {
    http,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  };
  if (config.scope !== undefined) ctorConfig.scope = config.scope;
  if (config.context !== undefined) ctorConfig.context = config.context;
  if (config.now !== undefined) ctorConfig.now = config.now;
  return new EbayOAuthClient(ctorConfig);
}
