# T-DL-RLS-POLICIES — Supabase RLS posture documentation + verification

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** M
**Status:** in_progress (elaborated 2026-05-04)

## Hard dependencies

- T-DL-SCHEMA-USERS (merged) — `profile`, `subscription` tables + RLS in `0000_user_tables.sql` / `0001_users_rls.sql`.
- T-DL-SCHEMA-COLLECTIONS (merged) — `collection_item`, `custom_collection`, `custom_collection_item`, `smart_collection_rule`, `shareable` + RLS in `0004_collection_tables.sql` / `0005_collections_rls.sql`.
- T-DL-SCHEMA-GRADING (merged) — `grading_submission`, `grading_training_sample` + RLS in `0006_grading_tables.sql` / `0007_grading_rls.sql`.

(De-facto extra dependencies that landed during Phase 1 and are folded into the scope below: T-DL-SCHEMA-CARDS / `0003_catalog_rls.sql` and T-DL-SCHEMA-PRICING / `0009_pricing_rls.sql`. Both ship full RLS for their own tables; this task documents and verifies the unified posture across the catalog.)

## Soft dependencies

- T-FN-SUPABASE-LOCAL (pending): when local Supabase is up and seeded with migrations, the verification script runs end-to-end. Until then verification is paste-able SQL/CLI and the TS script gracefully skips with a typed exit code.

## Required reading

- AGENT_ORCHESTRATOR.md § 7 (full task template).
- PROJECT.md (search "RLS", "service_role", "Row Level Security", "JWT", "anon", "authenticated").
- `rules/01-data-layer.md` ("every user-facing table MUST have RLS enabled", "service_role bypasses RLS only for adapters/jobs explicitly run as service_role").
- `context/conventions.md` ("RLS policy changes ship in their own migration").
- `context/data-model.md` § "RLS policies (summary)".
- All five existing RLS migrations (must read end-to-end for policy style):
  - `packages/db/src/migrations/0001_users_rls.sql`
  - `packages/db/src/migrations/0003_catalog_rls.sql`
  - `packages/db/src/migrations/0005_collections_rls.sql`
  - `packages/db/src/migrations/0007_grading_rls.sql`
  - `packages/db/src/migrations/0009_pricing_rls.sql`
- All schema modules in `packages/db/src/schema/` to confirm tables and column names.
- Supabase RLS docs (only if the existing migrations don't disambiguate a behavior): https://supabase.com/docs/guides/auth/row-level-security.

## Goal

Per-table RLS policies were authored inline as part of each schema task's hand-written RLS migration (0001/0003/0005/0007/0009). What's left for this task is the **catalog-wide consolidation work** that nobody else owns:

1. **Documentation.** A single `packages/db/src/migrations/rls/README.md` that summarizes the RLS posture across the entire catalog. Per-table family (users, catalog, collections, grading, pricing): which tables have RLS, what each policy does in plain English, role-by-role access matrix, and an explicit "service_role bypasses" callout enumerating which jobs/adapters use service_role and why.
2. **Consolidated verification script.** `packages/db/scripts/verify-rls.ts` — a runnable assertion suite that exercises the RLS posture end-to-end against a live Supabase Postgres (every user-facing table has RLS enabled; owner-bound row visibility holds; service_role bypass works; anon is blocked from protected tables).
3. **Scope-shrink note.** This task was originally scoped as "author all per-table RLS policies". By the time it became ready, every per-table RLS migration had already shipped inline with its schema task's PR (0001/0003/0005/0007/0009). The scope is now docs + verification + (deferred) admin debug surfaces.

### Scope decisions locked at elaboration time

- **`data_conflict` table → DEFER.** The `data_conflict` schema referenced in `context/data-model.md` § "data_conflict (admin-only)" does not exist as a Drizzle table or migration today. The resolver (`data-pipeline/src/types.ts`) emits in-memory `DataConflict` records but does not persist them. Per the orchestrator's note on this task ("default is (a) — defer to a follow-up task"), creating the table is out of scope here. A follow-up task **T-DL-DATA-CONFLICT-TABLE** (schema + RLS migration + resolver wiring) should be added to `dependencies.yaml` after this PR merges; it's a natural sibling of the still-pending `T-DL-SEED-INGEST` work and not a blocker for any merged or in-flight task.
- **Admin debug surfaces → DEFER.** `pg_stat_statements` exposure, audit-log read views, and the printing×card×set admin audit view are deferred to a follow-up task **T-DL-ADMIN-DEBUG-SURFACES**. The orchestrator's stated preference is "docs + verification script only; push admin debug to a follow-up." Shipping inline would require a new migration (next free index = 0010) and would coordinate-conflict with T-DL-IMAGE-PIPELINE (also targeting 0010). Neither admin surface is on the path of any current ready task, and `pg_stat_statements` is not even installed by default on Supabase free tier.
- **Verification script language → TypeScript.** Pure-SQL verification can assert `pg_class.relrowsecurity` and `pg_policies`, but cannot easily simulate JWT claims (`SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`) and assert per-claim row visibility from inside the same script. TypeScript with `postgres-js` can `SET LOCAL ROLE` + `SET LOCAL request.jwt.claims` per assertion, run a query, and assert row counts, all in one process. Trade-off: requires a Node runtime (acceptable; we already require Node for Drizzle migrations), and adds ~300 LOC to `packages/db/`. Worth it for the richer assertion surface.
- **Migration index → none added.** No new migration ships. The orchestrator's stated preference (above) is honored. If admin debug surfaces re-enter scope, the next free index is 0010 — coordinate with T-DL-IMAGE-PIPELINE for slot allocation at that time.
- **No file outside `packages/db/`** beyond this task file and (optionally) `dependencies.yaml`. The orchestrator carved out those exceptions; this PR uses the task-file exception for the elaboration commit and **does not** edit `dependencies.yaml` (orchestrator owns that).

## Deliverables

- `tasks/01-data-layer/T-DL-RLS-POLICIES.md` — this elaborated spec (Phase 1 commit).
- `packages/db/src/migrations/rls/README.md` — RLS posture documentation, one section per table family with policy summaries and role × table access matrices.
- `packages/db/scripts/verify-rls.ts` — runnable RLS verification suite. Connects via `SUPABASE_DB_URL` / `DATABASE_URL` / `--url`. Asserts: (a) RLS enabled flag per table; (b) policy inventory matches the documented matrix; (c) owner-bound row visibility under simulated `authenticated` claim; (d) `anon` blocked from protected tables; (e) `service_role` bypass works. Exits 0 on pass, non-zero on first assertion failure with a clear error message. Skips gracefully with exit code 2 + paste-able instructions when no DB URL is available.
- `packages/db/package.json` — new `verify-rls` script entry: `"verify-rls": "tsx scripts/verify-rls.ts"`.

## Acceptance criteria

- [ ] `packages/db/src/migrations/rls/README.md` exists and documents posture for every user-facing + catalog + pricing table that ships in migrations 0000–0009.
- [ ] The README per-table matrix matches what the SQL migrations actually create (audited by reading 0001 / 0003 / 0005 / 0007 / 0009 and cross-checking).
- [ ] The README has an explicit "service_role bypasses" callout that names which jobs/adapters use service_role and why (data-pipeline ingest jobs, Supabase Auth webhooks, edge functions).
- [ ] `packages/db/scripts/verify-rls.ts` exists and exports a typed `runVerification` function plus a CLI entry that runs it.
- [ ] The script asserts, at minimum: per-table `relrowsecurity = true`; owner-only `SELECT` on `profile` / `subscription` / `collection_item` / `custom_collection` / `shareable` / `grading_submission` for two distinct synthetic `authenticated` users; service_role can read every protected table; anon can read public tables (`set`, `card`, `printing`, `market`, `price_aggregate`, `fx_rate`, slug-gated `shareable`, public-projection `profile`) and is blocked from every other table.
- [ ] `pnpm --filter @binderly/db typecheck` clean.
- [ ] `pnpm --filter @binderly/db lint` clean (max-warnings=0).
- [ ] `pnpm --filter @binderly/db format:check` clean.
- [ ] `pnpm --filter @binderly/db build` clean.
- [ ] `pnpm --filter @binderly/db verify-rls` either runs end-to-end against a live local Supabase OR exits 2 with a clear "no DB URL" message and a paste-able human-runnable smoke test included in the PR body. (T-FN-SUPABASE-LOCAL is still pending in the build graph as of dispatch; the runtime path is exercised by the next task that brings a Supabase up.)
- [ ] No file modified outside `packages/db/` (exception: this task file for the scope-shrink note).

## Out of scope

- Creating the `data_conflict` table (deferred → T-DL-DATA-CONFLICT-TABLE).
- Admin debug surfaces — `pg_stat_statements` view exposure, audit-log read view, printing×card×set audit view, admin-only DDL grants (deferred → T-DL-ADMIN-DEBUG-SURFACES).
- Editing existing RLS migrations 0001/0003/0005/0007/0009 — those were ratified by their schema task PRs and changing them would rewrite `main`'s history. If the verification script reveals a real RLS bug in any of them, **stop** and surface to the orchestrator (see escalation below).
- Adding new policies to user-facing tables that already have RLS migrations (those policies were ratified; adding "extra" policies here would be a silent posture change).
- Application-layer access control — the README documents the SQL boundary; the API layer's projection of public columns (e.g. `profile.preferences` redaction for anon) lives in the edge functions / PostgREST and is owned by stage 2.

## Branch & PR

- Branch: `agent/T-DL-RLS-POLICIES`
- Base: `main` @ 180ea83
- PR title: `T-DL-RLS-POLICIES: RLS posture documentation + verification`
- Commits (Conventional Commits):
  1. `docs(tasks): elaborate T-DL-RLS-POLICIES`
  2. `feat(db): RLS posture documentation + verification (T-DL-RLS-POLICIES)`

## Escalation triggers

Stop and append to `open-questions.md` (and surface to orchestrator) if:

- The verify-rls script reveals a real RLS bug in a merged migration. **Do not** silently patch the existing migration — that would change `main`'s history. Open a Q-NNN with full repro and let the orchestrator decide whether to ship a corrective migration.
- A user-facing table that already has RLS appears insufficiently protected. Same handling — surface, don't patch.
- The `data_conflict` deferral turns out to be wrong (e.g. PROJECT.md was updated upstream to require it as part of MVP). The default is to defer; only escalate if the reading shifts.
- A change is needed outside `packages/db/`.

## Notes from execution

- Phase 1 (elaboration) committed as `docs(tasks): elaborate T-DL-RLS-POLICIES`.
- Phase 2 ships per the planned scope: README + verify-rls TS suite + `verify-rls`
  package script. No new migration; no admin debug surfaces; no `data_conflict`
  table (orchestrator's stated default = defer). Both deferrals are documented
  in § 11 of `packages/db/src/migrations/rls/README.md`.
- **Real posture finding surfaced by the verify-rls script** —
  `0001_users_rls.sql` ships RLS policies for `profile` / `subscription` but
  **no** explicit GRANT/REVOKE statements. Migrations 0003/0005/0007/0009 do.
  In hosted Supabase the platform's `ALTER DEFAULT PRIVILEGES` covers the gap;
  in local Supabase CLI 2.98.1 + PG17 the `pg_default_acl` for `public` is
  empty, so `profile` ends up with no privileges for `anon` / `authenticated` /
  `service_role` and PostgREST denies the SELECT before RLS can run. Per the
  task's escalation hook the merged migration is **not** modified by this PR;
  the finding is logged as Q-003 in `open-questions.md` with a recommended
  corrective additive migration (`T-DL-PROFILE-GRANTS-FIX`). The verify-rls
  output ends "93 passed, 4 failed" against local Supabase — all four failures
  are the same posture gap, exactly as Q-003 predicts.
- The Supabase CLI was already running with migrations 0000–0009 applied at
  dispatch time, so the verify-rls script ran end-to-end live (no Docker /
  paste-able fallback was needed). Exit code 1 from the script reflects the
  Q-003 finding; the structural assertions and the rest of the behavioral
  matrix all pass.
