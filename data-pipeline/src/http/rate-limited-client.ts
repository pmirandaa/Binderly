// `RateLimitedClient` — the only HTTP surface adapters use.
//
// Wraps `globalThis.fetch` (Node 22 native) with:
//
//   - per-host token-bucket rate limiting (Bottleneck);
//   - retries with exponential backoff for 5xx and network errors;
//   - 429 / 503 honor `Retry-After` (seconds or HTTP-date);
//   - configurable User-Agent (mandatory — every adapter must
//     identify itself per `context/legal-and-brand.md`);
//   - structured pino logging at request / retry / give-up boundaries;
//   - test injection point: pass a custom `fetchImpl` to short-circuit
//     the global fetch (lets tests use undici MockAgent or msw without
//     monkey-patching).
//
// Throws typed errors from `../interfaces/adapter.ts`:
//   - `RateLimitError` when 429 retries are exhausted;
//   - `TransientError` when 5xx / network retries are exhausted;
//   - `PermanentError` for 4xx (other than 429) and unhandlable
//     responses;
//   - `NotFoundError` for 404 (special-cased so adapters can detect
//     "this entity simply doesn't exist on this source").

import Bottleneck from 'bottleneck';

import {
  NotFoundError,
  PermanentError,
  RateLimitError,
  TransientError,
  type AdapterLogger,
} from '../interfaces/adapter.js';

export interface RateLimitedClientConfig {
  /** Hostname the client manages (e.g. `api.tcgdex.net`). Used as the rate-limit bucket key. */
  host: string;
  /**
   * Sustained request rate. Bottleneck enforces this as the
   * `reservoir` refill: `requestsPerSecond` tokens per second.
   */
  requestsPerSecond: number;
  /**
   * Maximum tokens the bucket can hold. Allows short bursts while
   * keeping the average at `requestsPerSecond`.
   */
  burst: number;
  /**
   * User-Agent to send on every request. **Required.** Per
   * `context/legal-and-brand.md`, every external call must identify a
   * contactable owner (e.g. `Binderly/0.1
   * (contact: legal@binderly.app)`). When `BINDERLY_DATA_PIPELINE_UA`
   * is set in the environment the constructor falls back to it.
   */
  userAgent?: string;
  retries?: {
    /** Max retry attempts after the first try. */
    max: number;
    /** Base delay for exponential backoff, in ms. */
    baseDelayMs: number;
    /** Multiplicative factor: `baseDelay * factor^attempt`. */
    factor: number;
  };
  /** Per-request timeout, ms. Aborts via AbortController. */
  timeout?: number;
  /** Pino-compatible logger. Defaults to a noop. */
  logger?: AdapterLogger;
  /**
   * Override `globalThis.fetch`. Tests inject a mock implementation
   * (undici MockAgent's `fetch`, msw's handler, etc.).
   *
   * Signature is the standard Fetch API; the client only relies on
   * `Response.status`, `Response.headers.get`, `Response.text`, and
   * `Response.json`.
   */
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Optional override for the timer used in backoff sleeps. Tests
   * pass `vi.useFakeTimers()`-friendly impls; default is
   * `setTimeout`.
   */
  sleep?: (ms: number) => Promise<void>;
}

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const DEFAULT_RETRIES = { max: 4, baseDelayMs: 500, factor: 2 } as const;

export class RateLimitedClient {
  readonly host: string;
  readonly userAgent: string;
  private readonly limiter: Bottleneck;
  private readonly retries: { max: number; baseDelayMs: number; factor: number };
  private readonly timeout: number;
  private readonly logger: AdapterLogger;
  private readonly fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: RateLimitedClientConfig) {
    if (config.requestsPerSecond <= 0) {
      throw new Error('RateLimitedClient: requestsPerSecond must be > 0');
    }
    if (config.burst <= 0) {
      throw new Error('RateLimitedClient: burst must be > 0');
    }
    const ua = config.userAgent ?? process.env['BINDERLY_DATA_PIPELINE_UA'];
    if (!ua) {
      throw new Error(
        'RateLimitedClient: userAgent is required (pass `userAgent` or set BINDERLY_DATA_PIPELINE_UA)',
      );
    }
    this.host = config.host;
    this.userAgent = ua;
    this.retries = { ...DEFAULT_RETRIES, ...(config.retries ?? {}) };
    this.timeout = config.timeout ?? 15_000;
    this.logger = config.logger ?? NOOP_LOGGER;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    // Token bucket: reservoir starts full at `burst`, refills at
    // `requestsPerSecond` per second. `minTime` ensures we don't fire
    // two requests in the same tick when the reservoir is full.
    this.limiter = new Bottleneck({
      reservoir: config.burst,
      reservoirRefreshAmount: Math.max(1, Math.floor(config.requestsPerSecond)),
      reservoirRefreshInterval: 1000,
      maxConcurrent: 1,
      minTime: Math.floor(1000 / config.requestsPerSecond),
    });
  }

  /**
   * Issue a GET-style request to a path on the configured host. Path
   * may be a fully-qualified URL — the client validates the host
   * matches and rejects mismatches (defense against accidental
   * cross-host calls leaking past the limiter).
   */
  request(path: string, init?: RequestInit): Promise<Response> {
    return this.limiter.schedule(() => this.executeWithRetries(path, init));
  }

  /**
   * Convenience wrapper that calls `request` and parses JSON. Throws
   * `PermanentError` if the response body isn't valid JSON.
   */
  async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    try {
      return (await res.json()) as T;
    } catch (cause) {
      throw new PermanentError(`RateLimitedClient: response body is not valid JSON`, {
        source: this.host,
        target: path,
        cause,
      });
    }
  }

  /** Stop accepting new work and drain. Tests call this for cleanup. */
  async stop(): Promise<void> {
    await this.limiter.stop({ dropWaitingJobs: true });
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  private async executeWithRetries(path: string, init?: RequestInit): Promise<Response> {
    const url = this.resolveUrl(path);
    const headers = this.buildHeaders(init?.headers);
    let attempt = 0;
    // The loop is bounded by `retries.max + 1` total attempts.

    while (true) {
      attempt += 1;
      const start = Date.now();
      try {
        const res = await this.callWithTimeout(url, {
          ...init,
          headers,
          method: init?.method ?? 'GET',
        });
        const elapsedMs = Date.now() - start;
        // 2xx success: log and return.
        if (res.status >= 200 && res.status < 300) {
          this.logger.info(
            { host: this.host, url, attempt, status: res.status, elapsedMs },
            'rate-limited-client.success',
          );
          return res;
        }
        // 404: special path — surface as NotFoundError so adapters can
        // distinguish "no data for this entity" from "transient
        // outage".
        if (res.status === 404) {
          this.logger.warn(
            { host: this.host, url, attempt, status: res.status, elapsedMs },
            'rate-limited-client.not_found',
          );
          throw new NotFoundError(`HTTP 404 from ${this.host}`, {
            source: this.host,
            target: url,
          });
        }
        // 429 rate limit: honor Retry-After, retry up to budget.
        if (res.status === 429) {
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          this.logger.warn(
            {
              host: this.host,
              url,
              attempt,
              status: res.status,
              retryAfterMs,
              elapsedMs,
            },
            'rate-limited-client.rate_limited',
          );
          if (attempt > this.retries.max) {
            throw new RateLimitError(`HTTP 429 from ${this.host} (retries exhausted)`, {
              source: this.host,
              target: url,
              retryAfterMs: retryAfterMs ?? undefined,
            });
          }
          await this.sleep(retryAfterMs ?? this.backoffMs(attempt));
          continue;
        }
        // 503 with Retry-After: same shape as 429 but record as
        // transient. Other 5xx: exponential backoff.
        if (res.status >= 500 && res.status < 600) {
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          const sleepMs = retryAfterMs ?? this.backoffMs(attempt);
          this.logger.warn(
            { host: this.host, url, attempt, status: res.status, sleepMs, elapsedMs },
            'rate-limited-client.transient',
          );
          if (attempt > this.retries.max) {
            throw new TransientError(`HTTP ${res.status} from ${this.host} (retries exhausted)`, {
              source: this.host,
              target: url,
              statusCode: res.status,
              attempt,
            });
          }
          await this.sleep(sleepMs);
          continue;
        }
        // Other 4xx: permanent. Do not retry.
        this.logger.error(
          { host: this.host, url, attempt, status: res.status, elapsedMs },
          'rate-limited-client.permanent',
        );
        throw new PermanentError(`HTTP ${res.status} from ${this.host}`, {
          source: this.host,
          target: url,
          statusCode: res.status,
        });
      } catch (err) {
        // Re-throw typed errors as-is.
        if (
          err instanceof RateLimitError ||
          err instanceof PermanentError ||
          err instanceof NotFoundError
        ) {
          throw err;
        }
        // Network-level / abort errors: classify as transient if we
        // still have retry budget, else surface as TransientError.
        if (err instanceof TransientError) {
          // already classified — bubble after retry-budget check
          if (attempt > this.retries.max) throw err;
        } else {
          this.logger.warn(
            { host: this.host, url, attempt, err: errToObj(err) },
            'rate-limited-client.network_error',
          );
          if (attempt > this.retries.max) {
            throw new TransientError(`Network error talking to ${this.host}`, {
              source: this.host,
              target: url,
              attempt,
              cause: err,
            });
          }
        }
        await this.sleep(this.backoffMs(attempt));
        continue;
      }
    }
  }

  private async callWithTimeout(url: string, init: RequestInit): Promise<Response> {
    if (this.timeout <= 0) {
      return this.fetchImpl(url, init);
    }
    const controller = new AbortController();
    // Compose with the caller's signal if any.
    const callerSignal = init.signal;
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), {
          once: true,
        });
      }
    }
    const timer = setTimeout(() => controller.abort(new Error('request timeout')), this.timeout);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(input: RequestInit['headers']): Headers {
    const h = new Headers(input);
    h.set('User-Agent', this.userAgent);
    if (!h.has('Accept')) h.set('Accept', 'application/json, */*;q=0.1');
    return h;
  }

  private resolveUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      const u = new URL(path);
      if (u.host !== this.host) {
        throw new Error(
          `RateLimitedClient: refusing cross-host call (expected ${this.host}, got ${u.host}). ` +
            `Adapters must construct one client per host.`,
        );
      }
      return path;
    }
    const leading = path.startsWith('/') ? path : `/${path}`;
    return `https://${this.host}${leading}`;
  }

  private backoffMs(attempt: number): number {
    // attempt is 1-indexed. The first retry waits `baseDelayMs`,
    // the second waits `baseDelayMs * factor`, and so on.
    const exp = Math.max(0, attempt - 1);
    return Math.floor(this.retries.baseDelayMs * this.retries.factor ** exp);
  }
}

/**
 * Parse a `Retry-After` header per RFC 7231 §7.1.3: either a
 * non-negative integer number of seconds, or an HTTP-date.
 *
 * Returns the delay in milliseconds, or `null` when the header is
 * missing / unparseable. Caller decides what to do with `null`
 * (typical: fall back to the configured exponential backoff).
 */
export function parseRetryAfter(value: string | null): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // delta-seconds: a non-negative decimal integer.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return seconds * 1000;
  }
  // HTTP-date: parse, take delta from now.
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) return null;
  const deltaMs = ts - Date.now();
  return deltaMs > 0 ? deltaMs : 0;
}

function errToObj(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { value: String(err) };
}
