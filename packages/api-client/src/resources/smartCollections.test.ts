// Tests for the smart-collections resource. The preview endpoint
// is authenticated; outbound validation rejects bad expressions
// at the client without reaching fetch.

import { describe, expect, it } from 'vitest';

import { HttpClient } from '../client.js';
import {
  ApiNotFoundError,
  ApiResponseDecodeError,
  ApiUnauthorizedError,
  ApiValidationError,
} from '../error.js';
import { errEnvelope, mockFetch, okEnvelope } from '../test-helpers.js';
import {
  VALID_SMART_PREVIEW_REQUEST,
  VALID_SMART_PREVIEW_RESPONSE,
} from './_fixtures.js';
import { makeSmartCollectionsResource } from './smartCollections.js';

function makeResource(fetch: ReturnType<typeof mockFetch>): {
  fetch: ReturnType<typeof mockFetch>;
  smartCollections: ReturnType<typeof makeSmartCollectionsResource>;
} {
  const http = new HttpClient({
    baseUrl: 'http://localhost:54321',
    apiKey: 'anon',
    getJwt: () => 'jwt-1',
    fetch,
  });
  return { fetch, smartCollections: makeSmartCollectionsResource(http) };
}

describe('smartCollections.preview', () => {
  it('returns the typed response on happy path', async () => {
    const { smartCollections } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_PREVIEW_RESPONSE) }),
    );
    const result = await smartCollections.preview(VALID_SMART_PREVIEW_REQUEST);
    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.nextOffset).toBeNull();
  });

  it('hits POST /v1/smart-collections/preview', async () => {
    const { fetch, smartCollections } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_PREVIEW_RESPONSE) }),
    );
    await smartCollections.preview(VALID_SMART_PREVIEW_REQUEST);
    const url = fetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/smart-collections/preview');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('JSON-encodes the expression in the body', async () => {
    const { fetch, smartCollections } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_PREVIEW_RESPONSE) }),
    );
    await smartCollections.preview(VALID_SMART_PREVIEW_REQUEST);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.body).toContain('"expression"');
    expect(init?.body).toContain('"limit":50');
  });

  it('sends the Authorization header (authed endpoint)', async () => {
    const { fetch, smartCollections } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_PREVIEW_RESPONSE) }),
    );
    await smartCollections.preview(VALID_SMART_PREVIEW_REQUEST);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers?.authorization).toBe('Bearer jwt-1');
  });

  it('throws ApiValidationError synchronously when expression is missing', async () => {
    const { fetch, smartCollections } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_PREVIEW_RESPONSE) }),
    );
    await expect(
      smartCollections.preview({ limit: 50 } as never),
    ).rejects.toBeInstanceOf(ApiValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws ApiValidationError when limit exceeds the documented max', async () => {
    const { smartCollections } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_PREVIEW_RESPONSE) }),
    );
    await expect(
      smartCollections.preview({ ...VALID_SMART_PREVIEW_REQUEST, limit: 5000 }),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('throws ApiUnauthorizedError on 401', async () => {
    const { smartCollections } = makeResource(mockFetch({ status: 401 }));
    await expect(
      smartCollections.preview(VALID_SMART_PREVIEW_REQUEST),
    ).rejects.toBeInstanceOf(ApiUnauthorizedError);
  });

  it('throws ApiNotFoundError when the route is missing (env regression guard)', async () => {
    const { smartCollections } = makeResource(
      mockFetch({
        status: 404,
        body: errEnvelope({ code: 'NOT_FOUND', message: 'no route' }),
      }),
    );
    await expect(
      smartCollections.preview(VALID_SMART_PREVIEW_REQUEST),
    ).rejects.toBeInstanceOf(ApiNotFoundError);
  });

  it('throws ApiResponseDecodeError on a malformed payload', async () => {
    const { smartCollections } = makeResource(
      mockFetch({
        status: 200,
        body: okEnvelope({ items: 'not-an-array', totalCount: 0, nextOffset: null }),
      }),
    );
    await expect(
      smartCollections.preview(VALID_SMART_PREVIEW_REQUEST),
    ).rejects.toBeInstanceOf(ApiResponseDecodeError);
  });

  it('omits unknown extra keys from the validated body (strict)', async () => {
    const { smartCollections } = makeResource(
      mockFetch({ status: 200, body: okEnvelope(VALID_SMART_PREVIEW_RESPONSE) }),
    );
    // The DTO is `.strict()` so unknown extras are rejected.
    await expect(
      smartCollections.preview({
        ...VALID_SMART_PREVIEW_REQUEST,
        unexpected: 'extra',
      } as never),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});
