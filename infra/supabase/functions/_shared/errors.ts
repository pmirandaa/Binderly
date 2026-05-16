// Error envelope helpers — match `@binderly/api-contracts/common.ts`.
//
// The wire shape every Binderly Edge Function returns is the
// discriminated `apiResultSchema` envelope:
//
//   { ok: true, data: <DTO> }
//   | { ok: false, error: { code, message, details? } }
//
// The `code` is one of the canonical strings from
// `api-contracts/common.ts` (`API_ERROR_CODES`). We mirror the enum
// here to keep the Edge Function bundle self-contained — production
// deploys without access to the pnpm workspace, and the contracts
// package is intentionally TypeScript-only (no runtime check at the
// boundary). The mirror is small and stable; any drift is caught by
// the schema-mirror tests in `contracts.test.ts`.
//
// `apiError(...)` and `apiOk(...)` produce `Response` objects, not
// raw bodies — every error path in the dispatcher returns a `Response`,
// so building it inline is easier than threading the envelope through
// the caller.
//
// `x-request-id` is always echoed in the response headers (per
// `request-id.ts`), so the on-call has a breadcrumb regardless of
// whether the error path went through `apiError` or a thrown
// `ApiError`.

import { corsResponseHeaders, type CorsConfig } from './cors.ts';
import { REQUEST_ID_HEADER } from './request-id.ts';

/**
 * Canonical error codes — mirror of
 * `@binderly/api-contracts` `API_ERROR_CODES`. Update both when adding
 * a new code (the mirror test catches drift).
 */
export const API_ERROR_CODES = [
  'VALIDATION',
  'AUTH',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMIT',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Default HTTP status for each error code. Callers can override per
 * call site (e.g. a `CONFLICT` that's actually a 409 with body); this
 * map covers the common case.
 */
export const DEFAULT_STATUS_FOR_CODE: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION: 400,
  AUTH: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  INTERNAL: 500,
};

/**
 * Throwable error type — handlers throw `new ApiError(...)` to short-
 * circuit out of a deep call stack and let the dispatcher serialize
 * the envelope. Carries the same fields the wire format does.
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly details: unknown;

  public constructor(
    code: ApiErrorCode,
    message: string,
    options: { readonly status?: number; readonly details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS_FOR_CODE[code];
    this.details = options.details;
  }
}

/**
 * Error envelope body shape (matches `apiErrorSchema` in
 * `api-contracts/common.ts`). Deliberately *not* `.strict()` here —
 * tests round-trip the body through `JSON.stringify` so unknown keys
 * never leak.
 */
export interface ApiErrorEnvelopeBody {
  readonly ok: false;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

/**
 * Success envelope body shape.
 */
export interface ApiOkEnvelopeBody<T> {
  readonly ok: true;
  readonly data: T;
}

/**
 * Build an error `Response`. The body matches `apiErrorSchema`; the
 * status defaults to `DEFAULT_STATUS_FOR_CODE[code]` but is
 * overridable for cases where the same logical error needs a
 * non-canonical status (e.g. a `NOT_FOUND` returned with 202 for the
 * deferred-recompute stub).
 */
export function apiError(
  request: Request,
  config: CorsConfig,
  requestId: string,
  code: ApiErrorCode,
  message: string,
  options: { readonly status?: number; readonly details?: unknown } = {},
): Response {
  const status = options.status ?? DEFAULT_STATUS_FOR_CODE[code];
  const body: ApiErrorEnvelopeBody = {
    ok: false,
    error: {
      code,
      message,
      ...(options.details !== undefined ? { details: options.details } : {}),
    },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      [REQUEST_ID_HEADER]: requestId,
      ...corsResponseHeaders(request, config),
    },
  });
}

/**
 * Build a success `Response`. The body matches
 * `apiResultSchema(<dataSchema>)` with `ok: true`.
 */
export function apiOk<T>(
  request: Request,
  config: CorsConfig,
  requestId: string,
  data: T,
  options: { readonly status?: number } = {},
): Response {
  const status = options.status ?? 200;
  const body: ApiOkEnvelopeBody<T> = { ok: true, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      [REQUEST_ID_HEADER]: requestId,
      ...corsResponseHeaders(request, config),
    },
  });
}

/**
 * Build an empty 204 response (used by DELETE endpoints). The
 * api-client's `requestVoid` accepts both 204 and `{ ok: true }`; we
 * pick 204 because it's the canonical "operation succeeded, no body
 * to return" REST signal.
 */
export function apiNoContent(request: Request, config: CorsConfig, requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      ...corsResponseHeaders(request, config),
    },
  });
}

/**
 * Translate any thrown value into an `apiError` response. Used by the
 * dispatcher's outermost try/catch so a bug in a handler still
 * surfaces as a typed envelope rather than a raw stack trace.
 *
 * Recognized inputs:
 *
 *   - `ApiError` instances — emitted with their declared code/status/details
 *   - Errors whose `.message` mentions an obvious 4xx signal (rare)
 *     — fall through to `INTERNAL`
 *   - Anything else — `INTERNAL`, message stringified, no details
 *     leaked to the wire (the message is logged separately).
 */
export function errorToResponse(
  request: Request,
  config: CorsConfig,
  requestId: string,
  cause: unknown,
): Response {
  if (cause instanceof ApiError) {
    return apiError(request, config, requestId, cause.code, cause.message, {
      ...(cause.status !== DEFAULT_STATUS_FOR_CODE[cause.code] ? { status: cause.status } : {}),
      ...(cause.details !== undefined ? { details: cause.details } : {}),
    });
  }
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'Unhandled internal error.';
  return apiError(request, config, requestId, 'INTERNAL', message);
}
