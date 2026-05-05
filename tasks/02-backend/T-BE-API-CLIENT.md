# T-BE-API-CLIENT — Typed HTTP client over `@binderly/api-contracts` + `@binderly/auth`

**Stage:** 02-backend
**Agent role:** backend
**Effort:** M (~half day)
**Status:** in_progress

---

## Hard dependencies

- **T-BE-API-CONTRACTS** (merged) — `@binderly/api-contracts` ships
  the zod schemas + inferred types for every wire-format DTO this
  client emits and consumes. Source of truth for both outbound
  request bodies and inbound response payloads.
- **T-BE-AUTH** (merged) — `@binderly/auth` ships the server-side
  helpers (`createUserScopedClient`, `loadAuthEnv`, `AuthError`,
  etc.). The api-client takes a `getJwt` callback and is therefore
  agnostic to whether the token comes from a browser store, a
  React Native secure store, or a server-side `@binderly/auth`
  session — but its `auth` resource is a thin wrapper over the
  Supabase JS SDK so a web/mobile app can use a single SDK
  (`@binderly/api-client`) for sign-in flows + data calls instead
  of stitching `@supabase/supabase-js` into every consumer.

## Soft dependencies / parallel siblings

- **T-SP-UI-TOKENS** (parallel sibling, in flight) — owns
  `packages/ui/`. Orthogonal at the directory level (no merge
  conflicts beyond `pnpm-lock.yaml`, which the orchestrator
  resolves at merge time). This task does not import from
  `@binderly/ui` and vice versa.
- **T-BE-EDGE-FUNCTIONS** (downstream, not yet started) — owns
  `infra/supabase/functions/`. The Edge Functions will provide
  authoritative server-side enforcement of freemium limits,
  completion materialized-view refresh, and webhook handling.
  This client codifies the URL paths it will call (`POST /v1/me/...`,
  etc.); the Edge Function task wires the route handlers behind
  those paths. Until those land, the api-client is exercised
  exclusively against mocked `fetch` (per D6 — Test posture). Once
  Edge Functions ship, downstream apps (T-W-*, T-M-*) get
  end-to-end integration coverage.

## Required reading

- `PROJECT.md` § 5 (Auth & Accounts), § 6 (Data Model), § 13
  (Pricing & FX), § 16 (Freemium), § 17 (Build Phases — confirms
  Phase 2 scope).
- `rules/02-backend.md` (this stage's hard rules — discriminated-
  union error envelope, server-side freemium gating, RLS posture).
- `context/conventions.md` — TypeScript strict mode, error shape,
  named exports, file layout, test posture.
- `context/data-model.md` — the underlying tables this client
  reads/writes via the api-contracts DTOs.
- `context/secrets-and-env.md` — env-var naming + the
  `<SCOPE>_<SERVICE>_<NAME>` convention (this client consumes the
  unscoped Supabase triple to stay portable across web / mobile /
  edge runtimes).
- `packages/api-contracts/src/*.ts` — every DTO this client
  validates against.
- `packages/api-contracts/README.md` — module map + the
  READ-vs-WRITE posture and the additive-only evolution policy.
- `packages/auth/src/{clients,session,jwt,types,errors,env}.ts` —
  the sibling-package patterns this client mirrors (build / test /
  lint config, ESM `dist/` posture per Q-004, `.strict()` typed
  errors).
- `tasks/02-backend/T-BE-API-CONTRACTS.md` and
  `tasks/02-backend/T-BE-AUTH.md` (sibling pattern reference;
  both are merged) — for elaboration template + commit posture.

## Goal

Ship `@binderly/api-client` — the single typed HTTP client every
Binderly consumer (web, mobile, scanner, shareable SSR) uses to
talk to the Binderly backend (Supabase PostgREST + Edge Functions
+ future Fly services). The client:

1. Sits on top of `@binderly/api-contracts`: every outbound
   request body is parsed with the relevant write schema **before
   the wire round-trip** (fail fast on bad payloads); every
   inbound response is parsed with the relevant read schema (so
   backend drift surfaces as a typed `ApiResponseDecodeError`
   rather than a quietly-wrong field at render time).
2. Sits on top of `@binderly/auth` ergonomically: the client
   accepts a `getJwt: () => Promise<string | null>` injection so
   it never bakes in a particular token-store. Web wires a
   browser-localStorage adapter; mobile wires `expo-secure-store`;
   server-side callers wire `@binderly/auth`'s session helpers.
3. Maps every non-2xx response into a typed `ApiError` subclass
   (`ApiUnauthorizedError`, `ApiForbiddenError`, `ApiNotFoundError`,
   `ApiConflictError`, `ApiRateLimitError`, `ApiValidationError`,
   `ApiServerError`, `ApiNetworkError`, `ApiResponseDecodeError`)
   so consumers can branch on `instanceof` or `error.code` without
   inspecting status codes.

This package is the **stitch** between the wire contracts (api-
contracts) and the consumer apps (web / mobile / scanner). Without
it, every app would re-implement fetch + parse + error-translate
plumbing.

## Non-goals (explicit)

- **No route registration.** This client describes the **shape**
  of the calls (URL path, headers, body, response). The actual
  route handlers live in T-BE-EDGE-FUNCTIONS / future Fly services.
- **No business logic.** Smart-DSL evaluation, set-completion
  math, pricing display formatting all live in their own
  packages. The api-client returns DTOs verbatim.
- **No client-side state caching layer.** No tanstack-query, no
  swr, no zustand store. Consumers wire those on top of the
  client. Per D2.
- **No retry / back-off / offline queue.** PROJECT.md §11 lists
  offline sync as a Phase 9 concern (T-OS-*); we don't pre-empt
  that decision here. Per Escalation triggers.
- **No telemetry / Sentry instrumentation.** Consumers add their
  own breadcrumbs around the client.
- **No file uploads to R2.** Presigned-URL flow lives in
  T-BE-EDGE-FUNCTIONS. The client posts the resulting URLs once
  the upload completes.
- **No multi-tenant / multi-project support.** A client instance
  is wired to one Supabase project at construction time.
- **No real network round-trips in tests.** Per `rules/02-backend.md`
  § Tests. Mocked `fetch` only.

## Decisions (numbered — these are the elaboration outputs)

### D1 — Package shape

A new pnpm workspace package at `packages/api-client/` named
`@binderly/api-client`. Same layout as `@binderly/api-contracts`
and `@binderly/auth`:

- `package.json` with `main` + `types` + `exports` map at day one
  (Q-004 posture — avoid the dist-paths-not-resolvable trap).
- `tsconfig.json` extending `@binderly/tsconfig/library.json`.
- `eslint.config.mjs` extending `@binderly/eslint-config/node`.
- `vitest.config.ts` (vitest 2.x; `globals: false`,
  `environment: 'node'`, v8 coverage).
- `src/` with one file per module (D2) + a barrel `index.ts`.
- `README.md` documenting the public API + the `getJwt` injection
  pattern + the validation policy.

Runtime dependencies:

- `@binderly/api-contracts` (workspace) — schemas.
- `@binderly/auth` (workspace) — types + the optional adapter for
  server-side callers; the auth-resource module re-exports a
  small surface so consumers don't have to import two SDKs.
- `@supabase/supabase-js` (peer) — the auth-resource module
  delegates client-side interactive flows (OAuth, magic-link, sign-
  out) to the SDK. **No** `node-fetch` (this package ships in
  every runtime including browsers + RN + edge).
- `zod` (peer; through api-contracts) — schemas re-exported.

### D2 — Module split

Mirrors the api-contracts domain split. One module per resource;
the core lives in `client.ts` / `error.ts` / `env.ts`.

| File | Purpose |
|---|---|
| `src/env.ts` | Typed env loader (`API_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`); throws on missing keys. Mirrors `@binderly/auth`'s `env.ts`. |
| `src/error.ts` | `ApiError` base + nine typed subclasses (D5). Status-code → subclass mapping. `parseApiError(response)` reads the `apiErrorSchema` envelope when present. |
| `src/client.ts` | `HttpClient` core — fetch wrapper, header injection (`apikey` + `Authorization: Bearer <jwt>`), JSON encoding, response decode + envelope unwrap, status-code translation. Takes a `getJwt` callback at construction. Injectable `fetch` for tests. |
| `src/resources/cards.ts` | `listSets`, `getSet`, `listCardsInSet`, `getCard`, `getPrinting`, `listPrintingsForCard`. Returns `SetDto` / `CardWithPrintingsDto` / `PrintingWithContextDto` / paginated wrappers. |
| `src/resources/collection.ts` | `listCollectionItems`, `addCollectionItem`, `updateCollectionItem`, `deleteCollectionItem`; custom-collection CRUD (`listCustomCollections`, `getCustomCollection`, `createCustomCollection`, `updateCustomCollection`, `deleteCustomCollection`); manual-collection items (`addPrintingToCustomCollection`, `removePrintingFromCustomCollection`); smart-rule (`getSmartCollectionRule`, `updateSmartCollectionExpression`). |
| `src/resources/pricing.ts` | `getCurrentPrice` (over `mv_current_price`), `getPriceHistory` (over `price_aggregate`), `listMarkets` (over the `market` catalog), `getFxRate(date, currency)`. |
| `src/resources/grading.ts` | `submitGradingPrediction`, `getGradingSubmission`, `listGradingSubmissions`, `attachActualGrade`, `updateGradingSubmissionStatus`. |
| `src/resources/shareables.ts` | Owner CRUD: `listShareables`, `createShareable`, `updateShareable`, `deleteShareable`. Public read: `getPublicShareable({ handle, slug })` (anonymous; no JWT required). |
| `src/resources/auth.ts` | Thin wrapper over the Supabase JS SDK's `auth.signInWithOAuth`, `auth.signInWithOtp` (magic link), `auth.exchangeCodeForSession` (PKCE callback), `auth.signOut`, `auth.getSession`. Optional injection point `supabaseAuth` so consumers can share the SDK instance with their own session listeners. Returns `SessionDto`-shaped values; raw SDK errors wrap in `ApiAuthError`. |
| `src/resources/profile.ts` | `getMyProfile`, `updateMyProfile`, `getMySubscription`. The "/me" endpoints that need a JWT. Split out from `auth.ts` because auth is interactive flows; profile is data CRUD. |
| `src/index.ts` | Public barrel + `createClient({ baseUrl, apiKey, getJwt, fetch?, supabaseAuth? })` factory returning `{ cards, collection, pricing, grading, shareables, auth, profile }`. |

Test files colocated as `<file>.test.ts`.

### D3 — `createClient` factory + injection contract

The single public entry point. Returns a frozen object whose
properties are the resource namespaces. Construction is cheap
(no I/O) so consumers may freely re-create per request on the
server-side or memoize for the lifetime of the app on the
client-side.

```ts
export interface CreateClientConfig {
  /** Base URL for the Binderly backend (e.g. https://abc.supabase.co). */
  readonly baseUrl: string;
  /** Supabase anon key (a public-by-design value safe to ship to clients). */
  readonly apiKey: string;
  /** Returns the current user JWT, or null for anonymous calls. */
  readonly getJwt: () => Promise<string | null> | string | null;
  /** Optional fetch override (tests inject a stub here). Defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch;
  /**
   * Optional Supabase JS client for the auth resource. If omitted, the
   * auth resource builds its own internally on first use. Provide your
   * own when you want to share the session listener / persistence with
   * the rest of your app.
   */
  readonly supabaseAuth?: SupabaseClient;
  /**
   * Optional default headers (e.g. `'x-binderly-app': 'web'`).
   * Merged with the per-request headers; per-request wins on collision.
   */
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export interface BinderlyClient {
  readonly cards: CardsResource;
  readonly collection: CollectionResource;
  readonly pricing: PricingResource;
  readonly grading: GradingResource;
  readonly shareables: ShareablesResource;
  readonly auth: AuthResource;
  readonly profile: ProfileResource;
}

export function createClient(config: CreateClientConfig): BinderlyClient;
```

Rationale for the `getJwt` callback shape:

- **Pull, not push.** A `setJwt` API would force consumers to wire
  a refresh listener; a `getJwt` callback lets the supabase-js
  client (or whatever store) be the source of truth. Each request
  resolves the freshest token at call time.
- **Returns string | null.** Anonymous calls (catalog reads,
  public shareable reads) skip the `Authorization` header entirely
  but still send `apikey`. Supabase requires both for any
  authenticated call; the apikey is required even for anonymous
  catalog reads.
- **Allows sync or async return.** Mobile / web stores are
  synchronous; server-side `@binderly/auth` integrations might
  prefer async (e.g. read from a cookie store with promise APIs).

### D4 — Validation policy (outbound + inbound)

**Outbound** (request bodies):
- Every write method calls `<writeSchema>.parse(input)` **before**
  encoding to JSON. A failure throws `ApiValidationError`
  synchronously with `error.zodIssues` populated. This catches
  caller bugs at the call site instead of round-tripping through
  PostgREST and getting back a less-useful 4xx.

**Inbound** (response bodies):
- The api-contracts result envelope (`apiResultSchema(<dto>)`) is
  always the outermost shape. The client first parses with the
  envelope. If `ok: false`, the client throws the appropriate
  `ApiError` subclass (`error.code` → subclass; see D5). If
  `ok: true`, the client parses `data` with the inner DTO schema.
- A schema failure during parse (envelope-level OR data-level)
  throws `ApiResponseDecodeError` carrying the raw response body
  + the zod error. This makes backend drift loud rather than
  silent. Per `rules/02-backend.md` ("One source of truth for
  types … write a contract test that proves it").
- Empty 204 responses (DELETE) return `void` and skip parsing.

Direct PostgREST responses (which return raw arrays /objects, not
the `apiResult` envelope) are NOT in scope for this package's v1.
The Edge Function layer wraps everything in the envelope; this
client always assumes the envelope. If a downstream task ever
needs raw PostgREST access, it imports `@binderly/auth`'s
`createUserScopedClient` directly and uses the SDK.

### D5 — Error taxonomy

```ts
class ApiError extends Error {
  readonly code: ApiErrorCode;        // from api-contracts API_ERROR_CODES + extras
  readonly status?: number;            // HTTP status; absent for ApiNetworkError
  readonly details?: unknown;          // server-provided details (zod issues, ...)
  readonly requestId?: string;         // from response headers when present
  readonly cause?: unknown;            // original Error / Response when relevant
}

class ApiValidationError extends ApiError {       // 400, code: 'VALIDATION'
  readonly zodIssues?: z.ZodIssue[];
}
class ApiUnauthorizedError extends ApiError {     // 401, code: 'AUTH'
}
class ApiForbiddenError extends ApiError {        // 403, code: 'AUTH'
}
class ApiNotFoundError extends ApiError {         // 404, code: 'NOT_FOUND'
}
class ApiConflictError extends ApiError {         // 409, code: 'CONFLICT'
}
class ApiRateLimitError extends ApiError {        // 429, code: 'RATE_LIMIT'
  readonly retryAfterSeconds?: number;             // from Retry-After header
}
class ApiServerError extends ApiError {           // 500-599, code: 'INTERNAL'
}
class ApiNetworkError extends ApiError {          // fetch reject, code: 'NETWORK'
}
class ApiResponseDecodeError extends ApiError {   // zod parse fail, code: 'DECODE'
  readonly rawBody: unknown;
  readonly zodError: z.ZodError;
}
class ApiAuthError extends ApiError {             // SDK auth-flow failure, code: 'AUTH'
}
```

Mapping rules in `error.ts`:

1. `fetch` reject → `ApiNetworkError`.
2. Response is non-2xx → read body, attempt to parse as
   `apiErrorSchema`; map by code first, fall back to status code:
   - `code: 'VALIDATION'` or status 400 → `ApiValidationError`
   - status 401 → `ApiUnauthorizedError`
   - status 403 → `ApiForbiddenError`
   - status 404 → `ApiNotFoundError`
   - status 409 → `ApiConflictError`
   - status 429 → `ApiRateLimitError` (read `Retry-After`)
   - status 5xx → `ApiServerError`
   - other → generic `ApiError`
3. Response is 2xx but envelope parse fails → `ApiResponseDecodeError`.
4. Response is 2xx, envelope says `ok: false` → resolve via
   the same code → subclass map.
5. Response is 2xx, envelope `ok: true`, inner data parse fails →
   `ApiResponseDecodeError`.

`requestId` is read from the `x-request-id` response header when
present (PROJECT.md doesn't pin a header name; this is the de-
facto convention). Edge Functions and Fly services emit it.

### D6 — Test posture

Vitest, mocked `fetch` injected via the `createClient({ fetch })`
parameter. The mocked `fetch` returns a small `Response`-shaped
helper (`createMockFetch({ status, body, headers })`).

Coverage target (mirroring `@binderly/api-contracts`'s 187 tests):

- **env.ts:** missing keys, partial keys, valid load, default `process.env`.
- **error.ts:** every status-code → subclass mapping;
  `apiErrorSchema` envelope parsing; `Retry-After` extraction;
  `requestId` extraction; `instanceof` chain (`ApiUnauthorizedError
  instanceof ApiError`).
- **client.ts:** header injection (`apikey` always; `Authorization`
  only when JWT present); body encoding; query-string encoding;
  envelope unwrap; signal forwarding (cancellation); default
  headers merge order; `getJwt` is awaited.
- **resources/cards.ts:** at least one happy path per method; one
  network failure; one decode failure; one 404.
- **resources/collection.ts:** happy path per method; outbound
  validation failure (bad `addCollectionItemRequest` payload —
  missing `printingId`, bad enum, `quantity: 0`); inbound decode
  failure; 401 for an authenticated method called without a JWT.
- **resources/pricing.ts:** happy path for `getCurrentPrice` /
  `getPriceHistory`; query-string includes `gradeTier` /
  `market` / `period` correctly.
- **resources/grading.ts:** happy path per method; outbound
  validation (e.g. `cornerUrls` length != 4 throws
  `ApiValidationError`); inbound decode.
- **resources/shareables.ts:** owner CRUD happy paths; public
  shareable read does NOT call `getJwt` (anonymous path).
- **resources/auth.ts:** delegates to injected `SupabaseClient`
  (mocked); error from SDK wraps in `ApiAuthError`; `getSession`
  returns `SessionDto`-shape on success and `null` when no
  session.
- **resources/profile.ts:** happy path for `getMyProfile`;
  outbound validation for `updateMyProfile`; inbound decode for
  `getMySubscription`.

Target ≈ 150-200 tests total. Distribution will land roughly:
env 8 / error 30 / client 35 / cards 25 / collection 30 /
pricing 18 / grading 18 / shareables 18 / auth 12 / profile 8.
Will adjust during implementation; the exact counts land in
"Notes from execution".

### D7 — URL conventions + request shapes

The client codifies the URL paths the Edge Functions will own.
T-BE-EDGE-FUNCTIONS is responsible for matching these. Picked
per RESTful conventions and matched against the api-contracts
DTO names:

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/sets` | List sets, paginated by cursor. |
| GET | `/v1/sets/{id}` | One set by id. |
| GET | `/v1/sets/{id}/cards` | List cards in set, paginated. |
| GET | `/v1/cards/{id}` | One card with printings inlined. |
| GET | `/v1/printings/{id}` | One printing with card+set inlined. |
| GET | `/v1/printings/{id}/prices/current` | mv_current_price row(s). |
| GET | `/v1/printings/{id}/prices/history` | price_aggregate window. |
| GET | `/v1/markets` | Catalog of markets. |
| GET | `/v1/fx-rates/{date}/{currency}` | One FX rate. |
| GET | `/v1/me/profile` | Current user's profile. |
| PATCH | `/v1/me/profile` | Update profile. |
| GET | `/v1/me/subscription` | Current user's subscription. |
| GET | `/v1/me/collection` | List collection items. |
| POST | `/v1/me/collection` | Add a collection item. |
| PATCH | `/v1/me/collection/{id}` | Update a collection item. |
| DELETE | `/v1/me/collection/{id}` | Delete a collection item. |
| GET | `/v1/me/custom-collections` | List custom collections. |
| GET | `/v1/me/custom-collections/{id}` | One custom collection. |
| POST | `/v1/me/custom-collections` | Create a custom collection. |
| PATCH | `/v1/me/custom-collections/{id}` | Update a custom collection. |
| DELETE | `/v1/me/custom-collections/{id}` | Delete a custom collection. |
| POST | `/v1/me/custom-collections/{id}/items` | Add a printing to manual collection. |
| DELETE | `/v1/me/custom-collections/{id}/items/{printingId}` | Remove a printing. |
| GET | `/v1/me/custom-collections/{id}/smart-rule` | Read the smart-rule. |
| PUT | `/v1/me/custom-collections/{id}/smart-rule` | Replace the expression. |
| GET | `/v1/me/grading` | List grading submissions. |
| POST | `/v1/me/grading` | Submit a prediction. |
| GET | `/v1/me/grading/{id}` | One grading submission. |
| PATCH | `/v1/me/grading/{id}/status` | Flip status. |
| POST | `/v1/me/grading/{id}/actual` | Attach actual grade. |
| GET | `/v1/me/shareables` | List owned shareables. |
| POST | `/v1/me/shareables` | Create a shareable. |
| PATCH | `/v1/me/shareables/{id}` | Update a shareable. |
| DELETE | `/v1/me/shareables/{id}` | Delete a shareable. |
| GET | `/v1/c/{handle}/{slug}` | Public render of a shareable. |

Body encoding: JSON with `content-type: application/json`.
Pagination: `?cursor=<opaque>&limit=<n>` query params; the
`limit` is optional (server picks the default).

### D8 — Request lifecycle

```
caller → resource method
  → outbound: validate request body via api-contracts schema
              (throws ApiValidationError on fail)
  → client.request({ path, method, body?, query?, headers?, signal? })
    → resolve getJwt() → token | null
    → headers := defaultHeaders ∪ {
          'apikey': apiKey,
          'authorization': token ? `Bearer ${token}` : skip,
          'content-type': body ? 'application/json' : skip,
          'accept': 'application/json',
       } ∪ caller-supplied headers
    → fetch(baseUrl + path + ?query, { method, headers, body, signal })
       on reject → ApiNetworkError
    → response handling:
      if status === 204 → return undefined
      else read body as JSON (or text fallback)
      if !ok → parseApiError(status, body) → throw matching subclass
      else → envelope.parse(body)
        if !envelope.ok → throw matching subclass
        else → dataSchema.parse(envelope.data) → return typed value
```

`signal` propagates `AbortSignal` from the caller — required for
React component cancellation.

### D9 — `auth` resource: Supabase SDK delegation

The `auth` resource is the one place this client diverges from
"thin HTTP wrapper". Sign-in flows are stateful (PKCE pairs,
OAuth redirects, cookie persistence) and the Supabase JS SDK
already owns them. The api-client therefore delegates rather
than re-implements:

```ts
interface AuthResource {
  signInWithOAuth(input: { provider: 'google' | 'apple' | 'discord'; redirectTo?: string }):
    Promise<{ url: string }>;
  signInWithMagicLink(input: { email: string; redirectTo?: string }):
    Promise<void>;
  exchangeCodeForSession(input: { code: string }):
    Promise<SessionDto>;
  signOut(): Promise<void>;
  getSession(): Promise<SessionDto | null>;
  getCurrentUser(): Promise<UserDto | null>;
}
```

Internally:
- If `supabaseAuth` is provided to `createClient`, that SDK
  instance is used (caller is responsible for `persistSession` /
  `autoRefreshToken` config — typically `true` for clients,
  `false` for server-side).
- If not, the client lazily builds its own with
  `createClient(baseUrl, apiKey)` from `@supabase/supabase-js`
  using browser-friendly defaults (`persistSession: true`,
  `autoRefreshToken: true`, `detectSessionInUrl: true`).
- Errors from the SDK wrap in `ApiAuthError`.

The `getJwt` callback typically reads from this same SDK — but
the client doesn't enforce that, since some apps use a
different store (e.g. server-side JWT in a cookie).

### D10 — Build / test setup

- `pnpm --filter @binderly/api-client build` — `tsc -p .` to
  `dist/` (declarations + sourcemaps; `composite: true`).
- `pnpm --filter @binderly/api-client test` — `vitest run`.
- `pnpm --filter @binderly/api-client lint` — `eslint
  --max-warnings=0 .`.
- `pnpm --filter @binderly/api-client typecheck` — `tsc -p .
  --noEmit`.
- `pnpm --filter @binderly/api-client format` /
  `format:check` — Prettier with `@binderly/prettier-config`.

### D11 — Public API discipline

`package.json` `exports` map declares only the root entry (`.`).
Consumers MUST import from `@binderly/api-client`. No deep
imports exposed. Same posture as `@binderly/api-contracts` and
`@binderly/auth`.

### D12 — Documentation

`packages/api-client/README.md` covers:

- What the package is (and is not).
- The public API at a glance + the `getJwt` injection pattern.
- The validation policy (outbound + inbound).
- The error taxonomy.
- Paste-able usage recipes (web with browser localStorage; server-
  side with `@binderly/auth`; tests with mocked `fetch`).
- The additive-only DTO evolution policy (inherited from
  api-contracts).

## Deliverables

### Files created

- `packages/api-client/package.json` — workspace
  `@binderly/api-client`, ESM, `main` + `types` + `exports`,
  scripts (build / typecheck / lint / format / format:check / test).
- `packages/api-client/tsconfig.json` — extends
  `@binderly/tsconfig/library.json`.
- `packages/api-client/eslint.config.mjs` — extends
  `@binderly/eslint-config/node`; ignores `dist/**`, `coverage/**`;
  relaxes `no-explicit-any` and `no-console` in test files
  (matches sibling pattern).
- `packages/api-client/vitest.config.ts` — vitest 2.x config.
- `packages/api-client/README.md` — package documentation (D12).
- `packages/api-client/src/env.ts`
- `packages/api-client/src/error.ts`
- `packages/api-client/src/client.ts`
- `packages/api-client/src/resources/cards.ts`
- `packages/api-client/src/resources/collection.ts`
- `packages/api-client/src/resources/pricing.ts`
- `packages/api-client/src/resources/grading.ts`
- `packages/api-client/src/resources/shareables.ts`
- `packages/api-client/src/resources/auth.ts`
- `packages/api-client/src/resources/profile.ts`
- `packages/api-client/src/index.ts` — barrel + `createClient`.
- Colocated `*.test.ts` files for every module.

### Files modified (outside `owns_paths`, pre-authorized in dispatch)

- `pnpm-lock.yaml` — regenerated by `pnpm install` for the new
  workspace.
- `dependencies.yaml` — flip `T-BE-API-CLIENT` `status: pending`
  → `status: review`. Set `stub: false`.
- `tasks/02-backend/T-BE-API-CLIENT.md` — this elaboration.

`pnpm-workspace.yaml` already includes `packages/*`; no edit
needed.

## Acceptance criteria

- [ ] `packages/api-client/` exists as a workspace with a valid
  `package.json` (`name: @binderly/api-client`, `private: true`,
  `type: module`, `main` + `types` + `exports` all set).
- [ ] Every module from D2 ships as `src/<module>.ts`.
- [ ] `src/index.ts` exports a `createClient(config)` factory
  matching the signature in D3.
- [ ] `createClient` returns a `BinderlyClient` with seven
  resource namespaces (`cards`, `collection`, `pricing`,
  `grading`, `shareables`, `auth`, `profile`).
- [ ] Every resource method that mutates state validates its
  input via the relevant `@binderly/api-contracts` write schema
  before encoding, throwing `ApiValidationError` synchronously
  on failure.
- [ ] Every resource method that returns data validates the
  inbound payload via the `apiResultSchema(<dto>)` envelope and
  the inner read schema, throwing `ApiResponseDecodeError` on
  failure.
- [ ] Status-code → error subclass mapping per D5: 400 →
  `ApiValidationError`, 401 → `ApiUnauthorizedError`, 403 →
  `ApiForbiddenError`, 404 → `ApiNotFoundError`, 409 →
  `ApiConflictError`, 429 → `ApiRateLimitError`, 5xx →
  `ApiServerError`, fetch reject → `ApiNetworkError`.
- [ ] All errors extend `ApiError` (single `instanceof` check
  suffices for "was this an api-client error?").
- [ ] Authenticated requests carry **both** `apikey` and
  `Authorization: Bearer <jwt>` headers (Supabase requires both).
  Anonymous requests carry only `apikey`.
- [ ] The `getJwt` callback is awaited at every request site
  (supports sync and async return).
- [ ] Public shareable read (`getPublicShareable`) does NOT call
  `getJwt` and does not require auth.
- [ ] No `node-fetch` import; the package uses `globalThis.fetch`
  (browser/RN/edge/node ≥ 18-compatible).
- [ ] Test suite ≥ 150 tests covering: env, error, client,
  cards, collection, pricing, grading, shareables, auth,
  profile.
- [ ] `pnpm --filter @binderly/api-client format:check` passes.
- [ ] `pnpm --filter @binderly/api-client lint` passes with
  `--max-warnings=0` (per `rules/02-backend.md`).
- [ ] `pnpm --filter @binderly/api-client typecheck` passes.
- [ ] `pnpm --filter @binderly/api-client test` passes.
- [ ] `pnpm --filter @binderly/api-client build` produces
  `dist/src/index.{js,d.ts}` resolvable via the package's
  `exports` map.
- [ ] Repo-wide `pnpm lint` / `pnpm typecheck` / `pnpm test` /
  `pnpm build` are all green (no regressions in other workspaces).
- [ ] No edits in `packages/api-contracts/` (read-only consumer).
- [ ] No edits in `packages/auth/` (read-only consumer).
- [ ] No edits in `packages/ui/` (parallel sibling owns it).
- [ ] No edits in `apps/`, `data-pipeline/`, or `infra/` (out
  of scope).
- [ ] `dependencies.yaml` flipped to `status: review`,
  `stub: false`.

## Out of scope

- Edge Function route handlers (T-BE-EDGE-FUNCTIONS).
- tanstack-query / swr integration (consumer-side concern).
- Offline-first queueing / retry / back-off (T-OS-* in Phase 9).
- Sentry instrumentation / structured logging (consumer-side).
- File uploads to R2 (T-BE-EDGE-FUNCTIONS owns the presigned-URL
  flow; this client posts the resulting URLs once upload
  completes).
- A web-only React-hooks layer (`useCards()`, `useMyCollection()`)
  — that lands in T-W-* tasks once the client is consumed.
- A mobile-only `@react-native-async-storage` token-store helper
  — T-M-AUTH wires that.
- Real network round-trips in tests.
- Multi-tenant / multi-project support.

## Branch & PR

- Branch: `agent/T-BE-API-CLIENT` (already created from
  `origin/main`).
- PR title: `T-BE-API-CLIENT: typed HTTP client over @binderly/api-contracts + @binderly/auth`
- Commit format: Conventional Commits.

PR body must include:

1. The design (especially the `getJwt` injection pattern in D3).
2. The validation policy (outbound + inbound, D4).
3. The error taxonomy (D5).
4. The test count.
5. The parallel-sibling note (T-SP-UI-TOKENS) + that the
   orchestrator merges.
6. Authorized out-of-`owns_paths` edits (`pnpm-lock.yaml`,
   `dependencies.yaml`, `tasks/02-backend/T-BE-API-CLIENT.md`).
7. Any non-obvious decisions (e.g. profile resource split out
   from auth, why no PostgREST direct-read, etc.).

## Escalation triggers

Stop and surface to orchestrator (via `open-questions.md`
append) if:

- A required dependency (`@binderly/api-contracts` or
  `@binderly/auth`) turns out to be missing a DTO this client
  needs. Do **not** modify those merged packages — escalate.
- A product decision is required:
  - **Anonymous catalog reads:** PROJECT.md doesn't pin the
    posture. The implementation defaults to "anonymous reads
    are allowed; the client sends only `apikey`". If the
    backend ever requires auth even for catalog reads, the
    client design accommodates it (the resource methods would
    need a JWT-required flag) but the default ships open.
  - **Offline / retry / back-off:** **deferred to Phase 9
    (T-OS-*)** per PROJECT.md §11. Not pre-empted here.
  - **State-management library (tanstack-query vs plain
    promise):** picked **plain promise client** per the
    dispatch's Escalation triggers ("pick plain client unless
    `rules/02-backend.md` says otherwise; flag if you decide
    differently"). `rules/02-backend.md` doesn't address this;
    plain promises stay framework-agnostic and let each app
    layer its own caching.
- A change is needed outside the pre-authorized files
  (`packages/api-client/**`, `pnpm-lock.yaml`,
  `dependencies.yaml`, `tasks/02-backend/T-BE-API-CLIENT.md`).
- The `apiResultSchema` envelope assumption breaks down (e.g. a
  legitimate need to call PostgREST directly bypassing the
  envelope).

## Notes from execution

_(Sub-agent appends here at end. Empty until then.)_
