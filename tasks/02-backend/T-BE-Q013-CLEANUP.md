# T-BE-Q013-CLEANUP — Land Q-013's deferred backend pieces (MVs + smart-preview RPC)

**Stage:** 02-backend
**Agent role:** backend
**Effort:** L
**Status:** review

---

## Hard dependencies

- T-BE-EDGE-FUNCTIONS-V2 (merged) — the iter-21 PR that shipped the
  four read endpoints and intentionally deferred the MVs +
  smart-preview RPC.
- T-W-API-V2-WIRING (merged) — the web wiring against the V2 wire
  contracts. Wire shapes must not break.
- T-M-API-V2-WIRING (merged) — the mobile wiring against the V2 wire
  contracts. Same constraint.

## Soft dependencies

- _(none)_

## Required reading

- `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — the brief Q-013 was
  raised against; the current handler implementations + their
  documented divergences.
- `open-questions.md` § Q-013 — Pablo's directive ("if all required
  pieces are available, don't defer, do it now") + the context that
  shipped the on-the-fly compute + in-JS evaluator on iter-21.
- `infra/supabase/functions/_shared/handlers/completion.ts` — current
  on-the-fly completion handler (the one we swap to MV reads).
- `infra/supabase/functions/_shared/handlers/smartPreview.ts` —
  current in-JS evaluator preview handler (the one we swap to the
  RPC).
- `infra/supabase/functions/_shared/handlers/collection.ts` — current
  collection-mutation handlers (the ones we wire the MV refresh hook
  into).
- `infra/supabase/functions/_shared/contracts.ts` — the
  `previewExpressionSchema` mirror that rejects `collection.*` today.
- `packages/smart-collection-dsl/src/sql.ts` — the TS reference
  compiler we port to PL/pgSQL.
- `packages/smart-collection-dsl/src/types.ts` — the `FIELD_DEFS`
  allowlist (kind / sqlColumn / nullable) the SQL port mirrors.
- `packages/db/src/migrations/0013_mv_current_price.sql` — the one
  existing MV migration; copy its REVOKE + GRANT + UNIQUE-for-
  CONCURRENTLY posture.
- `packages/db/src/migrations/0017_profile_provisioning_trigger.sql`
  — the most recent hand-authored migration; pick the next free
  number after this (`0018`, `0019`). Also the canonical
  SECURITY DEFINER + `SET search_path = ''` pattern we mirror.
- `PROJECT.md` § 8 — Collection completion math spec.
- `rules/02-backend.md` — stage rules.

## Goal

Close out Q-013 by landing the two backend pieces T-BE-EDGE-
FUNCTIONS-V2 intentionally deferred. **Two surfaces in one PR**:

1. **Materialized completion views.** Author migrations for
   `mv_user_set_completion` + `mv_user_global_completion` per
   `PROJECT.md` § 8 with hand-authored access control + a refresh
   strategy, then swap the completion handler from on-the-fly
   compute to single SELECTs against the MVs. Wire the refresh hook
   into the collection-mutation handlers so the next read sees the
   user's latest add.
2. **Smart-preview RPC.** Author a migration for a
   `smart_collection_preview(ast jsonb, p_user_id uuid, p_limit int,
   p_offset int)` Postgres function that ports
   `expressionToSql()` to PL/pgSQL and unblocks `collection.*`
   predicates (previously rejected at the contract layer for being
   user-state-dependent). Swap the preview handler from in-JS
   evaluation to `client.rpc('smart_collection_preview', {...})`.
   Widen the `previewExpressionSchema` mirror to accept
   `collection.*` fields (contract widening, not a break).

Wire shapes (`completionDto`, `smartPreviewResponse`) do **not**
change — only the implementations swap.

## Deliverables

### Migrations

- `packages/db/src/migrations/0018_mv_user_completion.sql` (new) —
  hand-authored:
  - Materialized view `mv_user_set_completion(user_id, set_id,
    set_code, set_name, owned_unique, total_unique, owned_master,
    total_master, set_pct, master_pct)` — one row per
    `(user, set)` pair the user has progress in. The catalog row
    union (sets the user has zero progress in) is handled at the
    handler layer to keep the MV's row count bounded by the
    number of distinct sets touched by users, not the cross-product
    of (users × sets).
  - Materialized view `mv_user_global_completion(user_id,
    unique_cards_owned, total_cards, master_owned, master_total,
    all_pokemon_pct, master_pct)` — one row per user with at least
    one `collection_item`.
  - Unique indexes on `(user_id, set_id)` and `(user_id)` — required
    for `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
  - Wrapper views `v_my_set_completion` + `v_my_global_completion`
    that filter the underlying MVs by `auth.uid()`. These are the
    public surface the handler reads. Posture rationale in the
    "Decisions" section below.
  - SECURITY DEFINER function `public.refresh_user_completion()`
    that runs `REFRESH MATERIALIZED VIEW CONCURRENTLY` for both
    MVs. EXECUTE granted to `authenticated` + `service_role`.
  - REVOKE / GRANT posture identical in spirit to
    `0013_mv_current_price.sql`: MV is private; the wrapper view is
    the only authenticated-reachable surface.
- `packages/db/src/migrations/0019_smart_preview_rpc.sql` (new) —
  hand-authored:
  - Helper functions in `public._smart_*` namespace:
    `_smart_column_for(field text) -> text`,
    `_smart_kind_for(field text) -> text`,
    `_smart_literal(value jsonb, kind text) -> text`,
    `_smart_compile(node jsonb) -> text` (recursive AST walker).
    All locked down — EXECUTE revoked from PUBLIC, never granted to
    end-user roles.
  - Entry-point function
    `public.smart_collection_preview(ast jsonb, p_user_id uuid,
    p_limit int default 200, p_offset int default 0) RETURNS TABLE
    (printing_id uuid, card_id uuid, set_id uuid, card_name text,
    card_number text, set_name text, set_code text, variant_class
    text, variant_flags text[], image_small_url text, total_count
    bigint)` — runs the compiled WHERE clause against
    `printing JOIN card JOIN set LEFT JOIN collection_item` (with
    the user's `collection_item` rows pre-joined for the
    `collection.*` predicates) and returns the page + a window-
    function `COUNT(*) OVER ()` so the totalCount comes back in
    the same round-trip.
  - SECURITY DEFINER + explicit `auth.uid() = p_user_id` guard so
    a caller can only ever query their own user's collection.
  - EXECUTE granted to `authenticated`. REVOKEd from PUBLIC.

### Edge handlers (`infra/supabase/functions/_shared/handlers/`)

- `completion.ts` — swap the on-the-fly compute for two SELECTs
  against `v_my_set_completion` + `v_my_global_completion`. The
  set catalog read stays in place so per-set rows exist for sets
  the user has zero progress in (the brief preserves the existing
  wire shape; the home-screen list shows every set with 0%).
- `collection.ts` — after the additive-add, the update, the delete,
  and the bulk-update mutation responses, fire a best-effort
  `supabase.rpc('refresh_user_completion')`. Best-effort means: a
  refresh failure is logged via the request id and does NOT change
  the mutation's response envelope — the next read picks up the
  change on the next refresh.
- `smartPreview.ts` — swap the in-JS evaluator for a single
  `supabase.rpc('smart_collection_preview', {...})` call. The
  response items are mapped to `smartPreviewResponseDto`'s shape
  (no client churn).
- `evaluator-legacy.ts` (new, parked) — keep the in-JS evaluator
  + AST types here under a `// TODO: remove after T-BE-Q013-CLEANUP
  soaks` marker, so a fast revert is possible if the RPC has
  problems in production. One-iteration park.

### Contracts mirror (`_shared/contracts.ts`)

- Widen `ALLOWED_PREVIEW_FIELDS` to include the four
  `collection.condition`, `collection.gradeCompany`,
  `collection.grade`, `collection.quantity`, `collection.acquiredAt`,
  `collection.isOwned` field references the smart-DSL `FIELD_DEFS`
  registry tracks. Drop the previous explicit rejection. The
  widening is non-breaking — clients that didn't send
  `collection.*` continue to work; clients that want owner-scoped
  preview now can.

### Tests

- `infra/supabase/functions/_shared/handlers/completion.test.ts` —
  rewrite the data-source from the canonical-tables fan-out to the
  wrapper views. Existing wire-shape assertions stay (the handler
  contract is unchanged).
- `infra/supabase/functions/_shared/handlers/collection.test.ts` —
  add assertions that the refresh RPC is invoked after each
  mutation; that a refresh failure does NOT change the mutation's
  HTTP response.
- `infra/supabase/functions/_shared/handlers/smartPreview.test.ts` —
  rewrite the fake to enqueue `rpc:smart_collection_preview`
  outcomes. The previously-asserting-rejection
  `'rejects collection.* field references'` test flips to
  `'accepts collection.* field references'` + new positive coverage
  for `collection.isOwned`, `collection.grade`, etc.
- `infra/supabase/functions/_shared/test-helpers.ts` — extend the
  fake `SupabaseClient` to record + reply to `.rpc(name, args)`
  calls via the same outcome-queue mechanism `.from(table)` uses.
- `packages/db/scripts/verify-rls` — no inventory drift; the new
  MVs / wrapper views / RPC functions are additive and not on the
  RLS-asserted policy list (the wrapper view's `auth.uid()` filter
  is the access gate, not pg_policy rows). `pnpm --filter
  @binderly/db verify-rls` must still pass.

## Acceptance criteria

1. `0018_mv_user_completion.sql` exists; both MVs are created with
   UNIQUE indexes for `REFRESH CONCURRENTLY`; both wrapper views
   filter by `auth.uid()` and are granted to `authenticated`;
   `refresh_user_completion()` exists with `SECURITY DEFINER` +
   `SET search_path = ''` + EXECUTE granted to `authenticated`.
   SQL is hand-authored, no `drizzle-kit generate` artifacts.
2. `0019_smart_preview_rpc.sql` exists; the entry-point
   `smart_collection_preview` function exists with `SECURITY
   DEFINER` + `auth.uid() = p_user_id` guard + EXECUTE granted to
   `authenticated`. The recursive AST compiler is partitioned into
   `public._smart_*` helpers locked down to non-PUBLIC.
3. Completion handler reads from `v_my_set_completion` +
   `v_my_global_completion`; existing wire shape (`completionDto`)
   is byte-for-byte preserved.
4. Collection-mutation handlers (`add`, `update`, `delete`,
   `bulk`) issue a best-effort refresh RPC after the mutation;
   refresh failures do NOT change the mutation's HTTP response.
5. Smart-preview handler invokes the RPC via `.rpc(...)`; existing
   wire shape (`smartPreviewResponseDto`) is byte-for-byte
   preserved. The in-JS evaluator is parked at
   `_shared/handlers/evaluator-legacy.ts` with a TODO marker.
6. `previewExpressionSchema` in `_shared/contracts.ts` accepts
   `collection.*` fields; the previously-rejecting test flips to
   assert acceptance + new positive coverage.
7. `pnpm --filter @binderly/db verify-rls` passes (re-run against
   a freshly-migrated DB). The new MVs / views / RPC are additive
   and do not perturb the asserted policy inventory.
8. Q-013 marked CLOSED in `open-questions.md` with a 2026-05-20
   ratification note pointing at this PR's HEAD SHA.
9. `dependencies.yaml` flipped: `T-BE-Q013-CLEANUP` is
   `status: review`, `stub: false`.
10. All 5 CI checks pass (pr-title, typecheck, lint, build, test).

## Out of scope

- The frontend wiring that picks up the new fast paths. The
  completion handler keeps the same wire shape (already wired by
  T-W-API-V2-WIRING / T-M-API-V2-WIRING); the smart-preview
  endpoint's `collection.*` acceptance unlocks new UI affordances
  but doesn't auto-wire them — those land in follow-up frontend
  tasks (#FU-28 if they're scheduled, otherwise opportunistic).
- Removing the parked `evaluator-legacy.ts`. One-iteration park;
  delete in the next backend cleanup if production is stable.
- Pre-computed trend / freshness columns on `mv_current_price`.
  Out of Q-013's scope; tracked separately if/when reviewers ask.
- Per-user-only MV refresh. The chosen refresh strategy refreshes
  the entire MV (CONCURRENTLY) on every mutation; per-user
  partition refresh would require partitioned MVs which Postgres
  does not directly support. Documented in Decisions below.

## Decisions

- **D1. Refresh strategy: synchronous `REFRESH ... CONCURRENTLY`
  on every collection mutation.** The brief listed three options
  (CONCURRENTLY-per-mutation / `pg_notify`+worker /
  `pg_cron`-scheduled). Option 1 gives the strong-consistency
  UX Pablo's home-screen completion-% reflection requires; at v1
  scale (~100 users × ~10k rows × ~100 sets), CONCURRENTLY scans
  in well under a second; the UNIQUE indexes on
  `(user_id, set_id)` and `(user_id)` are present and
  CONCURRENTLY-safe. Tradeoffs: a SLOW refresh would block all
  writes — but at v1 scale, the worst-case refresh stays under
  the request's other latency floor (the mutation INSERT/UPDATE
  itself + a `select` round-trip). If the catalog grows and
  refresh times become problematic, the next move is option 3
  (`pg_cron` every 30s) — `cron.schedule('refresh-user-completion',
  '*/30 * * * * *', ...)` against an already-existing
  REFRESH function — that requires no handler or contract change,
  only a new SQL migration. The fire-it-from-the-handler call
  becomes a no-op shim.
- **D2. RPC security model: SECURITY DEFINER + explicit
  `auth.uid() = p_user_id` guard.** The smart-preview RPC needs
  to LEFT JOIN `collection_item` for the user — which under
  SECURITY INVOKER would be RLS-gated and only work if the
  caller's JWT is in the function's session (it is, via the
  user-scoped client). But SECURITY INVOKER on a function that
  takes an opaque `jsonb` AST and EXECUTEs the compiled SQL is
  the wrong posture (the function body decides what SQL runs;
  it should always have the catalog and the explicit
  `WHERE user_id = $p_user_id` regardless of who calls it).
  SECURITY DEFINER + an `auth.uid() = p_user_id` guard at the
  top of the function gives the right shape: callers can only
  ever query their own user's collection state, and the body
  has full catalog access.
- **D3. MV access posture: wrapper views, not direct MV SELECT.**
  Postgres 17 does not support RLS on materialized views (verified
  in `0013_mv_current_price.sql`'s header). Granting SELECT on
  the MV to `authenticated` directly would let a curious user
  query someone else's `(user_id, set_id)` row. The chosen
  posture: REVOKE the MV from public + grant only to
  `service_role`; expose user-scoped data via a wrapper VIEW
  with `WHERE user_id = auth.uid()` and grant SELECT on the
  view to `authenticated`. The view runs with its owner's
  privileges (the default — `security_invoker = false`), so the
  view can read the MV even though authenticated callers can't.
  The `auth.uid()` predicate is what gates the row set; the
  view's `security_barrier = true` flag prevents leakage via
  cleverly-crafted predicates (qual reordering).
- **D4. AST compiler ported to PL/pgSQL, not jsonb operators.**
  The brief offered "port the TS compiler" vs "use jsonb operators
  + recursive CTE". The first option is what `packages/smart-
  collection-dsl/src/sql.ts` already documents as the SQL contract,
  and the test-time round-trip property is preserved. PL/pgSQL
  emits the exact same WHERE-clause structure (every leaf wrapped
  in `IS TRUE`; AND/OR/NOT combinators with explicit grouping;
  `enumArray` field semantics via `ANY(...)` and `&&`). The
  field-name allowlist is a static CASE in `_smart_column_for`
  and `_smart_kind_for`, so a malformed AST surfaces at compile
  time as a `RAISE EXCEPTION 'unknown field: X'` rather than a
  silent wrong-SQL exec. Worker is willing to maintain the SQL
  port in lockstep with the TS reference; the next contract
  bump must update both.
- **D5. Keep the in-JS evaluator parked for one iteration.** The
  RPC swap is a hot-path change; if production sees a regression
  (RPC errors, plan changes, etc.), a single-file revert
  (`smartPreview.ts` re-imports the parked evaluator) gets us
  back to the in-JS path. Worker recommends deleting
  `evaluator-legacy.ts` in the next backend cleanup if there are
  no incidents.

## Owns paths

- `packages/db/src/migrations/` (additive new migrations only)
- `packages/db/src/schema/` (additive — only if RPC return-shape
  types are needed; this PR didn't end up needing any)
- `infra/supabase/functions/_shared/handlers/` (swap completion +
  smartPreview; refresh-hook into collection; park
  evaluator-legacy)
- `infra/supabase/functions/_shared/contracts.ts` (widen the
  preview field allowlist to accept `collection.*`)
- `infra/supabase/functions/_shared/test-helpers.ts` (add `.rpc()`
  to the fake supabase client — required to test the new RPC
  paths)

## Out-of-owns_paths edits — pre-authorized

- `dependencies.yaml` — status: pending → review, stub: true → false
- `tasks/02-backend/T-BE-Q013-CLEANUP.md` — full elaboration
- `open-questions.md` — Q-013 close-out

## Internal decomposition

Five sequential commits:

1. `docs(tasks): elaborate T-BE-Q013-CLEANUP` — this file +
   dependencies.yaml flip.
2. `feat(db): mv_user_completion + wrapper views + refresh fn
   (0018)` — migration only, no handler edits.
3. `feat(backend): swap completion handler to MVs + refresh hook` —
   completion.ts + collection.ts edits + their tests + the
   `.rpc()` fake addition.
4. `feat(db): smart_collection_preview RPC (0019)` — migration
   only.
5. `feat(backend): swap smart-preview to RPC; widen contract; close
   Q-013` — smartPreview.ts + contracts.ts + evaluator-legacy.ts
   park + smartPreview.test.ts rewrite + open-questions.md
   close-out.

## Branch & PR

- Branch: `agent/T-BE-Q013-CLEANUP`
- PR title: `feat(backend): T-BE-Q013-CLEANUP — land MVs + smart-preview RPC (closes Q-013)`
- Base: `main`

## Escalation triggers

Stop and surface to orchestrator if:

- The DSL compiler's port to PL/pgSQL has an operator the brief
  doesn't anticipate (a precedence quirk, a `enumArray` semantic
  edge case, etc.). Worker logs a new Q-NNN with options +
  recommendation, then proceeds with best option documented.
- The refresh strategy chosen at D1 turns out to be wrong at
  test time (CONCURRENTLY rejects because the UNIQUE assumption
  fails). Worker pivots to one of the brief's other options and
  documents in the PR body.

## Notes from execution

Worker (this PR):

- The PG17 RLS-on-MV limitation documented in
  `0013_mv_current_price.sql` rules out the literal reading of
  the brief's "Hand-authored RLS so authed users read only their
  own rows" bullet. The worker chose D3 (wrapper views with
  `auth.uid()`) as the closest functional equivalent — same
  guarantee (a curious authed user cannot read another user's
  row), different mechanism (view qual instead of pg_policy
  row).
- The `refresh_user_completion()` function refreshes the entire
  MV, not just the calling user's slice. This is unavoidable in
  Postgres 17 — `REFRESH MATERIALIZED VIEW [CONCURRENTLY]` has
  no per-row mode. At v1 scale (~10k MV rows total across both
  views) this stays well under a second; at scale, the move is
  to schedule the refresh on a `pg_cron` cadence and short-
  circuit the per-mutation call to a no-op.
- The fake `SupabaseClient` in `test-helpers.ts` previously
  exposed only `.from(table)` + `.auth.getUser(token)`. The new
  `.rpc(name, args)` method is required to drive the smart-
  preview tests + the new refresh-hook assertions; it follows
  the same outcome-queue pattern as `.from(table)` (queue is
  keyed `rpc:<name>`, drained in FIFO order). Existing handler
  tests that don't enqueue an RPC outcome continue to work —
  the new method is only called when a handler invokes it.
- The smart-preview RPC's PL/pgSQL implementation mirrors the
  TS reference in `packages/smart-collection-dsl/src/sql.ts`
  faithfully, but it does NOT use parameterized placeholders
  (`$1`, `$2`, …) — PL/pgSQL's `EXECUTE` accepts a single SQL
  string at runtime, and Postgres parses + plans the resulting
  query each call. Values are inlined via `quote_literal()`
  (Postgres's SQL-injection-safe quoting primitive). The
  field-allowlist CASE statement is the load-bearing safety
  rail; user input never reaches the SQL string except as a
  quote_literal-escaped value or an integer cast.
- The wrapper views' qualifying clause uses
  `WHERE user_id = (SELECT auth.uid())` rather than `WHERE
  user_id = auth.uid()`. The subquery form forces Postgres to
  evaluate `auth.uid()` once per query and treat it as a stable
  scalar, which keeps the planner from re-evaluating it per
  row (and unlocks the `(user_id, set_id)` index for the
  filter).
