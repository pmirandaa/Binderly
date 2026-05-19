# T-BE-EDGE-FUNCTIONS-V2 — 4 additive read endpoints unblocking frontend follow-ups

**Stage:** 02-backend
**Agent role:** backend
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-BE-EDGE-FUNCTIONS (merged) — the existing dispatcher + handler
  conventions every new route plugs into.
- T-DL-PRICING-CURRENT-VIEW (merged) — `mv_current_price` exists; the
  new `/v1/printings/:id/current-price` endpoint reads it.
- T-SP-SET-COMPLETION (merged) — pure-logic math package; new
  `/v1/me/collection/completion` endpoint runs the same math
  server-side on the user's collection rather than reading the
  not-yet-existent `mv_user_set_completion` / `mv_user_global_completion`
  materialized views.
- T-SP-SMART-DSL (merged) — `expressionToSql()` compiles a smart-
  collection expression to a parameterized WHERE clause; the new
  `/v1/smart-collections/preview` endpoint uses it.
- T-W-SHAREABLE-PUBLIC (merged) — declares the `PublicSharePayload`
  shape the new `/v1/c/{handle}/{slug}` endpoint must serve.

## Soft dependencies

- _(none)_

## Required reading

- `PROJECT.md` § 8 (Collection completion math), § 13 (Pricing),
  § 14 (Shareables)
- `rules/02-backend.md`
- `infra/supabase/functions/_shared/routes-table.ts` — dispatcher
  pattern.
- `infra/supabase/functions/_shared/handlers/collection.ts` —
  representative handler conventions (auth, envelope, errors).
- `infra/supabase/functions/_shared/contracts.ts` — mirrored write
  schemas; new endpoints add `smartPreviewRequest` here.
- `infra/supabase/functions/_shared/routing.ts` — `normalizePathname`
  must be widened to strip the leading `/v1/` for the new non-`/me/...`
  routes (`/v1/c/...`, `/v1/printings/...`, `/v1/smart-collections/...`).
- `packages/api-contracts/src/` — Zod DTO patterns; new DTOs land
  here.
- `packages/api-client/src/` — typed-client patterns; new methods
  land here.
- `packages/smart-collection-dsl/src/sql.ts` — `expressionToSql()`
  contract. Note the actual export name is `expressionToSql`
  (not `compileToSql` as the brief uses informally).
- `apps/web/lib/share/api.ts` — `PublicSharePayload` is the target
  shape for the public-shareable endpoint.
- `open-questions.md` § Q-010 (closed earlier — the materialized
  views were promised but never created) and § Q-012 (open — this
  PR closes it). Q-013 logs the new MV-missing decision.

## Goal

Ship four additive read endpoints in the existing `v1` Edge Function
so the frontend follow-ups logged in iters 17 / 18 / 20 can drop
their O(catalog) client-side stop-gaps and read O(1) authoritative
server data:

1. `GET /v1/me/collection/completion` — completion math for the
   authenticated user.
2. `GET /v1/printings/:id/current-price` — headline price for a
   single printing.
3. `GET /v1/c/{handle}/{slug}` — anonymous public-shareable payload
   that matches `PublicSharePayload`.
4. `POST /v1/smart-collections/preview` — preview the matching
   printings for a smart-collection expression.

All four are net-new routes; no existing handler is changed (the
shared `normalizePathname` is widened — see Decisions below).

## Deliverables

### Contracts (`packages/api-contracts/src/`)

- `collection.ts` — new `completionDto` + `perSetCompletionEntryDto`
  schemas matching the shape `apps/mobile/src/lib/collection/completion.ts`
  computes today (and `apps/web/lib/collection/*` will switch to).
- `pricing.ts` — new `printingCurrentPriceDto` schema (sibling of
  the existing `currentPriceDto` — see Q-013 for why we add a new
  DTO rather than reuse). Carries the `mv_current_price` columns we
  actually have + a `freshness` derived field; the trends columns
  named in `context/data-model.md` § `mv_current_price` are
  deferred (see Q-013).
- `shareables.ts` — new `publicShareableDto` matching the
  `PublicSharePayload` shape declared in `apps/web/lib/share/api.ts`
  (closes Q-012).
- `collection.ts` — new `smartPreviewRequestDto` +
  `smartPreviewResponseDto` (preview payload for the smart-rule
  endpoint).

### Client (`packages/api-client/src/`)

- `resources/collection.ts` — new `getCompletion()` method.
- `resources/pricing.ts` — new `getPrintingCurrentPrice({ printingId })`
  method (calls `/v1/printings/:id/current-price`; sibling to the
  existing `getCurrentPrice(...)` which calls the unwired
  `/v1/printings/:id/prices/current` endpoint and stays in place
  for backward compatibility).
- `resources/shareables.ts` — new `getPublicShareablePayload({
  handle, slug })` method (sibling to the existing
  `getPublicShareable`, returns the richer payload).
- New `resources/smartCollections.ts` — new resource module
  exposing `preview({ expression, limit, offset })`.

### Edge handlers (`infra/supabase/functions/_shared/handlers/`)

- `completion.ts` — `handleGetMeCompletion` (authed, reads
  `collection_item` + the catalog tables and runs
  `@binderly/set-completion`-equivalent math inline — the math
  package isn't on the Deno bundle's import path; the handler
  re-implements the small pure functions locally for the same
  reason `_shared/contracts.ts` mirrors the Zod schemas; the
  contract test in `completion.test.ts` round-trips a known input
  through both implementations).
- `currentPrice.ts` — `handleGetPrintingCurrentPrice` (authed,
  reads `mv_current_price`).
- `publicShareable.ts` — `handleGetPublicShareable` (anonymous;
  uses the service-role client to read across `profile`,
  `shareable`, `collection_item`, `printing`, `card`, `set`).
- `smartPreview.ts` — `handlePostSmartCollectionPreview` (authed,
  compiles the DSL expression to a PostgREST filter string via a
  small mirror of the smart-DSL compilation and executes against
  the joined `printing` + `card` + `set` catalog).

### Routing

- `routes-table.ts` — four new `entry(...)` rows.
- `routing.ts` — widen `normalizePathname` to strip the leading
  `/v1/` for any path (not just `/v1/me/...`), so the new
  `/v1/c/...`, `/v1/printings/...`, `/v1/smart-collections/...`
  routes can be matched by patterns without the `/v1` prefix.

### Mirrored schemas

- `_shared/contracts.ts` — mirror the new `smartPreviewRequestDto`
  shape so the Edge Function can validate without taking a
  workspace dependency on `@binderly/api-contracts`. Drift control
  test in `contracts.test.ts`.

## Acceptance criteria

- [ ] `GET /v1/me/collection/completion` returns
      `{ global: { allPokemonPct, masterPct, uniqueCardsOwned,
      uniqueCardsTotal, masterOwned, masterTotal }, perSet: [{
      setId, setCode, setName, setPct, masterPct, ownedNumbered,
      totalNumbered, ownedMaster, totalMaster }, ...] }` for the
      authenticated user. Authed-success, no-rows (empty
      collection → all zeros), JWT-missing → 401, and
      `x-request-id` propagation all tested.
- [ ] `GET /v1/printings/:id/current-price` returns
      `{ printingId, gradeTier, market, currency, periodStart,
      medianPrice, meanPrice, lowPrice, highPrice, sampleCount,
      computedAt }` for the requested printing's headline
      (default gradeTier = `RAW_NM`, default market = `EBAY_US`,
      both overridable via query params), or 404 if no row.
      Present-row, missing-row (404), invalid-uuid (400), and
      gradeTier override all tested.
- [ ] `GET /v1/c/{handle}/{slug}` returns the full
      `publicShareableDto` matching the `PublicSharePayload` shape
      expected by `apps/web/lib/share/api.ts`. Anonymous — no JWT
      header parsed. Populated-collection success, missing
      shareable (404), and zero-members (empty array, NOT 404)
      all tested.
- [ ] `POST /v1/smart-collections/preview` accepts
      `{ expression: <DSL AST>, limit?: number (default 200,
      max 500), offset?: number (default 0) }`, validates via the
      mirrored Zod schema, compiles to a PostgREST filter string,
      executes against the catalog, returns
      `{ items: [printing rows], totalCount: number,
      nextOffset: number | null }`. Happy path, syntax error
      (400 with VALIDATION envelope), pagination clamp, and
      auth-missing (401) all tested.
- [ ] `packages/api-contracts/src/` carries the new DTO schemas
      with Zod schemas + TypeScript types; each has a positive
      `.parse(...)` test and at least one negative parse-failure
      test.
- [ ] `packages/api-client/src/` carries the new client methods;
      each has a happy-path test and a 404 or auth-header test.
- [ ] `open-questions.md` marks Q-012 CLOSED with the PR HEAD
      and adds Q-013 (mv_user_set_completion + trends columns
      missing — proceeding with on-the-fly computation +
      reduced DTO).
- [ ] No new materialized views or migrations are added.
- [ ] CI green: pr-title, typecheck, lint, build, test.

## Out of scope

- Wiring the four new endpoints into web/mobile screens. Each
  remains a separate follow-up (#FU-17 frontend half;
  T-W-COLLECTION/T-M-COLLECTION switch from client-side compute
  to `getCompletion()`; T-W-SHAREABLE-PUBLIC adapter swap from
  degraded synthesis to direct call; T-W-SMART preview migration).
- Adding the missing materialized views
  (`mv_user_set_completion`, `mv_user_global_completion`). The
  brief explicitly forbids new MVs/migrations. Q-013 logs the
  divergence and recommends a follow-up MV task.
- Pre-computed trend / freshness columns on `mv_current_price`.
  Q-013 logs the divergence; the new DTO carries only the columns
  the MV actually has.
- Real-row execution of every smart-DSL operator. The preview
  endpoint translates the AST to a PostgREST filter string for a
  pragmatic subset (every `card.*` / `set.*` / `printing.*`
  predicate; the synthetic `collection.isOwned` and other
  `collection.*` predicates raise a 400 "preview unsupported for
  user-state predicates" — those are unblocked by the
  client-side evaluator that smart-collection-dsl ships).

## Branch & PR

- Branch: `agent/T-BE-EDGE-FUNCTIONS-V2`
- PR title: `feat(backend): T-BE-EDGE-FUNCTIONS-V2 — 4 additive read endpoints (completion, current-price, public-shareable, smart-preview)`
- Commit format: Conventional Commits. Five commits total: one
  per endpoint (contract + client + handler + tests, end-to-end)
  plus one closing Q-012 / opening Q-013.

## Decisions

- **D1. `normalizePathname` widening.** The existing implementation
  only strips `/v1/` from `/v1/me/...` paths. Widening it to strip
  the leading `/v1/` from any path is the minimal change to support
  the three new non-`/me/...` routes (`/v1/c/...`,
  `/v1/printings/...`, `/v1/smart-collections/...`). Existing route
  patterns and tests are unaffected.

- **D2. Completion math runs in the handler (no MV).** The
  `mv_user_set_completion` / `mv_user_global_completion` views
  described in `context/data-model.md` § "Materialized views"
  were never materialized — no migration creates them. The brief
  forbids new MVs. The handler therefore computes the same math
  in-process from `collection_item` + `card` + `printing` + `set`
  reads. Cost is bounded by the user's collection size plus the
  master-set roster scan (≤ ~30k rows total); acceptable for the
  v1 traffic profile. Logged as Q-013 with a follow-up MV task
  recommendation.

- **D3. New `printingCurrentPriceDto` rather than re-use of
  `currentPriceDto`.** The existing `currentPriceDto` requires
  `gradeTier` + `market` query params (the API was designed
  around the eventual "all markets / all grade tiers" UI). The
  new endpoint targets the simpler frontend follow-up "give me
  the one headline price for this printing" — defaulting to
  `RAW_NM` + `EBAY_US`. The new DTO is a strict subset of
  `currentPriceDto` plus a derived `freshness` field; existing
  consumers of `currentPriceDto` see no change.

- **D4. Service-role for the anonymous public-shareable read.**
  The anonymous endpoint cannot use the caller's session. Reading
  `profile` (public-read columns only) + `shareable` (public-read
  for active shareables) would work via the anon role, but
  joining through `collection_item` requires either an RLS policy
  carve-out (deep schema change) or service-role bypass. The
  brief explicitly allows service-role here. The handler reads
  ONLY the public-shareable-relevant columns and never exposes
  the row's `user_id` to the wire payload (the handle/displayName
  derived from `profile` is the only owner signal).

- **D5. Smart-preview compiles to PostgREST filter syntax rather
  than direct SQL.** Executing the `expressionToSql()` output
  directly would require either a SECURITY DEFINER RPC migration
  (forbidden — schema change) or a direct postgres connection
  (not how the Edge Function is wired today). Translating the
  AST to PostgREST `or(...,and(...))` filter strings keeps the
  query path on supabase-js with no schema change. Limitations:
  the synthetic `collection.isOwned` and other `collection.*`
  predicates are not supported in the preview (the API returns
  a 400 with a clear message); those run in the client-side
  evaluator that `@binderly/smart-collection-dsl` already ships.

## Escalation triggers

Stop and surface to orchestrator if:

- The materialized views in the brief turn out to exist after
  all (would simplify D2 — proceed with the MV read).
- The Q-013 follow-up recommendation needs to land before the
  client adapters can ship (it doesn't, but flagging if
  reviewers disagree).
- A new `acceptance_criteria` test reveals a contract mismatch
  with the iter-17/18/20 client code.

## Notes from execution

Worker (this PR):

- `mv_user_set_completion` and `mv_user_global_completion` are
  not present in any migration. Confirmed via repo grep
  (`packages/db/src/migrations/*.sql` — zero matches). Logged
  as Q-013; the completion endpoint computes on-the-fly.
- The existing `pricing.getCurrentPrice` client method calls
  `/v1/printings/:id/prices/current` which is not wired in
  `routes-table.ts`. Kept the existing method intact; the new
  endpoint is at the distinct path `/v1/printings/:id/current-price`
  and gets its own client method `getPrintingCurrentPrice` to
  avoid breaking the existing speculative method.
- `expressionToSql()` is the actual public name of the
  smart-collection-dsl SQL compiler (not `compileToSql()` as
  the brief uses informally). The preview handler uses a
  PostgREST filter-string mirror because the Deno bundle can't
  import workspace packages and the brief forbids RPC/migration
  workarounds.
