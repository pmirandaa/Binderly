// Shared test fixtures + a hand-rolled fake `@supabase/supabase-js`
// client. The fake records every method call so tests can assert on
// the chain shape the handlers built, plus accepts a programmable
// "what should this chain return?" map.
//
// Why a hand-rolled fake instead of vi.mock? The Supabase client API
// is fluent and chains by table; mocking it via vi.mock would require
// re-implementing every chain-method anyway, just with vitest noise
// around it. The pure-JS fake here is small, stable, and explicit.
//
// Usage from a test:
//
//   const fake = createFakeSupabase()
//     .when('collection_item', 'select', { user_id: USER_ID }, [
//       { data: [collectionItemRowFixture()], error: null },
//     ])
//     .when('collection_item', 'insert', null, [
//       { data: insertedRowFixture(), error: null },
//     ]);
//   const handler = makeHandler({
//     getEnv: () => 'fake',
//     routes: ROUTES,
//     deps: { createClient: () => fake.client },
//   });

import type { ApiErrorEnvelopeBody } from './errors.ts';
import type { SupabaseClient, User } from '@supabase/supabase-js';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

export const FIXTURE_USER_ID = TEST_USER_ID;
export const FIXTURE_OTHER_USER_ID = TEST_OTHER_USER_ID;
export const FIXTURE_PRINTING_ID = '33333333-3333-4333-8333-333333333333';
export const FIXTURE_COLLECTION_ITEM_ID = '44444444-4444-4444-8444-444444444444';
export const FIXTURE_CUSTOM_COLLECTION_ID = '55555555-5555-4555-8555-555555555555';

/**
 * Build a *valid-shaped* JWT (header.payload.signature) for tests.
 * Signature isn't verified locally; the fake supabase auth always
 * returns the user we set up.
 */
export function makeFakeJwt(claims: Record<string, unknown> = {}): string {
  const payload = {
    sub: TEST_USER_ID,
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    email: 'fixture@binderly.test',
    ...claims,
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}.fakesig`;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * A canned `User` matching what `supabase.auth.getUser(token)` would
 * return for the fixture user. Aliased loosely; real type is huge.
 */
export function makeFakeUser(overrides: Partial<User> = {}): User {
  const base: Record<string, unknown> = {
    id: TEST_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'fixture@binderly.test',
    email_confirmed_at: '2024-01-01T00:00:00Z',
    phone: '',
    confirmed_at: '2024-01-01T00:00:00Z',
    last_sign_in_at: '2024-01-01T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
  return { ...base, ...overrides } as unknown as User;
}

export interface RecordedCall {
  readonly table?: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

interface QueryOutcome {
  readonly data?: unknown;
  readonly error?: { code?: string; message: string; details?: string | null } | null;
  readonly count?: number | null;
}

/**
 * `FakeSupabaseClient` is a tiny stand-in for the SDK's chainable
 * client. Every method records its call into a shared list and then
 * returns a "Thenable" object that itself resolves to the configured
 * outcome.
 *
 * The fake supports a programmable response queue per (table,
 * terminator) pair — `terminator` is the chain-ending verb the
 * caller invokes (`single`, `maybeSingle`, the awaited promise).
 *
 * For `auth.getUser(token)` we accept a single outcome (either a
 * canned user or a canned error).
 */
export interface FakeSupabaseSetup {
  readonly user?: User;
  readonly authError?: { code?: string; message: string; status?: number } | null;
  readonly tableResponses?: Readonly<Record<string, readonly QueryOutcome[]>>;
}

export interface FakeSupabaseClient {
  readonly client: SupabaseClient;
  readonly calls: readonly RecordedCall[];
  /**
   * Append a programmable outcome onto the queue for `<table>` —
   * used when a single test case wants to script multiple chained
   * round-trips against the same table.
   */
  enqueue(table: string, outcome: QueryOutcome): FakeSupabaseClient;
  reset(): void;
}

export function createFakeSupabase(setup: FakeSupabaseSetup = {}): FakeSupabaseClient {
  const calls: RecordedCall[] = [];
  const queues: Record<string, QueryOutcome[]> = {};
  for (const [table, outcomes] of Object.entries(setup.tableResponses ?? {})) {
    queues[table] = [...outcomes];
  }

  const drainOutcome = (table: string): QueryOutcome => {
    const queue = queues[table];
    if (queue === undefined || queue.length === 0) {
      throw new Error(
        `FakeSupabaseClient: no queued outcome for table "${table}". ` +
          `Configure one via tableResponses or .enqueue("${table}", outcome).`,
      );
    }
    const next = queue.shift();
    return next ?? { data: null, error: null };
  };

  const buildQuery = (table: string): unknown => {
    let pending: QueryOutcome | null = null;
    const ensurePending = (): QueryOutcome => {
      if (pending === null) pending = drainOutcome(table);
      return pending;
    };
    const builder = {
      select: (...args: unknown[]) => {
        calls.push({ table, method: 'select', args });
        return builder;
      },
      eq: (...args: unknown[]) => {
        calls.push({ table, method: 'eq', args });
        return builder;
      },
      neq: (...args: unknown[]) => {
        calls.push({ table, method: 'neq', args });
        return builder;
      },
      is: (...args: unknown[]) => {
        calls.push({ table, method: 'is', args });
        return builder;
      },
      in: (...args: unknown[]) => {
        calls.push({ table, method: 'in', args });
        return builder;
      },
      lt: (...args: unknown[]) => {
        calls.push({ table, method: 'lt', args });
        return builder;
      },
      lte: (...args: unknown[]) => {
        calls.push({ table, method: 'lte', args });
        return builder;
      },
      gte: (...args: unknown[]) => {
        calls.push({ table, method: 'gte', args });
        return builder;
      },
      order: (...args: unknown[]) => {
        calls.push({ table, method: 'order', args });
        return builder;
      },
      limit: (...args: unknown[]) => {
        calls.push({ table, method: 'limit', args });
        return builder;
      },
      insert: (...args: unknown[]) => {
        calls.push({ table, method: 'insert', args });
        return builder;
      },
      update: (...args: unknown[]) => {
        calls.push({ table, method: 'update', args });
        return builder;
      },
      delete: (...args: unknown[]) => {
        calls.push({ table, method: 'delete', args });
        return builder;
      },
      single: () => {
        calls.push({ table, method: 'single', args: [] });
        const outcome = ensurePending();
        pending = null;
        const data = outcome.data ?? null;
        const error = outcome.error ?? null;
        return Promise.resolve({ data, error });
      },
      maybeSingle: () => {
        calls.push({ table, method: 'maybeSingle', args: [] });
        const outcome = ensurePending();
        pending = null;
        const data = outcome.data ?? null;
        const error = outcome.error ?? null;
        return Promise.resolve({ data, error });
      },
      then: (
        resolve: (value: { data: unknown; error: unknown }) => void,
        reject?: (reason: unknown) => void,
      ) => {
        const outcome = ensurePending();
        pending = null;
        try {
          resolve({ data: outcome.data ?? null, error: outcome.error ?? null });
        } catch (cause) {
          if (reject !== undefined) reject(cause);
        }
      },
    };
    return builder;
  };

  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table], table });
      return buildQuery(table);
    },
    /**
     * Tiny `.rpc(name, args?)` stub. Queues are keyed `rpc:<name>` so
     * tests enqueue outcomes via `tableResponses: { 'rpc:foo': [...] }`
     * or `.enqueue('rpc:foo', ...)`. If no outcome is queued, the call
     * resolves to `{ data: null, error: null }` rather than throwing —
     * that matches the "best-effort refresh hook" pattern used by the
     * collection-mutation handlers, where a missing `.rpc(...)` shim
     * shouldn't break the underlying mutation test.
     */
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.push({ method: 'rpc', table: name, args: args === undefined ? [] : [args] });
      const queue = queues[`rpc:${name}`];
      const outcome =
        queue === undefined || queue.length === 0
          ? { data: null, error: null }
          : (queue.shift() ?? { data: null, error: null });
      return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null });
    },
    auth: {
      getUser: async (token?: string) => {
        calls.push({ method: 'auth.getUser', args: [token] });
        if (setup.authError !== undefined && setup.authError !== null) {
          return { data: { user: null }, error: setup.authError };
        }
        return {
          data: { user: setup.user ?? makeFakeUser() },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;

  return {
    client,
    calls,
    enqueue(table: string, outcome: QueryOutcome) {
      if (queues[table] === undefined) queues[table] = [];
      queues[table].push(outcome);
      return this;
    },
    reset() {
      calls.length = 0;
      for (const key of Object.keys(queues)) delete queues[key];
    },
  };
}

/**
 * Build a `Request` with the bearer token + canonical headers a
 * production caller would send.
 */
export function buildRequest(input: {
  readonly url: string;
  readonly method: string;
  readonly token?: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}): Request {
  const headers = new Headers(input.headers);
  if (input.token !== undefined) {
    headers.set('authorization', `Bearer ${input.token}`);
  }
  if (input.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  return new Request(input.url, {
    method: input.method,
    headers,
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  });
}

/**
 * Read a `Response` body as JSON and assert the shape matches the
 * error envelope. Returns the parsed body for further assertions.
 */
export async function readErrorBody(response: Response): Promise<ApiErrorEnvelopeBody> {
  const text = await response.text();
  if (text.length === 0) {
    throw new Error(`Expected error body, got empty response (status ${response.status}).`);
  }
  const parsed = JSON.parse(text) as ApiErrorEnvelopeBody;
  if (parsed.ok !== false) {
    throw new Error(`Expected ok:false envelope, got ${JSON.stringify(parsed)}.`);
  }
  return parsed;
}

/**
 * Read a `Response` body as JSON and assert it's the success
 * envelope. Returns the typed `data` for further assertions.
 */
export async function readSuccessBody<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length === 0) {
    throw new Error(`Expected success body, got empty response (status ${response.status}).`);
  }
  const parsed = JSON.parse(text) as { ok: true; data: T } | { ok: false; error: unknown };
  if (parsed.ok !== true) {
    throw new Error(`Expected ok:true envelope, got ${JSON.stringify(parsed)}.`);
  }
  return parsed.data;
}

export const TEST_ENV = {
  supabaseUrl: 'https://test.supabase.test',
  supabaseAnonKey: 'anon-key',
  supabaseServiceRoleKey: 'service-role-key',
  corsAllowOrigins: ['*'] as readonly string[],
};

/**
 * Build a snake-cased `collection_item` row matching the schema, with
 * sensible defaults that handlers can pattern-match.
 */
export function collectionItemRowFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: FIXTURE_COLLECTION_ITEM_ID,
    user_id: TEST_USER_ID,
    printing_id: FIXTURE_PRINTING_ID,
    quantity: 1,
    condition: 'NEAR_MINT',
    grade_company: null,
    grade: null,
    acquired_at: null,
    acquired_price: null,
    acquired_currency: null,
    notes: null,
    photo_urls: [],
    source: 'manual',
    created_at: '2024-06-01T12:00:00.000Z',
    updated_at: '2024-06-01T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build a snake-cased `custom_collection` row.
 */
export function customCollectionRowFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: FIXTURE_CUSTOM_COLLECTION_ID,
    user_id: TEST_USER_ID,
    name: 'Gym Leaders',
    slug: 'gym-leaders',
    kind: 'manual',
    description: null,
    cover_url: null,
    created_at: '2024-06-01T12:00:00.000Z',
    updated_at: '2024-06-01T12:00:00.000Z',
    ...overrides,
  };
}
