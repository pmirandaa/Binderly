import { describe, expect, it } from 'vitest';

import {
  ApiError,
  apiError,
  apiNoContent,
  apiOk,
  API_ERROR_CODES,
  DEFAULT_STATUS_FOR_CODE,
  errorToResponse,
} from './errors.ts';

const cors = { allowOrigins: ['*'] as const };

describe('ApiError', () => {
  it('captures code, message, and default status', () => {
    const err = new ApiError('VALIDATION', 'bad payload');
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('bad payload');
    expect(err.status).toBe(400);
  });

  it('honors a custom status override', () => {
    const err = new ApiError('AUTH', 'forbidden', { status: 403 });
    expect(err.status).toBe(403);
  });

  it('carries optional details', () => {
    const err = new ApiError('VALIDATION', 'oops', { details: { issues: [] } });
    expect(err.details).toEqual({ issues: [] });
  });

  it('exposes ApiErrorCode enum with the expected canonical entries', () => {
    expect(API_ERROR_CODES).toEqual([
      'VALIDATION',
      'AUTH',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMIT',
      'INTERNAL',
    ]);
  });

  it('default status map matches HTTP semantics', () => {
    expect(DEFAULT_STATUS_FOR_CODE.VALIDATION).toBe(400);
    expect(DEFAULT_STATUS_FOR_CODE.AUTH).toBe(401);
    expect(DEFAULT_STATUS_FOR_CODE.NOT_FOUND).toBe(404);
    expect(DEFAULT_STATUS_FOR_CODE.CONFLICT).toBe(409);
    expect(DEFAULT_STATUS_FOR_CODE.RATE_LIMIT).toBe(429);
    expect(DEFAULT_STATUS_FOR_CODE.INTERNAL).toBe(500);
  });
});

describe('apiOk', () => {
  it('returns 200 with the success envelope by default', async () => {
    const request = new Request('http://localhost');
    const response = apiOk(request, cors, 'rid-1', { hello: 'world' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: { hello: 'world' } });
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-request-id')).toBe('rid-1');
  });

  it('honors a custom 201 status', () => {
    const request = new Request('http://localhost');
    const response = apiOk(request, cors, 'rid-1', { hello: 'world' }, { status: 201 });
    expect(response.status).toBe(201);
  });

  it('emits CORS headers for the response', () => {
    const request = new Request('http://localhost');
    const response = apiOk(request, cors, 'rid-1', { ok: true });
    expect(response.headers.get('access-control-expose-headers')).toContain('x-request-id');
  });
});

describe('apiError', () => {
  it('returns the canonical error envelope at the default status', async () => {
    const request = new Request('http://localhost');
    const response = apiError(request, cors, 'rid-1', 'VALIDATION', 'bad input');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: { code: 'VALIDATION', message: 'bad input' },
    });
  });

  it('attaches optional details on the error body', async () => {
    const request = new Request('http://localhost');
    const response = apiError(request, cors, 'rid-1', 'VALIDATION', 'bad', {
      details: { foo: 'bar' },
    });
    const body = await response.json();
    expect(body.error.details).toEqual({ foo: 'bar' });
  });

  it('honors a custom status (e.g. 202 deferred)', () => {
    const request = new Request('http://localhost');
    const response = apiError(request, cors, 'rid-1', 'NOT_FOUND', 'deferred', { status: 202 });
    expect(response.status).toBe(202);
  });

  it('echoes the request id in the response header', () => {
    const request = new Request('http://localhost');
    const response = apiError(request, cors, 'rid-77', 'AUTH', 'denied');
    expect(response.headers.get('x-request-id')).toBe('rid-77');
  });
});

describe('apiNoContent', () => {
  it('returns 204 with no body', async () => {
    const request = new Request('http://localhost');
    const response = apiNoContent(request, cors, 'rid-1');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('echoes the request id', () => {
    const request = new Request('http://localhost');
    const response = apiNoContent(request, cors, 'rid-7');
    expect(response.headers.get('x-request-id')).toBe('rid-7');
  });
});

describe('errorToResponse', () => {
  it('maps an ApiError to its declared status and envelope', async () => {
    const request = new Request('http://localhost');
    const response = errorToResponse(
      request,
      cors,
      'rid-1',
      new ApiError('AUTH', 'denied', { status: 403 }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: { code: 'AUTH', message: 'denied' } });
  });

  it('passes ApiError details through to the wire', async () => {
    const request = new Request('http://localhost');
    const response = errorToResponse(
      request,
      cors,
      'rid-1',
      new ApiError('VALIDATION', 'oops', { details: { foo: 'bar' } }),
    );
    const body = await response.json();
    expect(body.error.details).toEqual({ foo: 'bar' });
  });

  it('falls back to INTERNAL for an arbitrary thrown Error', async () => {
    const request = new Request('http://localhost');
    const response = errorToResponse(request, cors, 'rid-1', new Error('boom'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'boom' } });
  });

  it('falls back to INTERNAL for a thrown string', async () => {
    const request = new Request('http://localhost');
    const response = errorToResponse(request, cors, 'rid-1', 'pure-string-throw');
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('pure-string-throw');
  });

  it('uses the default status for an ApiError with default-matching status', async () => {
    const request = new Request('http://localhost');
    const response = errorToResponse(request, cors, 'rid-1', new ApiError('VALIDATION', 'bad'));
    expect(response.status).toBe(400);
  });
});
