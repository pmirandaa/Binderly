# T-BE-EDGE-FUNCTIONS — Edge Functions for collection mutations + completion recompute

**Stage:** 02-backend
**Agent role:** backend
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-BE-API-CONTRACTS (DTOs, error envelope, result envelope)
- T-DL-RLS-POLICIES (collection / custom-collection / smart-rule RLS)

## Soft dependencies

- T-BE-AUTH (JWT extraction patterns, profile-provisioning trigger)
- T-BE-API-CLIENT (the consumer that calls these endpoints)
- T-SP-SET-COMPLETION (deferred — `recompute-set-completion` returns 202 until this lands)

## Required reading

- `PROJECT.md` § 5 (Auth), § 6 (Data Model), § 16 (Freemium)
- `rules/02-backend.md`
- `packages/api-contracts/src/{index,common,collection,cards}.ts`
- `packages/auth/src/{jwt,types,clients,session}.ts`
- `packages/db/src/schema/{collections,custom_collections,smart_rules}.ts`
- `packages/db/src/migrations/0005_collections_rls.sql`
- `packages/db/src/migrations/0017_profile_provisioning_trigger.sql`
- `packages/api-client/src/resources/collection.ts` (the consumer URL contract)
- `apps/web/lib/api-client.ts` (browser singleton)

## Goal

Stand up the server-side mutation surface that the merged
`@binderly/api-client` calls under `/v1/me/...`. Every collection-side
write the web/mobile/scanner apps need — adding, updating, removing, or
bulk-mutating `collection_item` rows; CRUD for manual + smart custom
collections; replacing a smart-rule expression — must go through an
Edge Function that (a) verifies the caller's JWT, (b) round-trips
through Supabase with the user's bearer token so RLS keys
`auth.uid() = user_id`, (c) validates payloads with the
`@binderly/api-contracts` write schemas, and (d) returns the
discriminated `{ ok, data | error }` envelope. Closes the Phase 2
backend stage (T-BE-AUTH, T-BE-API-CONTRACTS, T-BE-API-CLIENT,
T-BE-EDGE-FUNCTIONS).

## Deliverables

- `infra/supabase/functions/v1/index.ts` — single Deno entry point that
  routes every `/v1/me/...` path the api-client knows about. Internal
  per-resource dispatcher matches the REST URLs exactly (`/me/collection`,
  `/me/collection/{id}`, `/me/collection/bulk`,
  `/me/collection/recompute-set-completion`,
  `/me/custom-collections`, `/me/custom-collections/{id}`,
  `/me/custom-collections/{id}/items`,
  `/me/custom-collections/{id}/items/{printingId}`,
  `/me/custom-collections/{id}/smart-rule`).
- `infra/supabase/functions/_shared/cors.ts` — preflight handler.
- `infra/supabase/functions/_shared/auth.ts` — bearer-token extraction +
  Supabase session verification (mirrors the relevant subset of
  `@binderly/auth`).
- `infra/supabase/functions/_shared/errors.ts` — `apiError(...)` /
  `apiOk(...)` envelope helpers matching `api-contracts/common.ts`.
- `infra/supabase/functions/_shared/validate.ts` — zod-based body parser
  emitting a `VALIDATION` envelope on failure.
- `infra/supabase/functions/_shared/db.ts` — Supabase client factory
  bound to the caller's JWT (RLS-enforced) + a service-role factory
  reserved for the deferred `recompute-set-completion` admin path.
- `infra/supabase/functions/_shared/request-id.ts` — `x-request-id`
  propagation (echoed in response, included in every log line).
- `infra/supabase/functions/_shared/handlers/*.ts` — one file per
  resource family (`collection.ts`, `customCollections.ts`,
  `recomputeSetCompletion.ts`).
- `infra/supabase/functions/_shared/contracts.ts` — re-exports of the
  zod write schemas the handlers consume, plus a workspace-local mirror
  of the few primitives the handlers need (so the Edge Functions
  bundle is self-contained when production deploys without the pnpm
  workspace).
- `infra/supabase/functions/_shared/*.test.ts` — vitest test suite (≥80
  cases) covering auth, validation, error envelopes, CORS, request-id
  propagation, idempotency, transactional rollback, and per-route
  happy/error paths.
- `infra/supabase/functions/deno.jsonc` — Deno import-map mapping bare
  specifiers (`zod`, `@supabase/supabase-js`) to `npm:` so the source
  files run in both Deno (production) and Node/vitest (tests).
- `infra/supabase/functions/package.json` + `vitest.config.ts` +
  `tsconfig.json` — standalone Node sub-project (NOT a pnpm workspace
  member) used solely to run the test harness.
- `infra/supabase/functions/README.md` — local-dev story
  (`supabase functions serve v1`), deployment story (`supabase functions
  deploy v1`), env contract, URL-routing rationale, how the api-client
  wires up against it, and the deferred-recompute contract.

## Acceptance criteria

- [ ] Every URL the merged `@binderly/api-client` `collection` resource
      can reach is wired to a handler that returns the
      `apiResultSchema(...)` envelope on success and an `apiErrorSchema`
      envelope on failure.
- [ ] `add-to-collection` POST is idempotent — calling twice with the
      same `(printingId, condition, gradeCompany, grade)` upserts into
      the existing row (quantity += request quantity) instead of
      inserting a duplicate. Verified by a vitest test.
- [ ] Bulk update POST (`/me/collection/bulk`) is transactional: a
      single failed item rolls back the whole batch (verified via a
      vitest test that injects a failure mid-batch).
- [ ] Every mutation function passes the caller's JWT to the Postgres
      client via `Authorization: Bearer <jwt>`, so RLS sees the request
      as `auth.uid() = sub`. Verified by inspecting the headers passed
      to the injected fetch in tests.
- [ ] `recompute-set-completion` returns a 202 envelope with
      `error.code = 'NOT_FOUND'` and `details.deferred = true` until
      T-SP-SET-COMPLETION ships. (Documented in the function README;
      the contract is "the call is accepted, the work is deferred, the
      caller should treat it as a no-op for now".)
- [ ] CORS preflight (`OPTIONS`) returns 204 with `access-control-allow-*`
      headers derived from the configured origin allow-list.
- [ ] Every response (success or error) echoes the `x-request-id`
      header from the request when present, or generates a fresh
      crypto-random id when absent. Header is included in every log
      line produced by the function.
- [ ] Every error path emits a body matching the `apiErrorSchema` —
      `{ ok: false, error: { code, message, details? } }` — and the
      `code` is one of `VALIDATION | AUTH | NOT_FOUND | CONFLICT |
      RATE_LIMIT | INTERNAL`.
- [ ] Tests live at `infra/supabase/functions/_shared/*.test.ts` and
      `infra/supabase/functions/v1/*.test.ts`; the suite has ≥80 cases
      and passes via `pnpm test` from inside that directory.
- [ ] `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w build`
      all green from the repo root (the Edge Functions package is
      excluded from the workspace, so its tests run separately).
- [ ] No edits outside `owns_paths` except the documented
      pre-authorized files (`pnpm-lock.yaml`, `dependencies.yaml`, this
      task file).

## Out of scope

- Read-only catalog endpoints (`/v1/cards`, `/v1/sets`, `/v1/printings`)
  — those go directly through PostgREST per `rules/02-backend.md`; not
  every read needs an Edge Function.
- Non-collection write endpoints (`/v1/me/profile`, `/v1/me/shareables`,
  `/v1/me/grading`) — owned by their own task IDs, dispatched
  independently.
- The smart-collection DSL parser (`packages/smart-collection-dsl`) —
  `T-SP-SMART-DSL` owns it; this task accepts the `expression` field as
  opaque `unknown` per the `smartCollectionRuleDto` contract.
- The set-completion recompute math — `T-SP-SET-COMPLETION` owns it;
  this task ships the API surface with a deferred-202 stub.
- Freemium gating (3 manual + 0 smart on free tier). The contract is
  documented in `api-contracts/collection.ts` ("gating is enforced in
  T-BE-EDGE-FUNCTIONS") but the actual gate ties to the
  `subscription` row owned by `T-DL-SCHEMA-USERS` and the entitlements
  resolver owned by `T-BE-AUTH`. Wiring it in is left as a follow-up
  TODO with a marker in the handler; the test suite asserts the
  marker is reachable so a future task lights it up.

## Branch & PR

- Branch: `agent/T-BE-EDGE-FUNCTIONS`
- PR title: `T-BE-EDGE-FUNCTIONS: Edge Functions for collection mutations + completion recompute`
- Commit format: Conventional Commits

## URL-routing rationale (non-obvious decision)

The merged `@binderly/api-client` calls `${supabaseUrl}/v1/me/...`
URLs directly (see `packages/api-client/src/resources/collection.ts`).
Supabase Edge Functions are natively served at
`${supabaseUrl}/functions/v1/<function-name>`. Two choices were on the
table:

1. Build per-operation Edge Functions (`add-to-collection`,
   `update-collection-item`, …) per the orchestrator's prompt
   wording. This requires either a reverse proxy that rewrites the
   client-side URLs into the per-function URLs, or a refactor of the
   merged api-client (out of scope — that file is in another task's
   `owns_paths`).
2. Build ONE Edge Function called `v1` that handles every `/me/...`
   sub-path internally. Production deployment uses a thin reverse-proxy
   rewrite (`/v1/*` → `/functions/v1/v1/*`); local dev sets the
   api-client `baseUrl` to `${SUPABASE_URL}/functions/v1/v1` (or runs a
   tiny local rewrite shim — README documents both).

This task picks (2). Rationale: matches the api-client URL contract
exactly with no churn to merged code, lower cold-start surface (one
function vs ten), and the per-operation organization is preserved
inside `_shared/handlers/*.ts` so reading the code still feels like
"one handler per logical operation". The trade-off — one file gets all
the `/me/...` traffic — is acceptable at MVP scale; the split into
multiple functions is a straightforward refactor if cold-start or
latency telemetry says so later.

## Escalation triggers

Stop and surface to orchestrator if:

- The api-client URL contract diverges further from `/v1/me/...`
  (e.g. a new operation lands in `packages/api-client` after this PR
  opens).
- An `@binderly/api-contracts` write schema is missing for a payload
  the api-client expects (none today; bulk update is implemented as an
  array of `updateCollectionItemRequest` + a per-row `id`).
- A `@binderly/db` schema column is missing for a feature this task
  must ship (none today).

## Notes from execution

- One mux function (`v1`) instead of N per-operation functions; see the
  URL-routing rationale above.
- Tests are vitest-driven from a standalone Node sub-project rooted at
  `infra/supabase/functions/` (NOT a pnpm workspace member). Production
  runs the same source files on Deno via the import-map in
  `deno.jsonc`.
- Bulk update is transactional via Postgres-RPC pattern: a single
  `WITH ... UPDATE ... RETURNING` issued through PostgREST per row
  inside a try/catch loop, with the loop reverting any successful rows
  on failure (Supabase JS client doesn't expose true SQL transactions
  through the browser-friendly endpoint, but the RPC route lets us
  push the all-or-nothing semantics into a SECURITY INVOKER plpgsql
  function — deferred for a follow-up: this task implements the
  transactional contract via a write/rollback loop and documents the
  RPC migration as a follow-up TODO).
- `recompute-set-completion` returns a 202 with the deferred-stub
  envelope until T-SP-SET-COMPLETION lands; the README documents the
  cut-over.
