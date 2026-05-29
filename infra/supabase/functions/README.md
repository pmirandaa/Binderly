# Binderly Supabase Edge Functions

Server-side mutation surface for the Binderly app — the destination
every `/v1/me/...` write the `@binderly/api-client` issues. Owned by
[`T-BE-EDGE-FUNCTIONS`](../../../tasks/02-backend/T-BE-EDGE-FUNCTIONS.md).

```
infra/supabase/functions/
├── README.md           ← this file
├── package.json        Standalone Node sub-project for tests (NOT in pnpm workspace)
├── tsconfig.json
├── vitest.config.ts
├── deno.jsonc          Deno import-map (production runtime)
├── _shared/            Re-usable helpers (auth, cors, errors, validation, db, routing)
│   ├── auth.ts
│   ├── contracts.ts    Mirror of @binderly/api-contracts write schemas
│   ├── cors.ts
│   ├── db.ts           User-scoped + service-role client factories
│   ├── dispatch.ts     The HTTP entry-point glue (buildEnv, dispatch, makeHandler)
│   ├── errors.ts       apiError / apiOk / ApiError / errorToResponse
│   ├── handlers/       Per-resource handler files
│   ├── request-id.ts
│   ├── routing.ts      normalizePathname / matchPattern / resolveRoute
│   ├── routes-table.ts The single source of truth for the v1 mux
│   ├── test-helpers.ts Shared fixtures + the fake Supabase client
│   └── validate.ts     Zod-backed body parser
└── v1/
    └── index.ts        Deno.serve(handler) — production entry point
```

## What ships

A single Supabase Edge Function called **`v1`** that handles every
`/v1/me/...` path the `@binderly/api-client` `collection` resource
calls:

| Method | Path                                              | Handler                     |
| ------ | ------------------------------------------------- | --------------------------- |
| GET    | `/v1/me/collection`                               | list (cursor + limit)       |
| POST   | `/v1/me/collection`                               | add (additive upsert)       |
| POST   | `/v1/me/collection/bulk`                          | transactional bulk update   |
| POST   | `/v1/me/collection/recompute-set-completion`      | deferred-202 stub           |
| PATCH  | `/v1/me/collection/:id`                           | update one row              |
| DELETE | `/v1/me/collection/:id`                           | delete one row              |
| GET    | `/v1/me/custom-collections`                       | list                        |
| POST   | `/v1/me/custom-collections`                       | create (manual or smart)    |
| GET    | `/v1/me/custom-collections/:id`                   | read one                    |
| PATCH  | `/v1/me/custom-collections/:id`                   | update                      |
| DELETE | `/v1/me/custom-collections/:id`                   | delete (cascades children)  |
| GET    | `/v1/me/custom-collections/:id/items`             | list manual members         |
| POST   | `/v1/me/custom-collections/:id/items`             | add a printing              |
| DELETE | `/v1/me/custom-collections/:id/items/:printingId` | remove a printing           |
| GET    | `/v1/me/custom-collections/:id/smart-rule`        | read the rule               |
| PUT    | `/v1/me/custom-collections/:id/smart-rule`        | replace the rule expression |
| GET    | `/v1/me/entitlements`                             | RC-derived entitlement read (T-PB-ENTITLEMENTS) |

> **`GET /v1/me/entitlements`** (T-PB-ENTITLEMENTS) reads RevenueCat —
> the unified source of truth — via the RC REST subscriber endpoint and
> returns `entitlementsDto` (`{ tier, activeFeatures, source, checkedAt }`).
> It mirrors the small RC read + canonical PROJECT.md § 16 feature model
> from `@binderly/entitlements` (the production Deno bundle can't import
> workspace packages — same reason `_shared/contracts.ts` mirrors
> `@binderly/api-contracts`). **Fail-closed / env-degrade:** when
> `REVENUECAT_SECRET_API_KEY` is unset, or RC errors / times out /
> returns a malformed body, the handler returns
> `{ tier: 'free', source: 'fallback' }` with a **200** (never a 500) +
> a logged warning. Auth still fails closed (401 for anonymous callers).

Every response is the canonical
`@binderly/api-contracts` envelope:

```jsonc
// success
{ "ok": true, "data": <DTO> }

// failure
{ "ok": false, "error": { "code": "VALIDATION", "message": "...", "details": ... } }
```

## URL routing — why one mux instead of many functions

The merged `@binderly/api-client` calls `${supabaseUrl}/v1/me/...`
URLs directly. Supabase Edge Functions are natively served at
`${supabaseUrl}/functions/v1/<name>`. Two options for closing the
gap:

1. Build per-operation Edge Functions (`add-to-collection`,
   `update-collection-item`, …). Requires either a reverse proxy that
   rewrites the api-client paths to the per-function paths, or a
   refactor of the merged api-client (out of scope — different task's
   `owns_paths`).
2. Build ONE Edge Function called `v1` that handles every `/me/...`
   sub-path internally. Production deployment uses a thin reverse-
   proxy rewrite (`/v1/*` → `/functions/v1/v1/*`); local dev sets the
   api-client `baseUrl` to `${SUPABASE_URL}/functions/v1/v1` (or runs
   a tiny rewrite shim).

We picked **(2)**. Rationale: matches the api-client URL contract
exactly with no churn to merged code, smaller cold-start surface (one
function vs ten), and the per-operation organization is preserved
inside `_shared/handlers/*.ts` so reading the code still feels like
"one handler per logical operation". The trade-off — one file gets
all the `/me/...` traffic — is acceptable at MVP scale; splitting
into multiple functions is a straightforward refactor if cold-start
or latency telemetry says so later.

The dispatcher (`_shared/dispatch.ts`) accepts every plausible
incoming URL flavor by stripping known proxy prefixes before
matching:

- `/v1/me/collection` (api-client baseUrl = supabase URL + reverse proxy)
- `/me/collection` (api-client baseUrl = `${supabaseUrl}/functions/v1/v1`)
- `/functions/v1/v1/me/collection` (raw Supabase URL with no rewrite)
- `/v1/v1/me/collection` (Supabase deploy where function name is `v1`)

See `_shared/routing.ts` for the `normalizePathname` implementation
and `_shared/routing.test.ts` / `v1/index.test.ts` for the URL
flavor matrix.

## RLS posture

Every mutation handler (and every read handler) goes through
`requireUser(...)` (`_shared/db.ts`), which:

1. Extracts the `Authorization: Bearer <jwt>` header.
2. Decodes the JWT locally to fail fast on obviously bad tokens.
3. Round-trips through `supabase.auth.getUser(jwt)` for the actual
   signature + not-revoked check (the trust boundary).
4. Returns a `SupabaseClient` whose every PostgREST call carries the
   same `Authorization: Bearer <jwt>` header — so the Postgres role
   resolves to `authenticated` and RLS keys `auth.uid() = sub` to the
   JWT's subject.

The service-role client (`createServiceRoleClient`) is reserved for
admin-style paths where the caller doesn't have permission to read
aggregate state — currently only the deferred
`recompute-set-completion` stub references it (and only as part of
the documented future migration; today's stub doesn't bypass RLS).

## Test posture

Vitest runs ~120 cases:

| File                                              | Coverage                                         |
| ------------------------------------------------- | ------------------------------------------------ |
| `_shared/auth.test.ts`                            | bearer extraction, claim decoding, expiry, role  |
| `_shared/contracts.test.ts`                       | mirrored zod schemas (drift control)             |
| `_shared/cors.test.ts`                            | preflight, allow-list, expose-headers            |
| `_shared/db.test.ts`                              | client factories, requireUser, error translation |
| `_shared/dispatch.test.ts`                        | env build, dispatch, 404/405/INTERNAL paths      |
| `_shared/errors.test.ts`                          | envelope shapes, ApiError, errorToResponse       |
| `_shared/handlers/collection.test.ts`             | every collection_item route + idempotency + bulk |
| `_shared/handlers/customCollections.test.ts`      | every custom_collection route + smart-rule       |
| `_shared/handlers/recomputeSetCompletion.test.ts` | deferred-202 contract                            |
| `_shared/request-id.test.ts`                      | request-id propagation + minting                 |
| `_shared/routing.test.ts`                         | path normalization + pattern matching            |
| `_shared/validate.test.ts`                        | zod-backed JSON body parsing                     |
| `v1/index.test.ts`                                | URL flavor matrix + CORS + envelope contract     |

Tests use a hand-rolled `FakeSupabaseClient` (`_shared/test-helpers.ts`)
that records every method call and returns programmable outcomes per
table. **No live Supabase instance is required.**

### Running tests

```bash
cd infra/supabase/functions
pnpm install        # one-time; this directory is NOT in the pnpm workspace
pnpm test           # vitest run
pnpm typecheck      # tsc --noEmit
```

Why the standalone install? `infra/supabase/functions/` is an Edge
Function bundle, NOT a workspace package — production deploys via
`supabase functions deploy` which has its own runtime contract
(Deno + import-map). Adding the directory to `pnpm-workspace.yaml`
would be incorrect (it's not a Node package consumers depend on);
keeping it standalone matches the deploy reality.

## Local dev

The Supabase CLI runs the function locally on Deno via:

```bash
# From repo root:
pnpm db:start                                 # start the local Supabase stack (Docker)
pnpm exec supabase functions serve v1 --workdir infra
```

The function is then reachable at:

```
http://localhost:54321/functions/v1/v1/me/...
```

To exercise it from `apps/web` against the local stack, set:

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321/functions/v1/v1
```

(this routes the api-client's `${baseUrl}/v1/me/...` to the right
function URL). For production, the URL rewrite belongs to the CDN /
Vercel layer; the api-client itself never has to know about
`/functions/v1/v1`.

### curl smoke recipe

```bash
TOKEN=<get-from-supabase-cli-or-app-session>

curl -X POST http://localhost:54321/functions/v1/v1/me/collection \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-request-id: smoke-$(date +%s)" \
  -d '{"printingId":"33333333-3333-4333-8333-333333333333","quantity":1}'
```

Expected `200` (or `201` on a fresh insert) with body
`{"ok":true,"data":{...}}`.

### Env contract

| Var                         | Purpose                                                   |
| --------------------------- | --------------------------------------------------------- |
| `SUPABASE_URL`              | The supabase project URL (set automatically by the CLI)   |
| `SUPABASE_ANON_KEY`         | The anon key (set automatically by the CLI)               |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — `supabase secrets set` for production  |
| `CORS_ALLOW_ORIGINS`        | Comma-separated list, `*` for permissive (default in dev) |
| `REVENUECAT_SECRET_API_KEY` | **Optional.** RC secret REST key for `/v1/me/entitlements`. Unset → endpoint fail-closes to free tier (never 500). |
| `REVENUECAT_API_BASE_URL`   | **Optional.** RC REST base URL override (defaults to `https://api.revenuecat.com`). |

## Deployment

```bash
# From repo root:
pnpm exec supabase functions deploy v1 --workdir infra
```

The CLI bundles the function source + import-map (`deno.jsonc`) and
ships it to your Supabase project. Verify with:

```bash
curl -X OPTIONS https://<project-ref>.supabase.co/functions/v1/v1/me/collection \
  -H "Origin: https://binderly.app"
# expect 204 with access-control-allow-origin: https://binderly.app
```

## Mirrored contracts — drift control

`_shared/contracts.ts` mirrors the WRITE schemas from
`@binderly/api-contracts/collection.ts`. The mirror is intentional —
the supabase deploy bundles only the Edge Function source, not the
workspace, so the contracts package can't be imported in production.
The mirror tests (`_shared/contracts.test.ts`) round-trip
representative payloads through the mirrored schemas; if the
canonical contracts evolve, update both files in the same PR. The
mirror covers:

- `addCollectionItemRequest`
- `updateCollectionItemRequest`
- `bulkUpdateCollectionRequest` (NEW — owned by this task; not yet in `api-contracts`)
- `createCustomCollectionRequest`
- `updateCustomCollectionRequest`
- `addPrintingToCustomCollectionRequest`
- `updateSmartCollectionExpressionRequest`

## Deferred-recompute contract

`POST /v1/me/collection/recompute-set-completion` returns:

```jsonc
HTTP/1.1 202 Accepted
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "recompute-set-completion is deferred until T-SP-SET-COMPLETION ships.",
    "details": { "deferred": true, "deferredReason": "...", "retryAfterSeconds": null }
  }
}
```

The `202` status (rather than `404`) signals "request accepted, work
deferred". The api-client's typed branch keys on `error.code`, which
is `NOT_FOUND` because the canonical enum doesn't yet have a
`DEFERRED` variant. When `T-SP-SET-COMPLETION` ships, swap the
handler body to invoke the recompute (using the service-role client
from `_shared/db.ts`) and return a `200` envelope.

## TODO markers

- `checkFreemiumLimits` (`_shared/handlers/customCollections.ts`) is
  a no-op pending `T-BE-AUTH`'s entitlements resolver. The contract
  is "free tier allows 3 manual + 0 smart custom collections"; the
  marker test asserts the function returns without throwing, so a
  future task can replace the body without breaking the suite.
- True transactional bulk update — currently approximated via a
  write-and-revert loop. A `SECURITY INVOKER plpgsql` RPC would let
  the dispatcher push the all-or-nothing semantics into a single
  Postgres statement. Tracked as a follow-up.
