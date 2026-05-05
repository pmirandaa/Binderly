// Unit tests for the typed error taxonomy + the
// `errorFromResponse` mapper.

import { describe, expect, it } from 'vitest';

import {
  ApiAuthError,
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiResponseDecodeError,
  ApiServerError,
  ApiUnauthorizedError,
  ApiValidationError,
  errorFromResponse,
  readErrorEnvelope,
} from './error.js';

describe('ApiError base class', () => {
  it('captures code, status, message, details, requestId', () => {
    const error = new ApiError('VALIDATION', 'bad input', {
      status: 400,
      details: [{ field: 'email' }],
      requestId: 'req-123',
    });
    expect(error.code).toBe('VALIDATION');
    expect(error.status).toBe(400);
    expect(error.details).toEqual([{ field: 'email' }]);
    expect(error.requestId).toBe('req-123');
    expect(error.message).toBe('bad input');
  });

  it('preserves the cause when supplied (ES2022 Error.cause)', () => {
    const cause = new Error('upstream');
    const error = new ApiError('INTERNAL', 'wrapped', { cause });
    expect(error.cause).toBe(cause);
  });

  it('toJSON() omits undefined optional fields', () => {
    const error = new ApiError('UNKNOWN', 'plain');
    expect(error.toJSON()).toEqual({
      name: 'ApiError',
      code: 'UNKNOWN',
      message: 'plain',
    });
  });

  it('toJSON() includes the optional fields when present', () => {
    const error = new ApiError('VALIDATION', 'bad', {
      status: 400,
      requestId: 'req-1',
      details: { foo: 'bar' },
    });
    expect(error.toJSON()).toEqual({
      name: 'ApiError',
      code: 'VALIDATION',
      message: 'bad',
      status: 400,
      details: { foo: 'bar' },
      requestId: 'req-1',
    });
  });
});

describe('ApiError subclass instanceof chain', () => {
  it('every subclass is an instanceof ApiError', () => {
    expect(new ApiValidationError('') instanceof ApiError).toBe(true);
    expect(new ApiUnauthorizedError('') instanceof ApiError).toBe(true);
    expect(new ApiForbiddenError('') instanceof ApiError).toBe(true);
    expect(new ApiNotFoundError('') instanceof ApiError).toBe(true);
    expect(new ApiConflictError('') instanceof ApiError).toBe(true);
    expect(new ApiRateLimitError('') instanceof ApiError).toBe(true);
    expect(new ApiServerError('') instanceof ApiError).toBe(true);
    expect(new ApiNetworkError('') instanceof ApiError).toBe(true);
    expect(new ApiAuthError('') instanceof ApiError).toBe(true);
    expect(new ApiResponseDecodeError('', { rawBody: null }) instanceof ApiError).toBe(true);
  });

  it('subclasses set their own `name`', () => {
    expect(new ApiValidationError('').name).toBe('ApiValidationError');
    expect(new ApiUnauthorizedError('').name).toBe('ApiUnauthorizedError');
    expect(new ApiForbiddenError('').name).toBe('ApiForbiddenError');
    expect(new ApiNotFoundError('').name).toBe('ApiNotFoundError');
    expect(new ApiConflictError('').name).toBe('ApiConflictError');
    expect(new ApiRateLimitError('').name).toBe('ApiRateLimitError');
    expect(new ApiServerError('').name).toBe('ApiServerError');
    expect(new ApiNetworkError('').name).toBe('ApiNetworkError');
    expect(new ApiAuthError('').name).toBe('ApiAuthError');
    expect(new ApiResponseDecodeError('', { rawBody: null }).name).toBe('ApiResponseDecodeError');
  });
});

describe('ApiValidationError', () => {
  it('exposes zodIssues when provided', () => {
    const error = new ApiValidationError('bad', {
      zodIssues: [{ code: 'custom', path: ['email'], message: 'invalid email' } as never],
    });
    expect(error.zodIssues).toHaveLength(1);
    expect(error.zodIssues?.[0]?.path).toEqual(['email']);
  });

  it('omits zodIssues when not provided', () => {
    const error = new ApiValidationError('bad');
    expect(error.zodIssues).toBeUndefined();
  });
});

describe('ApiRateLimitError', () => {
  it('exposes retryAfterSeconds when provided', () => {
    const error = new ApiRateLimitError('slow down', { retryAfterSeconds: 60 });
    expect(error.retryAfterSeconds).toBe(60);
  });

  it('omits retryAfterSeconds when not provided', () => {
    const error = new ApiRateLimitError('slow down');
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});

describe('ApiResponseDecodeError', () => {
  it('exposes rawBody verbatim', () => {
    const body = { unexpected: 'shape' };
    const error = new ApiResponseDecodeError('bad shape', { rawBody: body });
    expect(error.rawBody).toBe(body);
  });
});

describe('readErrorEnvelope', () => {
  it('parses a bare apiErrorSchema-shaped object', () => {
    const result = readErrorEnvelope({ code: 'VALIDATION', message: 'bad' });
    expect(result?.code).toBe('VALIDATION');
    expect(result?.message).toBe('bad');
  });

  it('parses the wrapped { ok: false, error: ... } envelope', () => {
    const result = readErrorEnvelope({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'no row' },
    });
    expect(result?.code).toBe('NOT_FOUND');
  });

  it('returns undefined for the success envelope shape', () => {
    expect(readErrorEnvelope({ ok: true, data: { id: 1 } })).toBeUndefined();
  });

  it('returns undefined for malformed input (HTML body, plain string, null)', () => {
    expect(readErrorEnvelope('<html>500 internal</html>')).toBeUndefined();
    expect(readErrorEnvelope(null)).toBeUndefined();
    expect(readErrorEnvelope({ random: 'shape' })).toBeUndefined();
  });
});

describe('errorFromResponse — status-code mapping (no envelope)', () => {
  it('400 → ApiValidationError', () => {
    const error = errorFromResponse({ status: 400, body: undefined });
    expect(error).toBeInstanceOf(ApiValidationError);
    expect(error.status).toBe(400);
  });

  it('401 → ApiUnauthorizedError', () => {
    const error = errorFromResponse({ status: 401, body: undefined });
    expect(error).toBeInstanceOf(ApiUnauthorizedError);
  });

  it('403 → ApiForbiddenError', () => {
    const error = errorFromResponse({ status: 403, body: undefined });
    expect(error).toBeInstanceOf(ApiForbiddenError);
  });

  it('404 → ApiNotFoundError', () => {
    const error = errorFromResponse({ status: 404, body: undefined });
    expect(error).toBeInstanceOf(ApiNotFoundError);
  });

  it('409 → ApiConflictError', () => {
    const error = errorFromResponse({ status: 409, body: undefined });
    expect(error).toBeInstanceOf(ApiConflictError);
  });

  it('429 → ApiRateLimitError', () => {
    const error = errorFromResponse({ status: 429, body: undefined });
    expect(error).toBeInstanceOf(ApiRateLimitError);
  });

  it('500 → ApiServerError', () => {
    const error = errorFromResponse({ status: 500, body: undefined });
    expect(error).toBeInstanceOf(ApiServerError);
  });

  it('502 → ApiServerError', () => {
    const error = errorFromResponse({ status: 502, body: undefined });
    expect(error).toBeInstanceOf(ApiServerError);
  });

  it('418 (no canonical mapping) → generic ApiError', () => {
    const error = errorFromResponse({ status: 418, body: undefined });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(ApiServerError);
    expect(error).not.toBeInstanceOf(ApiUnauthorizedError);
    expect(error.code).toBe('UNKNOWN');
  });
});

describe('errorFromResponse — envelope code overrides status mapping', () => {
  it('envelope code "VALIDATION" wins even on a 200', () => {
    const error = errorFromResponse({
      status: 200,
      body: { ok: false, error: { code: 'VALIDATION', message: 'bad' } },
    });
    expect(error).toBeInstanceOf(ApiValidationError);
  });

  it('envelope code "NOT_FOUND" with status 200 → ApiNotFoundError', () => {
    const error = errorFromResponse({
      status: 200,
      body: { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } },
    });
    expect(error).toBeInstanceOf(ApiNotFoundError);
  });

  it('envelope code "CONFLICT" → ApiConflictError', () => {
    const error = errorFromResponse({
      status: 409,
      body: { ok: false, error: { code: 'CONFLICT', message: 'dup' } },
    });
    expect(error).toBeInstanceOf(ApiConflictError);
  });

  it('envelope code "RATE_LIMIT" → ApiRateLimitError', () => {
    const error = errorFromResponse({
      status: 429,
      body: { ok: false, error: { code: 'RATE_LIMIT', message: 'slow' } },
    });
    expect(error).toBeInstanceOf(ApiRateLimitError);
  });

  it('envelope code "INTERNAL" → ApiServerError', () => {
    const error = errorFromResponse({
      status: 500,
      body: { ok: false, error: { code: 'INTERNAL', message: 'oops' } },
    });
    expect(error).toBeInstanceOf(ApiServerError);
  });

  it('envelope code "AUTH" → ApiUnauthorizedError (canonical fallback)', () => {
    const error = errorFromResponse({
      status: 401,
      body: { ok: false, error: { code: 'AUTH', message: 'no token' } },
    });
    expect(error).toBeInstanceOf(ApiUnauthorizedError);
  });
});

describe('errorFromResponse — message + details propagation', () => {
  it('prefers the envelope message over the default for the status code', () => {
    const error = errorFromResponse({
      status: 400,
      body: { ok: false, error: { code: 'VALIDATION', message: 'specific message' } },
    });
    expect(error.message).toBe('specific message');
  });

  it('uses a default message when the envelope is absent', () => {
    const error = errorFromResponse({ status: 401, body: undefined });
    expect(error.message).toMatch(/Unauthorized/);
  });

  it('propagates the envelope details', () => {
    const error = errorFromResponse({
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'bad input',
          details: [{ path: 'email', issue: 'invalid' }],
        },
      },
    });
    expect(error.details).toEqual([{ path: 'email', issue: 'invalid' }]);
  });

  it('propagates the requestId when supplied', () => {
    const error = errorFromResponse({ status: 500, body: undefined, requestId: 'req-xyz' });
    expect(error.requestId).toBe('req-xyz');
  });
});

describe('Error throw + catch ergonomics', () => {
  it('a thrown subclass can be caught by ApiError', () => {
    expect.assertions(2);
    try {
      throw new ApiNotFoundError('gone');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('NOT_FOUND');
    }
  });

  it('ApiNetworkError carries the original cause', () => {
    const cause = new Error('ECONNRESET');
    const error = new ApiNetworkError('connection died', { cause });
    expect(error.cause).toBe(cause);
    expect(error.code).toBe('NETWORK');
    expect(error.status).toBeUndefined();
  });
});
