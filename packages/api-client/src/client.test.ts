// Unit tests for the core HttpClient. The mocked-fetch helper
// from `./test-helpers.js` returns a `vi.fn()` shaped to match
// the WHATWG `fetch` signature; assertions inspect what the
// client passed to it.

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { HttpClient } from './client.js';
import {
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
} from './error.js';
import { errEnvelope, mockFetch, mockFetchReject, okEnvelope } from './test-helpers.js';

const dataSchema = z.object({ id: z.string(), name: z.string() }).strict();

function makeClient(opts: {
  fetch?: ReturnType<typeof mockFetch>;
  getJwt?: () => Promise<string | null> | string | null;
  apiKey?: string;
  baseUrl?: string;
  defaultHeaders?: Readonly<Record<string, string>>;
}): HttpClient {
  return new HttpClient({
    baseUrl: opts.baseUrl ?? 'http://localhost:54321',
    apiKey: opts.apiKey ?? 'anon',
    getJwt: opts.getJwt ?? (() => null),
    fetch: opts.fetch ?? mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) }),
    ...(opts.defaultHeaders !== undefined ? { defaultHeaders: opts.defaultHeaders } : {}),
  });
}

describe('HttpClient.request — happy path', () => {
  it('parses the apiResult envelope and returns the typed data', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'one' }) });
    const client = makeClient({ fetch });
    const result = await client.request({ path: '/v1/x' }, dataSchema);
    expect(result).toEqual({ id: '1', name: 'one' });
  });

  it('builds the URL by joining baseUrl + path', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch, baseUrl: 'https://api.example.com' });
    await client.request({ path: '/v1/sets' }, dataSchema);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/v1/sets', expect.any(Object));
  });

  it('prepends a leading slash to a path that lacks one', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch, baseUrl: 'https://api.example.com' });
    await client.request({ path: 'v1/sets' }, dataSchema);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/v1/sets', expect.any(Object));
  });

  it('strips a trailing slash from baseUrl', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch, baseUrl: 'https://api.example.com/' });
    await client.request({ path: '/v1/sets' }, dataSchema);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/v1/sets', expect.any(Object));
  });

  it('encodes query params (skipping undefined / null)', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request(
      {
        path: '/v1/sets',
        query: { cursor: 'abc', limit: 20, language: undefined, foo: null },
      },
      dataSchema,
    );
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('cursor=abc');
    expect(url).toContain('limit=20');
    expect(url).not.toContain('language');
    expect(url).not.toContain('foo');
  });

  it('URL-encodes special characters in query values', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x', query: { q: 'a b&c' } }, dataSchema);
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('q=a%20b%26c');
  });
});

describe('HttpClient.request — header injection', () => {
  it('always sends the apikey header', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch, apiKey: 'my-anon-key' });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ apikey: 'my-anon-key' });
  });

  it('always sends accept: application/json', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ accept: 'application/json' });
  });

  it('attaches Authorization: Bearer when getJwt resolves to a string', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch, getJwt: () => 'jwt-1' });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: 'Bearer jwt-1' });
  });

  it('omits Authorization when getJwt resolves to null', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch, getJwt: () => null });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBeUndefined();
  });

  it('omits Authorization when getJwt resolves to an empty string', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch, getJwt: () => '' });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBeUndefined();
  });

  it('skips getJwt entirely when anonymous: true', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const getJwt = vi.fn(() => 'jwt-1');
    const client = makeClient({ fetch, getJwt });
    await client.request({ path: '/v1/x', anonymous: true }, dataSchema);
    expect(getJwt).not.toHaveBeenCalled();
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBeUndefined();
  });

  it('awaits an async getJwt callback', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({
      fetch,
      getJwt: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return 'async-jwt';
      },
    });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: 'Bearer async-jwt' });
  });

  it('attaches content-type when a body is supplied', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x', method: 'POST', body: { foo: 'bar' } }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('omits content-type when no body is supplied', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.['content-type']).toBeUndefined();
  });

  it('merges defaultHeaders into every request', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({
      fetch,
      defaultHeaders: { 'x-binderly-app': 'web' },
    });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ 'x-binderly-app': 'web' });
  });

  it('per-request headers override defaultHeaders on collision', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({
      fetch,
      defaultHeaders: { 'x-binderly-app': 'web' },
    });
    await client.request({ path: '/v1/x', headers: { 'x-binderly-app': 'mobile' } }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ 'x-binderly-app': 'mobile' });
  });
});

describe('HttpClient.request — body encoding + method forwarding', () => {
  it('JSON-stringifies the body', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x', method: 'POST', body: { foo: 'bar' } }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"foo":"bar"}');
  });

  it('forwards the method verb', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x', method: 'PATCH', body: { foo: 1 } }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
  });

  it('defaults to GET when no method is given', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('GET');
  });

  it('omits the body field when no body is supplied', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    await client.request({ path: '/v1/x' }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
  });

  it('forwards an AbortSignal when supplied', async () => {
    const fetch = mockFetch({ status: 200, body: okEnvelope({ id: '1', name: 'a' }) });
    const client = makeClient({ fetch });
    const controller = new AbortController();
    await client.request({ path: '/v1/x', signal: controller.signal }, dataSchema);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.signal).toBe(controller.signal);
  });
});

describe('HttpClient.request — error mapping', () => {
  it('throws ApiNetworkError when fetch rejects', async () => {
    const fetch = mockFetchReject(new Error('ECONNRESET'));
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiNetworkError,
    );
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const fetch = mockFetch({ status: 401, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiUnauthorizedError,
    );
  });

  it('throws ApiForbiddenError on 403', async () => {
    const fetch = mockFetch({ status: 403, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiForbiddenError,
    );
  });

  it('throws ApiNotFoundError on 404', async () => {
    const fetch = mockFetch({ status: 404, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiNotFoundError,
    );
  });

  it('throws ApiConflictError on 409', async () => {
    const fetch = mockFetch({ status: 409, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiConflictError,
    );
  });

  it('throws ApiRateLimitError on 429', async () => {
    const fetch = mockFetch({ status: 429, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiRateLimitError,
    );
  });

  it('throws ApiServerError on 500', async () => {
    const fetch = mockFetch({ status: 500, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiServerError,
    );
  });

  it('respects the envelope code on a non-2xx response', async () => {
    const fetch = mockFetch({
      status: 400,
      body: errEnvelope({ code: 'VALIDATION', message: 'bad input' }),
    });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });

  it('throws ApiResponseDecodeError when the response body is not the envelope shape', async () => {
    const fetch = mockFetch({ status: 200, body: { random: 'shape' } });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiResponseDecodeError,
    );
  });

  it('throws ApiResponseDecodeError when the envelope data does not match the inner schema', async () => {
    const fetch = mockFetch({
      status: 200,
      body: { ok: true, data: { id: 'x' /* missing name */ } },
    });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiResponseDecodeError,
    );
  });

  it('a 200 envelope of { ok: false, error } throws the matching ApiError subclass', async () => {
    const fetch = mockFetch({
      status: 200,
      body: errEnvelope({ code: 'CONFLICT', message: 'duplicate' }),
    });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(
      ApiConflictError,
    );
  });

  it('preserves the request id from x-request-id header', async () => {
    const fetch = mockFetch({
      status: 500,
      body: undefined,
      headers: { 'x-request-id': 'req-abc' },
    });
    const client = makeClient({ fetch });
    expect.assertions(1);
    try {
      await client.request({ path: '/v1/x' }, dataSchema);
    } catch (error) {
      expect((error as ApiError).requestId).toBe('req-abc');
    }
  });

  it('throws plain ApiError (INTERNAL/code) on 204 when typed body was requested', async () => {
    const fetch = mockFetch({ status: 204, body: '' });
    const client = makeClient({ fetch });
    await expect(client.request({ path: '/v1/x' }, dataSchema)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('HttpClient.requestVoid', () => {
  it('resolves to undefined on 204', async () => {
    const fetch = mockFetch({ status: 204, body: '' });
    const client = makeClient({ fetch });
    await expect(client.requestVoid({ path: '/v1/x', method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('resolves to undefined on a 200 with { ok: true, data: null }', async () => {
    const fetch = mockFetch({ status: 200, body: { ok: true, data: null } });
    const client = makeClient({ fetch });
    await expect(client.requestVoid({ path: '/v1/x', method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('resolves to undefined on a 200 with empty body', async () => {
    const fetch = mockFetch({ status: 200, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.requestVoid({ path: '/v1/x', method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws on a 200 with a non-envelope body (contract violation)', async () => {
    const fetch = mockFetch({ status: 200, body: { foo: 'bar' } });
    const client = makeClient({ fetch });
    await expect(client.requestVoid({ path: '/v1/x' })).rejects.toBeInstanceOf(
      ApiResponseDecodeError,
    );
  });

  it('throws ApiNotFoundError on 404', async () => {
    const fetch = mockFetch({ status: 404, body: undefined });
    const client = makeClient({ fetch });
    await expect(client.requestVoid({ path: '/v1/x', method: 'DELETE' })).rejects.toBeInstanceOf(
      ApiNotFoundError,
    );
  });

  it('forwards the method', async () => {
    const fetch = mockFetch({ status: 204, body: '' });
    const client = makeClient({ fetch });
    await client.requestVoid({ path: '/v1/x', method: 'DELETE' });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('throws ApiNetworkError when fetch rejects', async () => {
    const fetch = mockFetchReject(new Error('boom'));
    const client = makeClient({ fetch });
    await expect(client.requestVoid({ path: '/v1/x', method: 'DELETE' })).rejects.toBeInstanceOf(
      ApiNetworkError,
    );
  });
});

describe('HttpClient — fallback to globalThis.fetch', () => {
  it('throws a clear error when no fetch is available and none was injected', () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    try {
      (globalThis as { fetch?: unknown }).fetch = undefined;
      expect(
        () =>
          new HttpClient({
            baseUrl: 'http://localhost',
            apiKey: 'anon',
            getJwt: () => null,
          }),
      ).toThrowError(/globalThis\.fetch is not available/);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});
