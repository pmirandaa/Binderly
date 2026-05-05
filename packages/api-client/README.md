# `@binderly/api-client`

Typed HTTP client over `@binderly/api-contracts` + `@binderly/auth` —
the single SDK every Binderly consumer (web, mobile, scanner,
shareable SSR) uses to talk to the Binderly backend.

This package is the **stitch** between the wire contracts
(`@binderly/api-contracts`) and the consumer apps. Without it,
every app would re-implement `fetch` + parse + error-translate
plumbing.

## What this package is

- **A typed fetch wrapper.** Every endpoint method returns a
  fully-typed DTO from `@binderly/api-contracts`.
- **Validating both ways.** Outbound request bodies are parsed
  with the relevant write schema **before** the wire round-trip
  (catches caller bugs at the call site). Inbound responses are
  parsed with the matching read schema (catches backend drift).
- **Token-store agnostic.** A `getJwt` callback at construction
  time decouples the client from any particular session store.
- **Browser / RN / Edge / Node compatible.** Uses
  `globalThis.fetch`; no `node-fetch` import.
- **A consistent error taxonomy.** Every failure is an
  `ApiError` subclass with a stable `code` field.

## What this package is **not**

- **Not a route-handler framework.** This client describes the
  **shape** of the calls; the actual route handlers live in
  `T-BE-EDGE-FUNCTIONS` and future Fly services.
- **Not a state-management library.** No tanstack-query, no swr.
  Wire those on top.
- **Not an offline / retry / back-off layer.** PROJECT.md §11
  ships offline as Phase 9 (`T-OS-*`).

## Usage

### Web (browser, Next.js client component)

```ts
import { createClient } from '@binderly/api-client';
import { createClient as createSupabase } from '@supabase/supabase-js';

const supabase = createSupabase(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  },
);

export const api = createClient({
  baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  // Pull token from the same Supabase session — single source of truth.
  getJwt: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  supabaseAuth: supabase, // share the SDK so signIn/signOut hit the same persistence
});

// Read catalog (anonymous):
const sets = await api.cards.listSets({ limit: 20 });

// Write user data (authenticated):
const item = await api.collection.addCollectionItem({
  printingId: 'cccccccc-3333-4333-8333-cccccccccccc',
  quantity: 1,
});
```

### Server-side (Edge Function, Next.js Route Handler)

```ts
import { createClient } from '@binderly/api-client';
import { requireUser, loadAuthEnv } from '@binderly/auth';

const env = loadAuthEnv();

export async function GET(request: Request) {
  const session = await requireUser(request, env);
  const api = createClient({
    baseUrl: env.supabaseUrl,
    apiKey: env.supabaseAnonKey,
    getJwt: () => (session.claims.raw['access_token'] as string) ?? null,
    // Server-side: don't build an internal supabase auth client.
    // We never call api.auth.* server-side.
  });
  const profile = await api.profile.getMyProfile();
  return Response.json(profile);
}
```

### Tests (mocked fetch)

```ts
import { createClient, ApiUnauthorizedError } from '@binderly/api-client';
import { vi } from 'vitest';

const mockFetch = vi.fn().mockResolvedValue(
  new Response(
    JSON.stringify({
      ok: true,
      data: {
        /* ... */
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  ),
);

const api = createClient({
  baseUrl: 'http://localhost:54321',
  apiKey: 'anon',
  getJwt: () => 'jwt',
  fetch: mockFetch as never,
});

await api.cards.getSet({ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' });

expect(mockFetch).toHaveBeenCalledWith(
  expect.stringContaining('/v1/sets/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  expect.objectContaining({
    method: 'GET',
    headers: expect.objectContaining({
      apikey: 'anon',
      authorization: 'Bearer jwt',
    }),
  }),
);
```

## Validation policy

### Outbound (request bodies)

Every method that mutates state validates its input via the
corresponding `@binderly/api-contracts` write schema **before**
encoding to JSON. A bad payload throws `ApiValidationError`
synchronously — no wire round-trip needed.

```ts
try {
  await api.collection.addCollectionItem({
    printingId: 'not-a-uuid',
    quantity: 0, // schema requires >= 1
  });
} catch (error) {
  if (error instanceof ApiValidationError) {
    console.log(error.zodIssues); // [{ path: ['printingId'], message: 'Invalid uuid' }, ...]
  }
}
```

### Inbound (response bodies)

Every read is parsed via `apiResultSchema(<dto>)` — the
discriminated-union envelope from `@binderly/api-contracts`. A
parse failure throws `ApiResponseDecodeError` carrying the raw
body and the zod error so the caller can log a useful diff.
This is how **backend drift surfaces loudly** rather than as a
silently-wrong field at render time.

## Error taxonomy

Every failure path throws an `ApiError` subclass. Branch by
`instanceof` or by the stable `code` field.

| Subclass                 | `code`         | Triggered by                                   |
| ------------------------ | -------------- | ---------------------------------------------- |
| `ApiValidationError`     | `'VALIDATION'` | Bad outbound body OR HTTP 400 / envelope code. |
| `ApiUnauthorizedError`   | `'AUTH'`       | HTTP 401.                                      |
| `ApiForbiddenError`      | `'AUTH'`       | HTTP 403.                                      |
| `ApiNotFoundError`       | `'NOT_FOUND'`  | HTTP 404 / envelope code.                      |
| `ApiConflictError`       | `'CONFLICT'`   | HTTP 409 / envelope code.                      |
| `ApiRateLimitError`      | `'RATE_LIMIT'` | HTTP 429 / envelope code (with `Retry-After`). |
| `ApiServerError`         | `'INTERNAL'`   | HTTP 5xx / envelope code.                      |
| `ApiNetworkError`        | `'NETWORK'`    | `fetch` reject (DNS, TLS, AbortSignal).        |
| `ApiResponseDecodeError` | `'DECODE'`     | 2xx response that doesn't match the schema.    |
| `ApiAuthError`           | `'AUTH'`       | Supabase Auth SDK reject.                      |

Every subclass extends `ApiError` so a single `instanceof
ApiError` catches them all.

## Resource map

| Resource     | Methods (high-level)                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cards`      | `listSets`, `getSet`, `listCardsInSet`, `getCard`, `listPrintingsForCard`, `getPrinting`                                                                                                        |
| `collection` | `listCollectionItems`, `addCollectionItem`, `updateCollectionItem`, `deleteCollectionItem`; custom-collection CRUD (manual + smart); manual-collection items; smart-rule expression replacement |
| `pricing`    | `listMarkets`, `getCurrentPrice`, `getPriceHistory`, `getFxRate`                                                                                                                                |
| `grading`    | `listGradingSubmissions`, `getGradingSubmission`, `submitGradingPrediction`, `updateGradingSubmissionStatus`, `attachActualGrade`                                                               |
| `shareables` | Owner CRUD + `getPublicShareable({ handle, slug })` (anonymous render path)                                                                                                                     |
| `profile`    | `getMyProfile`, `updateMyProfile`, `getMySubscription`                                                                                                                                          |
| `auth`       | `signInWithOAuth`, `signInWithMagicLink`, `exchangeCodeForSession`, `signOut`, `getSession`, `getCurrentUser`, `raw()`                                                                          |

## Package gates

```bash
pnpm --filter @binderly/api-client format:check
pnpm --filter @binderly/api-client lint
pnpm --filter @binderly/api-client typecheck
pnpm --filter @binderly/api-client test
pnpm --filter @binderly/api-client build
```

All five must pass clean (no warnings, no errors) before a PR
that touches this package can land.

## Related tasks

- **T-BE-API-CONTRACTS** — defines the wire-format DTOs this
  client validates against.
- **T-BE-AUTH** — server-side helpers; this client takes a
  `getJwt` callback that's typically wired through
  `@binderly/auth` server-side.
- **T-BE-EDGE-FUNCTIONS** — implements the route handlers
  behind every URL path codified here.
- **T-W-AUTH** / **T-W-BROWSE** / **T-W-COLLECTION** — web
  consumers.
- **T-M-AUTH** / **T-M-BROWSE** / **T-M-COLLECTION** — mobile
  consumers.
