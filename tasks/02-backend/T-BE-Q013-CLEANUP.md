# T-BE-Q013-CLEANUP — Land Q-013's deferred backend pieces (MVs + smart-preview RPC)

**Stage:** 02-backend
**Agent role:** backend
**Effort:** L
**Status:** STUB — worker elaborates this file before any code edits.

---

> ## STUB — Worker instructions
>
> Elaborate this file into the full task template (`AGENT_ORCHESTRATOR.md` § 7)
> as your first commit (`docs(tasks): elaborate T-BE-Q013-CLEANUP`). Then ship
> in logical slices.
>
> **Pre-authorized out-of-owns_paths edits:**
>
> - `dependencies.yaml` — flip `T-BE-Q013-CLEANUP` `status: pending → review`,
>   `stub: true → false`.
> - `tasks/02-backend/T-BE-Q013-CLEANUP.md` — full elaboration.
> - `open-questions.md` — mark Q-013 CLOSED with a 2026-05-20 ratification note
>   pointing at your PR HEAD.
> - `packages/db/src/schema/` — additive new types or schema export for any
>   new RPC return shape (only if needed to make Drizzle aware of the RPC's
>   columns).

---

## Goal

Q-013 (raised by T-BE-EDGE-FUNCTIONS-V2 in iter 21) documented two
intentional divergences that shipped: the completion handler computes
on-the-fly against canonical tables (the `mv_user_set_completion` /
`mv_user_global_completion` MVs don't exist in migrations), and the
smart-preview handler evaluates the AST in JS in memory (the Edge
bundle can't import `@binderly/smart-collection-dsl` and supabase-js
has no raw-SQL escape hatch).

Pablo's directive on Q-013 (2026-05-20): **"if all required pieces are
available, don't defer, do it now."** This task lands both pieces.

Two surfaces in one PR:

### Surface 1: `T-DL-MV-COMPLETION` (#FU-26)

Hand-author a migration that ships the two materialized views per
`PROJECT.md § 8`, with appropriate indexes and a refresh strategy.
Then swap the completion Edge handler from on-the-fly compute to a
single `SELECT` against the new MVs.

- New migration `0018_mv_user_completion.sql` (next free number after
  `0017_profile_provisioning_trigger`):
  - `mv_user_set_completion(user_id, set_id, set_code, set_name,
    owned_unique, total_unique, completion_pct)` per-user / per-set
    progress.
  - `mv_user_global_completion(user_id, unique_cards_owned, total_cards,
    completion_pct)` per-user global progress.
  - Indexes on `(user_id)` for both, and `(user_id, set_id)` /
    `(user_id, completion_pct DESC)` on the set-level MV for the
    "most-complete-first" view that's likely to appear on the home
    screen.
  - Hand-authored RLS so authed users only read their own rows.
  - **Refresh strategy:** the brief recommends `REFRESH MATERIALIZED
    VIEW CONCURRENTLY` triggered by the existing collection-mutation
    Edge handlers (`POST /v1/me/collection/items`, etc.). The worker
    chooses one of:
    1. `REFRESH ... CONCURRENTLY` on every mutation (simplest;
       requires `UNIQUE` indexes on both MVs).
    2. A queued/debounced refresh (set a `pg_notify`; a background
       worker REFRESHes).
    3. Scheduled refresh via Supabase cron extension (`pg_cron`).
    Document the choice + tradeoffs in the PR body. **Option 1 is
    recommended for v1** — at v1 catalog scale CONCURRENTLY runs in
    well under a second, and it gives strong-consistency UX (the
    home-screen completion % reflects the user's last add).

- Edge handler swap: `infra/supabase/functions/_shared/handlers/`
  `collection.ts` (or wherever completion lives — read first).
  Replace the on-the-fly algorithm with two `SELECT`s against the MVs.
  Keep the algorithmic implementation as a fallback ONLY if the
  worker judges it cheap (probably not worth it; document).

- Mutation-side hook: collection-mutation handlers must `REFRESH ...
  CONCURRENTLY` the relevant MVs after the mutation commits. Wrap
  in a transactional after-commit hook if practical; otherwise a
  best-effort refresh-then-respond pattern (the next read picks up
  the change).

### Surface 2: `T-BE-SMART-PREVIEW-RPC` (#FU-27)

Hand-author a Postgres RPC function that accepts the DSL AST as
`jsonb`, compiles to SQL on the server, and returns matching
printings + `totalCount`. Edge handler invokes via supabase-js
`.rpc(...)`. Unlocks `collection.*` predicates + catalog-scale
eval.

- New migration `0019_smart_preview_rpc.sql`:
  - Function `smart_collection_preview(ast jsonb, p_user_id uuid,
    p_limit int default 200, p_offset int default 0)` returns
    `TABLE(printing_id uuid, card_id uuid, card_name text,
    set_code text, set_name text, image_url text, ...)` plus a
    sibling `smart_collection_preview_count(ast jsonb,
    p_user_id uuid)` returning `bigint` for `totalCount`. (Or
    return both in one call via a single function returning
    a record; worker chooses.)
  - The function implements the same AST → SQL compilation
    that `@binderly/smart-collection-dsl`'s `expressionToSql()`
    does in TS, but in PL/pgSQL or SQL. Worker may either:
    1. **Port the compiler to SQL** — the DSL is small enough
       that this is tractable. Recommended; the TS compiler is
       the source of truth, and porting locks the contract.
    2. **Use Postgres's jsonb operators directly** with a
       recursive CTE that walks the AST and emits filter
       predicates inline. Clever but harder to maintain.
    Choose Option 1 unless there's a compelling reason for 2.
  - **`collection.*` predicates are now valid** (with `p_user_id`
    in scope, joining to `collection_item` is trivial). Remove
    the explicit rejection at the contract layer. Update the
    Edge handler + contract Zod schema accordingly.
  - **Catalog-scale eval works** — the function runs as a single
    indexed query; no in-memory projection cap.

- Edge handler swap: `infra/supabase/functions/_shared/handlers/`
  `smart-collections.ts` (or wherever preview lives). Replace
  the in-JS evaluator with a `client.rpc('smart_collection_preview',
  { ast, p_user_id: userId, p_limit: limit, p_offset: offset })`
  call. Map the response to `smartPreviewResponse`.

- Optional bonus: keep the in-JS evaluator code in
  `_shared/handlers/` as `evaluator-legacy.ts` for at least one
  iteration with a `// TODO: remove after T-BE-Q013-CLEANUP soaks`
  marker, so a fast revert is possible if the RPC has problems
  in production. Worker decides.

## Required reading

- `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — the brief Q-013
  was raised against; the current handler implementations.
- `infra/supabase/functions/_shared/handlers/collection.ts` (or
  the actual handler file for completion) — current on-the-fly
  algorithm.
- `infra/supabase/functions/_shared/handlers/smart-collections.ts`
  (or actual filename) — current in-JS evaluator.
- `infra/supabase/functions/_shared/contracts.ts` — the
  `previewExpressionSchema` mirror that rejects `collection.*`.
- `packages/smart-collection-dsl/src/expressionToSql.ts` — the
  TS compiler you'll port to SQL.
- `packages/db/src/migrations/0013_mv_current_price.sql` — the
  one existing MV migration; copy its hand-authored style
  (RLS + indexes + grants).
- `packages/db/src/migrations/0017_profile_provisioning_trigger.sql`
  — the most recent hand-authored migration; pick the next free
  number after this.
- `PROJECT.md` § 8 (Collection completion math) — the MV spec.
- `open-questions.md` § Q-013 — the divergences this task closes.
- `rules/02-backend.md` — stage rules.

## Hard rules

- **Two new migrations, both hand-authored, monotonic numbering
  starting at `0018`.** Do NOT run `drizzle-kit generate`.
- **No breaking changes to existing endpoint contracts.** The
  wire shape of `completionDto` and `smartPreviewResponse` does
  NOT change. Only their implementations change.
- **`collection.*` predicates become valid in smart preview.**
  This is a contract widening, not a break — clients that
  previously sent expressions without `collection.*` continue to
  work; clients can now also send expressions with it.
- **RLS posture preserved.** New MVs gate on `user_id = auth.uid()`.
  New RPC takes `p_user_id` and validates via SECURITY DEFINER
  + an explicit `auth.uid() = p_user_id` guard (or runs as
  INVOKER if the function body's SELECTs can read through RLS).
  Worker picks; document.
- **Conventional Commits PR title**, scope `backend`: `feat(backend):
  T-BE-Q013-CLEANUP — land MVs + smart-preview RPC (closes Q-013)`.
- **Test coverage on the swap.** Existing T-BE-EDGE-FUNCTIONS-V2
  handler tests should keep passing (response shapes are
  identical); new tests cover:
  - MV refresh after collection mutations (integration-style:
    add an item, refresh, read completion → updated number).
  - `collection.*` predicates in smart preview (new positive
    coverage; the existing negative-test that asserted rejection
    must flip to assert acceptance).
  - Migration smoke (the standard `pnpm --filter @binderly/db
    verify-rls` if applicable; otherwise a SQL-level test that
    SELECT from each new MV returns expected columns).
  - Target ~30-50 net-new tests across api-contracts (if
    `collection.*` widening adds schema branches), api-client
    (if the response shape stays identical no churn here), edge
    handlers (~15-25 new), and the RPC SQL tests.

## Acceptance criteria

1. `0018_mv_user_completion.sql` exists; both MVs are created with
   indexes + RLS; granted to `authenticated`. SQL is hand-authored
   and matches the style of `0013_mv_current_price.sql`.
2. `0019_smart_preview_rpc.sql` exists; the RPC function +
   sibling count function (or single-call variant) exist with
   proper grants. SQL is hand-authored.
3. `pnpm --filter @binderly/db build` succeeds; `pnpm --filter
   @binderly/db verify-rls` passes (re-run after the new RLS
   policies land).
4. Completion handler reads from the MVs; the on-the-fly algorithm
   is removed (or kept behind a documented fallback flag).
5. Smart-preview handler invokes the RPC via `.rpc(...)`; the
   in-JS evaluator is removed (or kept as `evaluator-legacy.ts`
   for one iteration with a TODO marker).
6. Collection-mutation handlers refresh the relevant MVs after
   commit. Documented refresh strategy with tradeoffs in the PR
   body.
7. `collection.*` predicates accepted by the smart-preview
   contract + handler. The previously-asserting-rejection test
   flips to asserting acceptance; new positive coverage added.
8. Q-013 marked CLOSED in `open-questions.md`.
9. All 5 CI checks pass.

## Owns paths

- `packages/db/src/migrations/` (additive new migrations only)
- `packages/db/src/schema/` (additive — only if new TypeScript
  types are needed for the RPC return shape)
- `infra/supabase/functions/_shared/handlers/` (edits to existing
  completion + smart-collections handlers; possibly a new
  `evaluator-legacy.ts` parking lot)
- `infra/supabase/functions/_shared/contracts.ts` (edit
  `previewExpressionSchema` to accept `collection.*`)

## Out-of-owns_paths edits — pre-authorized

- `dependencies.yaml` — status flip + stub flag flip
- `tasks/02-backend/T-BE-Q013-CLEANUP.md` — full elaboration
- `open-questions.md` — Q-013 close-out

## Internal decomposition (suggested)

Five sequential commits:

1. `docs(tasks): elaborate T-BE-Q013-CLEANUP` + dependencies.yaml flip
2. `feat(db): mv_user_completion + mv_user_global_completion migrations`
3. `feat(backend): swap completion handler to read MVs + refresh hook`
4. `feat(db): smart_collection_preview RPC + collection.* support`
5. `feat(backend): swap smart-preview handler to RPC; widen contract` + Q-013 close-out

## Branch & PR

- Branch: `agent/T-BE-Q013-CLEANUP`
- PR title: `feat(backend): T-BE-Q013-CLEANUP — land MVs + smart-preview RPC (closes Q-013)`

## Notes from execution
_(empty until the sub-agent runs)_
