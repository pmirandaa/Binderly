// Typed error taxonomy for `@binderly/api-client`.
//
// Every failure path the client surfaces — outbound validation,
// network reject, non-2xx response, response decode — throws an
// {@link ApiError} subclass. Consumers can branch by `instanceof`
// or by the stable `code` field. The taxonomy mirrors
// `context/conventions.md` § "Error handling" and the
// `apiErrorSchema` envelope from `@binderly/api-contracts`, with
// extra subclasses for the transport-level failures (network,
// decode) the contracts package can't describe.
//
// The mapping rules:
//
//   1. fetch() reject                           → ApiNetworkError
//   2. status === 400 OR envelope code 'VALIDATION'
//                                               → ApiValidationError
//   3. status === 401                           → ApiUnauthorizedError
//   4. status === 403                           → ApiForbiddenError
//   5. status === 404 OR envelope code 'NOT_FOUND'
//                                               → ApiNotFoundError
//   6. status === 409 OR envelope code 'CONFLICT'
//                                               → ApiConflictError
//   7. status === 429 OR envelope code 'RATE_LIMIT'
//                                               → ApiRateLimitError
//   8. status >= 500 OR envelope code 'INTERNAL'
//                                               → ApiServerError
//   9. zod parse fails on a 2xx response        → ApiResponseDecodeError
//  10. Supabase auth SDK rejects                → ApiAuthError
//  11. fallthrough                              → ApiError (generic)

import { apiErrorSchema, type ApiError as ApiErrorPayload } from '@binderly/api-contracts';

import type { z } from 'zod';

/**
 * Stable error codes the api-client surfaces. Mirrors the
 * `apiErrorSchema` codes from `@binderly/api-contracts` plus
 * three transport-layer extras (`NETWORK`, `DECODE`, `UNKNOWN`)
 * that are not part of the wire contract.
 */
export type ApiErrorCode =
  | 'VALIDATION'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'INTERNAL'
  | 'NETWORK'
  | 'DECODE'
  | 'UNKNOWN';

/**
 * Optional context attached to an error: HTTP status (when the
 * failure was wire-level), free-form details from the server
 * (typically a list of zod issues for `'VALIDATION'`), the
 * request id from the response header for tracing, and the
 * original cause for chained errors.
 */
export interface ApiErrorOptions {
  readonly status?: number;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly cause?: unknown;
}

/**
 * Base class for every error this package throws. Consumers
 * normally branch on `error instanceof ApiError` to "is this an
 * api-client failure" and on `error.code` or a more specific
 * subclass for the actual category.
 */
export class ApiError extends Error {
  public override readonly name: string = 'ApiError';
  public readonly code: ApiErrorCode;
  public readonly status?: number;
  public readonly details?: unknown;
  public readonly requestId?: string;

  public constructor(code: ApiErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.details !== undefined) this.details = options.details;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }

  /**
   * Serializable shape — handy for logging / sending across a
   * worker boundary. The original `cause` is intentionally NOT
   * serialised (it may contain unbounded structured data).
   */
  public toJSON(): {
    name: string;
    code: ApiErrorCode;
    message: string;
    status?: number;
    details?: unknown;
    requestId?: string;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.requestId !== undefined ? { requestId: this.requestId } : {}),
    };
  }
}

/**
 * The caller passed an invalid request body, OR the server
 * rejected the request body with a `'VALIDATION'` envelope code,
 * OR the wire returned a 400 status. Carries the zod issues when
 * the failure was caught client-side.
 */
export class ApiValidationError extends ApiError {
  public override readonly name = 'ApiValidationError';
  public readonly zodIssues?: z.ZodIssue[];

  public constructor(
    message: string,
    options: ApiErrorOptions & { readonly zodIssues?: z.ZodIssue[] } = {},
  ) {
    super('VALIDATION', message, options);
    if (options.zodIssues !== undefined) this.zodIssues = options.zodIssues;
  }
}

/**
 * The request was rejected as unauthenticated (HTTP 401).
 * Typically the JWT is missing, expired, or malformed — refresh
 * and retry.
 */
export class ApiUnauthorizedError extends ApiError {
  public override readonly name = 'ApiUnauthorizedError';

  public constructor(message: string, options: ApiErrorOptions = {}) {
    super('AUTH', message, options);
  }
}

/**
 * The request was authenticated but the user is not allowed to
 * perform the operation (HTTP 403). Typically a freemium gate
 * (e.g. free user creating a 4th custom collection) or an RLS
 * policy denial.
 */
export class ApiForbiddenError extends ApiError {
  public override readonly name = 'ApiForbiddenError';

  public constructor(message: string, options: ApiErrorOptions = {}) {
    super('AUTH', message, options);
  }
}

/**
 * The requested resource does not exist (HTTP 404 OR envelope
 * code `'NOT_FOUND'`). Distinct from 401/403 — a 404 means the
 * request was understood, the row just isn't there.
 */
export class ApiNotFoundError extends ApiError {
  public override readonly name = 'ApiNotFoundError';

  public constructor(message: string, options: ApiErrorOptions = {}) {
    super('NOT_FOUND', message, options);
  }
}

/**
 * The request conflicts with current server state (HTTP 409 OR
 * envelope code `'CONFLICT'`). Examples: adding a printing to a
 * custom collection it's already in; claiming a `handle` that's
 * already taken.
 */
export class ApiConflictError extends ApiError {
  public override readonly name = 'ApiConflictError';

  public constructor(message: string, options: ApiErrorOptions = {}) {
    super('CONFLICT', message, options);
  }
}

/**
 * Rate-limited (HTTP 429 OR envelope code `'RATE_LIMIT'`). When
 * the upstream sent a `Retry-After` header, the seconds value is
 * exposed via `retryAfterSeconds` so callers can back off
 * deterministically.
 */
export class ApiRateLimitError extends ApiError {
  public override readonly name = 'ApiRateLimitError';
  public readonly retryAfterSeconds?: number;

  public constructor(
    message: string,
    options: ApiErrorOptions & { readonly retryAfterSeconds?: number } = {},
  ) {
    super('RATE_LIMIT', message, options);
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

/**
 * Backend failure (HTTP 5xx OR envelope code `'INTERNAL'`).
 * Always safe to retry once on this; if it persists, escalate
 * to monitoring.
 */
export class ApiServerError extends ApiError {
  public override readonly name = 'ApiServerError';

  public constructor(message: string, options: ApiErrorOptions = {}) {
    super('INTERNAL', message, options);
  }
}

/**
 * Transport failed before getting a response (DNS error, TLS
 * handshake failure, connection reset, AbortSignal triggered).
 * `status` is `undefined` because we never got one. The original
 * fetch reject is in `cause`.
 */
export class ApiNetworkError extends ApiError {
  public override readonly name = 'ApiNetworkError';

  public constructor(message: string, options: ApiErrorOptions = {}) {
    super('NETWORK', message, options);
  }
}

/**
 * The wire returned 2xx but the response body did not parse
 * against the expected schema. This catches **backend drift** —
 * the contract said one shape, the server emitted another.
 * Carries the raw body and (when available) the zod error so the
 * caller can log a useful diff. `zodError` is optional because a
 * few decode failures (non-JSON body, contract violation that
 * doesn't run a schema) have nothing to attach.
 */
export class ApiResponseDecodeError extends ApiError {
  public override readonly name = 'ApiResponseDecodeError';
  public readonly rawBody: unknown;
  public readonly zodError?: z.ZodError;

  public constructor(
    message: string,
    options: ApiErrorOptions & {
      readonly rawBody: unknown;
      readonly zodError?: z.ZodError;
    },
  ) {
    super('DECODE', message, options);
    this.rawBody = options.rawBody;
    if (options.zodError !== undefined) this.zodError = options.zodError;
  }
}

/**
 * The Supabase Auth SDK reported an interactive-flow failure
 * (sign-in, sign-out, code exchange, etc.). Distinct from the
 * HTTP-level 401/403 because it represents an SDK error, not a
 * request the client made directly.
 */
export class ApiAuthError extends ApiError {
  public override readonly name = 'ApiAuthError';

  public constructor(message: string, options: ApiErrorOptions = {}) {
    super('AUTH', message, options);
  }
}

// ============================================================
// Error-mapping helpers
// ============================================================

/**
 * Convert a non-2xx HTTP response into the appropriate
 * {@link ApiError} subclass. Tries to parse the body as the
 * `apiErrorSchema` envelope first (so server-provided messages,
 * codes, and details surface verbatim); falls back to the bare
 * status code when the body isn't a parsable envelope.
 */
export function errorFromResponse(input: {
  readonly status: number;
  readonly body: unknown;
  readonly requestId?: string;
}): ApiError {
  const { status, body, requestId } = input;
  const envelope = readErrorEnvelope(body);
  const message = envelope?.message ?? defaultMessageForStatus(status);
  const details = envelope?.details;
  const baseOptions: ApiErrorOptions = {
    status,
    ...(details !== undefined ? { details } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };

  // Envelope code wins when present; status code is the fallback.
  const envelopeCode = envelope?.code;
  if (envelopeCode === 'VALIDATION' || status === 400) {
    return new ApiValidationError(message, baseOptions);
  }
  if (status === 401) {
    return new ApiUnauthorizedError(message, baseOptions);
  }
  if (status === 403) {
    return new ApiForbiddenError(message, baseOptions);
  }
  if (envelopeCode === 'NOT_FOUND' || status === 404) {
    return new ApiNotFoundError(message, baseOptions);
  }
  if (envelopeCode === 'CONFLICT' || status === 409) {
    return new ApiConflictError(message, baseOptions);
  }
  if (envelopeCode === 'RATE_LIMIT' || status === 429) {
    return new ApiRateLimitError(message, baseOptions);
  }
  if (envelopeCode === 'INTERNAL' || status >= 500) {
    return new ApiServerError(message, baseOptions);
  }
  if (envelopeCode === 'AUTH') {
    // No specific status code in [401, 403] — fall back to the
    // unauthorized subclass (more common than forbidden).
    return new ApiUnauthorizedError(message, baseOptions);
  }
  return new ApiError('UNKNOWN', message, baseOptions);
}

/**
 * Try to parse a response body as an `apiErrorSchema` envelope.
 * Returns the parsed value or `undefined` if the body is not a
 * valid envelope (which is the common case for server crashes
 * that emit plain HTML 500 pages).
 */
export function readErrorEnvelope(body: unknown): ApiErrorPayload | undefined {
  // Allow either the bare error object or the wrapped
  // `{ ok: false, error: { ... } }` envelope (the api-contracts
  // discriminated union shape).
  if (body && typeof body === 'object' && 'ok' in body) {
    const wrapped = body as { ok?: unknown; error?: unknown };
    if (wrapped.ok === false && wrapped.error !== undefined) {
      const parsed = apiErrorSchema.safeParse(wrapped.error);
      if (parsed.success) return parsed.data;
    }
    return undefined;
  }
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

function defaultMessageForStatus(status: number): string {
  if (status === 400) return 'Bad request.';
  if (status === 401) return 'Unauthorized — JWT missing, expired, or invalid.';
  if (status === 403) return 'Forbidden — you do not have permission to perform this action.';
  if (status === 404) return 'Not found.';
  if (status === 409) return 'Conflict — the request could not be completed in the current state.';
  if (status === 429) return 'Rate limited — please retry later.';
  if (status >= 500) return `Server error (HTTP ${status}).`;
  return `Unexpected response (HTTP ${status}).`;
}
