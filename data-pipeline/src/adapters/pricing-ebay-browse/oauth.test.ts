// FetchShim tests for `EbayOAuthClient`.
//
// Coverage:
//   - happy path: client-credentials POST returns a Bearer token
//   - in-process caching: a second call within the TTL doesn't fire
//     a fresh HTTP request
//   - refresh-before-expiry: clock past `expires_in - skew` triggers
//     a fresh fetch
//   - schema-mismatched body → PermanentError
//   - malformed JSON body → PermanentError
//   - 401 (bad credentials) bubbles PermanentError after the
//     RateLimitedClient classifies the response as a permanent 4xx
//   - concurrent callers share a single in-flight fetch (dedup)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EBAY_API_HOST,
  EBAY_OAUTH_DEFAULT_SCOPE,
  EBAY_OAUTH_TOKEN_PATH,
  EBAY_OAUTH_TOKEN_REFRESH_SKEW_MS,
  EbayOAuthClient,
  createEbayOAuthClient,
} from './oauth.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { PermanentError } from '../../interfaces/adapter.js';

const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface ProgrammableResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  throw?: Error;
}

class FetchShim {
  readonly requests: RecordedRequest[] = [];
  private readonly queues = new Map<string, ProgrammableResponse[]>();
  defaultResponse: ProgrammableResponse | null = null;

  enqueue(pathname: string, ...responses: ProgrammableResponse[]): this {
    const list = this.queues.get(pathname) ?? [];
    list.push(...responses);
    this.queues.set(pathname, list);
    return this;
  }

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const body =
      init?.body === undefined ? undefined : typeof init.body === 'string' ? init.body : '[binary]';
    this.requests.push({ url, method: init?.method ?? 'GET', headers, body });
    const pathname = new URL(url).pathname;
    const queue = this.queues.get(pathname);
    let next: ProgrammableResponse | undefined;
    if (queue && queue.length > 0) next = queue.shift();
    if (!next) next = this.defaultResponse ?? undefined;
    if (!next) throw new Error(`FetchShim: no programmed response for ${pathname}`);
    if (next.throw) throw next.throw;
    return new Response(next.body ?? '', { status: next.status, headers: next.headers });
  };
}

let shim: FetchShim;
let nowMs = 1_700_000_000_000;
const fakeNow = (): number => nowMs;

beforeEach(() => {
  shim = new FetchShim();
  nowMs = 1_700_000_000_000;
});

afterEach(() => {
  delete process.env['BINDERLY_DATA_PIPELINE_UA'];
});

function newClient(over: Partial<ConstructorParameters<typeof RateLimitedClient>[0]> = {}) {
  const http = new RateLimitedClient({
    host: EBAY_API_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
    ...over,
  });
  return new EbayOAuthClient({
    http,
    clientId: 'TEST_CLIENT_ID',
    clientSecret: 'TEST_CLIENT_SECRET',
    now: fakeNow,
  });
}

const TOKEN_BODY = JSON.stringify({
  access_token: 'v^1.1#i^1#test-bearer',
  expires_in: 7200,
  token_type: 'Application Access Token',
});

describe('EbayOAuthClient — construction', () => {
  it('refuses a RateLimitedClient pinned to a different host', () => {
    const wrongHost = new RateLimitedClient({
      host: 'api.tcgdex.net',
      requestsPerSecond: 1,
      burst: 1,
      userAgent: UA,
      fetchImpl: shim.fetch,
    });
    expect(
      () =>
        new EbayOAuthClient({
          http: wrongHost,
          clientId: 'a',
          clientSecret: 'b',
        }),
    ).toThrow(/pinned to api\.ebay\.com/u);
  });

  it('refuses missing credentials', () => {
    const http = new RateLimitedClient({
      host: EBAY_API_HOST,
      requestsPerSecond: 1,
      burst: 1,
      userAgent: UA,
      fetchImpl: shim.fetch,
    });
    expect(() => new EbayOAuthClient({ http, clientId: '', clientSecret: 'b' })).toThrow(
      /clientId/u,
    );
    expect(() => new EbayOAuthClient({ http, clientId: 'a', clientSecret: '' })).toThrow(
      /clientSecret/u,
    );
  });
});

describe('EbayOAuthClient — getApplicationToken', () => {
  it('happy path: POSTs client-credentials grant and returns the bearer token', async () => {
    const client = newClient();
    shim.enqueue(EBAY_OAUTH_TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    const token = await client.getApplicationToken();
    expect(token).toBe('v^1.1#i^1#test-bearer');

    expect(shim.requests).toHaveLength(1);
    const req = shim.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    // Basic <base64(clientId:clientSecret)>:
    const expectedBasic = Buffer.from('TEST_CLIENT_ID:TEST_CLIENT_SECRET').toString('base64');
    expect(req.headers['authorization']).toBe(`Basic ${expectedBasic}`);
    expect(req.headers['user-agent']).toBe(UA);
    const params = new URLSearchParams(req.body ?? '');
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('scope')).toBe(EBAY_OAUTH_DEFAULT_SCOPE);
  });

  it('caches the token across calls within the TTL', async () => {
    const client = newClient();
    shim.enqueue(EBAY_OAUTH_TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    const t1 = await client.getApplicationToken();
    const t2 = await client.getApplicationToken();
    expect(t1).toBe(t2);
    expect(shim.requests).toHaveLength(1);
  });

  it('refreshes ahead of expiry (now > expiresAt)', async () => {
    const client = newClient();
    shim.enqueue(
      EBAY_OAUTH_TOKEN_PATH,
      { status: 200, body: TOKEN_BODY },
      { status: 200, body: JSON.stringify({ ...JSON.parse(TOKEN_BODY), access_token: 'second' }) },
    );
    await client.getApplicationToken();
    // 7200s TTL - 120s skew = 7080000 ms; advance just past it.
    nowMs += 7200 * 1000 - EBAY_OAUTH_TOKEN_REFRESH_SKEW_MS + 1;
    const second = await client.getApplicationToken();
    expect(second).toBe('second');
    expect(shim.requests).toHaveLength(2);
  });

  it('invalidate() forces a fresh fetch', async () => {
    const client = newClient();
    shim.enqueue(
      EBAY_OAUTH_TOKEN_PATH,
      { status: 200, body: TOKEN_BODY },
      { status: 200, body: JSON.stringify({ ...JSON.parse(TOKEN_BODY), access_token: 'fresh' }) },
    );
    await client.getApplicationToken();
    client.invalidate();
    const fresh = await client.getApplicationToken();
    expect(fresh).toBe('fresh');
    expect(shim.requests).toHaveLength(2);
  });

  it('schema-mismatch body throws PermanentError', async () => {
    const client = newClient();
    shim.enqueue(EBAY_OAUTH_TOKEN_PATH, {
      status: 200,
      body: JSON.stringify({ unexpected: 'shape' }),
    });
    await expect(client.getApplicationToken()).rejects.toBeInstanceOf(PermanentError);
  });

  it('malformed JSON body throws PermanentError', async () => {
    const client = newClient();
    shim.enqueue(EBAY_OAUTH_TOKEN_PATH, { status: 200, body: 'not json {{{' });
    await expect(client.getApplicationToken()).rejects.toBeInstanceOf(PermanentError);
  });

  it('401 bubbles PermanentError (not retried)', async () => {
    const client = newClient();
    shim.enqueue(EBAY_OAUTH_TOKEN_PATH, { status: 401, body: '{"error":"invalid_client"}' });
    await expect(client.getApplicationToken()).rejects.toBeInstanceOf(PermanentError);
    expect(shim.requests).toHaveLength(1);
  });

  it('concurrent callers share a single in-flight token fetch', async () => {
    const client = newClient();
    shim.enqueue(EBAY_OAUTH_TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    const [a, b, c] = await Promise.all([
      client.getApplicationToken(),
      client.getApplicationToken(),
      client.getApplicationToken(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(shim.requests).toHaveLength(1);
  });
});

describe('createEbayOAuthClient — convenience factory', () => {
  it('uses the default User-Agent when neither override nor env is set', () => {
    const client = createEbayOAuthClient({
      clientId: 'a',
      clientSecret: 'b',
      httpOverrides: { fetchImpl: shim.fetch, sleep: () => Promise.resolve() },
    });
    expect(client).toBeInstanceOf(EbayOAuthClient);
  });
});
