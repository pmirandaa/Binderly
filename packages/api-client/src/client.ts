// Core HTTP client for `@binderly/api-client`.
//
// Resource modules (`cards`, `collection`, `pricing`, ...) build
// on top of this — they construct paths + write/read schemas and
// hand the rest to {@link HttpClient.request}.
//
// Design notes:
//   - No `node-fetch` import. The package targets browsers, RN,
//     edge runtimes, and Node ≥ 18 — all of which ship the WHATWG
//     `fetch` global. Tests inject a stub via the `fetch` constructor
//     option.
//   - JWT acquisition is a callback (`getJwt: () => Promise<string |
//     null> | string | null`). Pull, not push: each request resolves
//     the freshest token at call time so callers don't have to wire
//     a token-changed listener. Returning `null` skips the
//     `Authorization` header (anonymous request).
//   - The `apikey` header is **always** sent (even on anonymous
//     calls) because Supabase PostgREST + Edge Functions both
//     require it.
//   - Response shape: every successful response is the
//     `apiResultSchema(<dto>)` envelope from `@binderly/api-contracts`.
//     We unwrap on success, throw a typed `ApiError` on failure.
//   - 204 responses return `undefined`. DELETE methods skip parsing.

import { apiResultSchema } from '@binderly/api-contracts';

import { ApiError, ApiNetworkError, ApiResponseDecodeError, errorFromResponse } from './error.js';

import type { z } from 'zod';

// ============================================================
// Public types
// ============================================================

/**
 * The minimal `fetch` type we use. `globalThis.fetch` satisfies
 * this; tests pass a `vi.fn()` shaped the same way. Declared
 * locally so we don't depend on `lib.dom` (the package targets
 * non-browser runtimes too).
 */
export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/**
 * The minimal subset of the WHATWG `Response` we touch.
 */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: {
    readonly get: (name: string) => string | null;
  };
  text(): Promise<string>;
}

/**
 * Resolves the current JWT for the request. Returns `null` to
 * make an anonymous request. May be sync or async — both shapes
 * are awaited.
 */
export type JwtProvider = () => Promise<string | null> | string | null;

/**
 * Options accepted by {@link HttpClient.request}. Everything
 * except `path` is optional; sensible defaults match the
 * Supabase / Edge-Function pattern.
 */
export interface RequestOptions {
  readonly path: string;
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON-encoded body; if undefined, no body / no `content-type` header. */
  readonly body?: unknown;
  /** Query params; values are stringified. `undefined` values are skipped. */
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  /** Per-request header overrides (merged on top of the defaults). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /**
   * Skip JWT acquisition. Used for explicitly-anonymous endpoints
   * (e.g. public shareable read) so the auth callback isn't
   * invoked at all.
   */
  readonly anonymous?: boolean;
}

/**
 * Constructor options for {@link HttpClient}. Mirrors the
 * `CreateClientConfig` accepted by `createClient` in
 * `index.ts`; consumers normally use `createClient` rather than
 * instantiating `HttpClient` directly.
 */
export interface HttpClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly getJwt: JwtProvider;
  readonly fetch?: FetchLike;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

// ============================================================
// HttpClient
// ============================================================

/**
 * Core HTTP wrapper. Resource modules build on top of this and
 * supply only `path`, `method`, `body`, `query`, and an inbound
 * data schema.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly getJwt: JwtProvider;
  private readonly fetchImpl: FetchLike;
  private readonly defaultHeaders: Readonly<Record<string, string>>;

  public constructor(config: HttpClientConfig) {
    this.baseUrl = stripTrailingSlash(config.baseUrl);
    this.apiKey = config.apiKey;
    this.getJwt = config.getJwt;
    this.fetchImpl = config.fetch ?? resolveGlobalFetch();
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  /**
   * Round-trip a request and decode the result via the api-contracts
   * envelope (`{ ok: true, data: <dataSchema> } | { ok: false, error }`).
   *
   * The generic parameter is inferred from `dataSchema`; on success
   * the typed `data` is returned. On `{ ok: false }` an
   * {@link ApiError} subclass is thrown.
   */
  public async request<TSchema extends z.ZodTypeAny>(
    options: RequestOptions,
    dataSchema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const response = await this.send(options);
    const requestId = response.headers.get('x-request-id') ?? undefined;

    if (response.status === 204) {
      // No content — caller asked for typed data but the server has
      // nothing to return. This is a contract violation; resource
      // methods that legitimately expect 204 use `requestVoid` below.
      throw new ApiError(
        'INTERNAL',
        'Server returned 204 No Content but caller requested a typed body.',
        {
          status: 204,
          ...(requestId !== undefined ? { requestId } : {}),
        },
      );
    }

    const rawText = await response.text();
    const rawBody = parseJsonOrUndefined(rawText);

    if (!response.ok) {
      throw errorFromResponse({
        status: response.status,
        body: rawBody,
        ...(requestId !== undefined ? { requestId } : {}),
      });
    }

    const envelopeSchema = apiResultSchema(dataSchema);
    const envelopeParse = envelopeSchema.safeParse(rawBody);
    if (!envelopeParse.success) {
      throw new ApiResponseDecodeError(
        'Response body did not match the apiResult envelope shape.',
        {
          status: response.status,
          rawBody,
          zodError: envelopeParse.error,
          ...(requestId !== undefined ? { requestId } : {}),
        },
      );
    }

    // The factory's return type is a discriminated union but the
    // generic-heavy inference confuses TS' narrowing here. Cast to
    // the canonical envelope shape — runtime correctness is
    // guaranteed by the just-completed schema parse.
    const envelope = envelopeParse.data as
      | { ok: true; data: z.infer<TSchema> }
      | { ok: false; error: { code: string; message: string; details?: unknown } };
    if (envelope.ok === false) {
      throw errorFromResponse({
        status: response.status,
        body: { ok: false, error: envelope.error },
        ...(requestId !== undefined ? { requestId } : {}),
      });
    }
    return envelope.data;
  }

  /**
   * Like {@link request}, but for endpoints that return 204 No
   * Content (most DELETEs). Resolves to `void` on success; throws
   * {@link ApiError} on failure.
   */
  public async requestVoid(options: RequestOptions): Promise<void> {
    const response = await this.send(options);
    const requestId = response.headers.get('x-request-id') ?? undefined;

    if (response.status === 204) return;
    const rawText = await response.text();
    const rawBody = parseJsonOrUndefined(rawText);

    if (!response.ok) {
      throw errorFromResponse({
        status: response.status,
        body: rawBody,
        ...(requestId !== undefined ? { requestId } : {}),
      });
    }
    // 2xx but not 204 — the server returned a body where it shouldn't.
    // Some Edge Function implementations might return 200 with
    // `{ ok: true, data: null }`; tolerate that so resource methods
    // can use `requestVoid` for either 200-with-null-data or 204.
    // Anything else is a contract violation.
    if (rawBody === undefined) return;
    if (
      typeof rawBody === 'object' &&
      rawBody !== null &&
      'ok' in rawBody &&
      (rawBody as { ok?: unknown }).ok === true
    ) {
      return;
    }
    throw new ApiResponseDecodeError(
      'Server returned a non-empty, non-envelope body for a void endpoint.',
      {
        status: response.status,
        rawBody,
        ...(requestId !== undefined ? { requestId } : {}),
      },
    );
  }

  /**
   * Internal — build headers, resolve URL, dispatch fetch, and
   * translate fetch rejects into {@link ApiNetworkError}.
   */
  private async send(options: RequestOptions): Promise<FetchResponseLike> {
    const method = options.method ?? 'GET';
    const url = buildUrl(this.baseUrl, options.path, options.query);
    const headers = await this.buildHeaders(options);
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      // `fetch` rejects on DNS / TLS / connection errors and on
      // AbortSignal trigger. We surface every reject as a
      // network error so callers branch with one `instanceof`.
      const message = cause instanceof Error ? cause.message : 'Network request failed.';
      throw new ApiNetworkError(message, { cause });
    }
  }

  private async buildHeaders(options: RequestOptions): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      apikey: this.apiKey,
      accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.anonymous !== true) {
      const token = await this.getJwt();
      if (typeof token === 'string' && token.length > 0) {
        headers['authorization'] = `Bearer ${token}`;
      }
    }
    if (options.headers !== undefined) {
      Object.assign(headers, options.headers);
    }
    return headers;
  }
}

// ============================================================
// Helpers
// ============================================================

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const queryString = query !== undefined ? buildQueryString(query) : '';
  return `${baseUrl}${normalisedPath}${queryString}`;
}

function buildQueryString(query: NonNullable<RequestOptions['query']>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function parseJsonOrUndefined(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON body (e.g. a 502 Bad Gateway HTML page). Surface as
    // the raw text so the error path can still inspect it.
    return text;
  }
}

function resolveGlobalFetch(): FetchLike {
  const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof globalFetch !== 'function') {
    throw new Error(
      '@binderly/api-client: globalThis.fetch is not available. ' +
        'Either run on a runtime that ships fetch (Node >= 18, browsers, ' +
        'React Native, Edge) or pass a `fetch` override to createClient.',
    );
  }
  return globalFetch;
}
