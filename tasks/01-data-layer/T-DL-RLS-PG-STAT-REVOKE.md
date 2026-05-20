# T-DL-RLS-PG-STAT-REVOKE — REVOKE anon/authenticated grants on admin debug view

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** S (≤30 min; one-line SQL migration + journal append)
**Status:** in_progress (elaborated 2026-05-20 iter 24)

## Hard dependencies

- T-DL-ADMIN-DEBUG-SURFACES (merged, PR #40, `b13d3ed`) — shipped
  `0016_admin_debug_views.sql` which created
  `public.v_pg_stat_statements_top_queries` with the broken privilege
  snapshot this task corrects.

## Soft dependencies

- T-FN-SUPABASE-LOCAL — local Supabase must be running with all
  migrations applied (0000–0019) for `pnpm --filter @binderly/db
  verify-rls` to exercise the fix end-to-end. If it isn't, a paste-able
  human smoke test is included in the PR body.

## Required reading

- `open-questions.md` follow-up #FU-28 (the root-cause analysis already
  captured by the T-BE-Q013-CLEANUP worker that surfaced this in PR #73).
- `packages/db/src/migrations/0016_admin_debug_views.sql` — the migration
  whose privilege posture this corrects. The view block at § 5
  (`v_pg_stat_statements_top_queries`) is the surface this PR patches.
- `packages/db/src/migrations/0012_profile_grants_fix.sql` — the
  reference pattern for "additive privilege correction without rewriting
  the original migration" (Q-003 / Option 1 shape, mirrored verbatim).
- `packages/db/scripts/verify-rls/{assertions,inventory}.ts` — the suite
  whose two `v_pg_stat_statements_top_queries` failures this task closes.
- `packages/db/src/migrations/meta/_journal.json` — must be appended
  with the new entry (idx 20) so the migrator picks the file up.

## Goal

Land a single additive migration
`0020_revoke_admin_debug_view_grants.sql` that REVOKEs the surviving
`anon` / `authenticated` privileges on
`public.v_pg_stat_statements_top_queries`, restoring the
service-role-only posture promised by `0016_admin_debug_views.sql`.

`pnpm --filter @binderly/db verify-rls` against fresh local Supabase
moves from **123 passed / 2 failed** to **125 passed / 0 failed**.

### Root cause (recap)

Supabase's project-init runs

```
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
```

BEFORE any migration applies. The default-privileges machinery fires on
every `CREATE VIEW`, so views inherit explicit per-role grants to `anon`
and `authenticated`. The subsequent
`REVOKE ALL ON public.v_pg_stat_statements_top_queries FROM PUBLIC;`
inside 0016 strips only the PUBLIC pseudo-role — which, per the PG 17
docs, is **not** the union of all roles for REVOKE semantics — so the
explicit per-role grants survive. `anon` and `authenticated` end up able
to SELECT from the view.

The other four views in 0016 (`v_data_conflict_top`,
`v_data_conflict_by_source`, `v_image_pipeline_coverage_gaps`,
`v_fx_rate_freshness`) acquire the same surviving grants on CREATE,
but verify-rls passes on them because their underlying tables
(`data_conflict`, `printing`, `printing_image`, `fx_rate`) RLS-gate
`anon`/`authenticated` to zero rows under the PG 17
`security_invoker = false` default. The pg_stat_statements wrapper view
is the lone red because its underlying object
(`extensions.pg_stat_statements`) is an extension view with no RLS — the
wrapper, owned by `postgres`, freely returns rows.

### Decisions locked at elaboration time

- **Migration index → 0020.** The next free index in
  `packages/db/src/migrations/`. 0017–0019 were claimed by T-BE-AUTH
  (profile provisioning trigger), T-BE-Q013-CLEANUP / #FU-26
  (mv_user_completion), and T-BE-Q013-CLEANUP / #FU-27
  (smart_preview_rpc) respectively.
- **Filename → `0020_revoke_admin_debug_view_grants.sql`.** Mirrors the
  `<idx>_<description>` convention used by every existing migration.
- **Scope → one REVOKE statement, one view.** The hard rule for this
  PR is one migration with only the REVOKE statements needed to clear
  the verify-rls failures. Hardening the other four views in 0016
  (defense in depth — they could leak if a future migration disabled
  RLS on their underlying tables) is intentionally out of scope; it
  can ride along with the next non-trivial 0016-adjacent change.
- **Pattern source → `0012_profile_grants_fix.sql` verbatim, adapted.**
  Same shape: hand-authored additive corrective for a privilege gap
  that the originating migration left behind; comment header explains
  the cause; no edits to the originating migration; idempotent REVOKE
  statements; journal append.
- **Roles touched → `anon`, `authenticated`** (the two surviving grants
  per the verify-rls baseline). `service_role` keeps its explicit SELECT
  grant from 0016 untouched.
- **Snapshot file → none.** Per the existing journal pattern, only
  schema-shape migrations carry snapshot files. This is a privileges-
  only migration with no schema-shape impact.
- **Drizzle journal → append entry 20** with
  `tag: "0020_revoke_admin_debug_view_grants"`, `version: "7"`,
  `breakpoints: true`, mirroring the existing entries.
- **Idempotency → REVOKE is idempotent in PostgreSQL by construction.**
  Re-running this migration against a database that already has the
  grants stripped is a no-op. No `IF EXISTS` guards needed.

### What this migration does NOT do

- Does **not** modify `0016_admin_debug_views.sql`. Editing a merged
  migration would rewrite `main`'s history.
- Does **not** recreate the view or change any schema shape. Pure
  privilege correction.
- Does **not** widen the REVOKE to the other four debug views (out of
  scope per the hard rule for this PR; they pass verify-rls today).
- Does **not** touch the Q-007 admin-role question. That's an open
  product decision, not part of this fix.
- Does **not** change behavior in hosted Supabase materially beyond
  matching local behavior — the same `ALTER DEFAULT PRIVILEGES` runs
  in hosted projects, so this migration is load-bearing in production
  too (tightens the SQL privilege snapshot to match the policy posture
  documented in 0016 § 5).

## Deliverables

- `tasks/01-data-layer/T-DL-RLS-PG-STAT-REVOKE.md` — this elaborated
  brief.
- `packages/db/src/migrations/0020_revoke_admin_debug_view_grants.sql`
  — the migration. One REVOKE statement plus a header comment naming
  the cause, the verify-rls failures, the Supabase default-privileges
  mechanism, the reason only this view is observably red today, and
  the explicit out-of-scope note for the other four views.
- `packages/db/src/migrations/meta/_journal.json` — appended with the
  idx-20 entry. `version: "7"`,
  `tag: "0020_revoke_admin_debug_view_grants"`, `breakpoints: true`,
  `when` monotonically after `1777920000009`.

## Acceptance criteria

- [x] `packages/db/src/migrations/0020_revoke_admin_debug_view_grants.sql`
      exists and ships exactly the REVOKE statements needed to clear
      verify-rls.
- [x] The migration revokes ALL privileges on
      `public.v_pg_stat_statements_top_queries` from `anon` and
      `authenticated`.
- [x] `packages/db/src/migrations/meta/_journal.json` has a new entry
      at `idx: 20`, `tag: "0020_revoke_admin_debug_view_grants"`,
      `version: "7"`, `breakpoints: true`. No other journal entries
      are modified.
- [x] No `0020_snapshot.json` is added (privileges-only migration).
- [x] `pnpm --filter @binderly/db build` clean.
- [x] `pnpm --filter @binderly/db verify-rls` against fresh local
      Supabase reports **125 passed / 0 failed** (was 123/2 on `main`).
- [x] No file modified outside `packages/db/src/migrations/` (the SQL
      file + journal append), `tasks/01-data-layer/` (this brief), and
      `dependencies.yaml` (the orchestrator's task entry).

## Out of scope

- Editing `0016_admin_debug_views.sql` (would rewrite `main` history).
- Hardening the other four debug views with the same REVOKE (defense
  in depth — out of scope per this PR's hard rule).
- Provisioning a narrower Postgres `admin` role (Q-007 — open product
  question, not this PR).
- Augmenting `verify-rls.ts` to also assert
  `information_schema.role_table_grants` directly (sibling follow-up,
  not part of this fix).

## Branch & PR

- Branch: `agent/T-DL-RLS-PG-STAT-REVOKE`
- Base: `main` @ `761c254`
- PR title: `fix(db): T-DL-RLS-PG-STAT-REVOKE — REVOKE anon/authenticated grants on admin debug view (#FU-28)`
- Commits (Conventional Commits):
  1. `fix(db): T-DL-RLS-PG-STAT-REVOKE — REVOKE anon/authenticated grants on admin debug view (#FU-28)`

## Escalation triggers

Stop and surface to the orchestrator if:

- `pnpm --filter @binderly/db verify-rls` after the migration applies
  reveals more failures than before (a new gap surfaced).
- The migrator complains about the journal append (drizzle-kit format
  drift since the last hand-authored migration).
- The single REVOKE turns out to be insufficient and additional view(s)
  need REVOKEs (the hard rule said "verify which exact view(s) are red
  by running verify-rls; if more views need REVOKE, include them").

## Notes from execution

- Baseline confirmed 123 passed / 2 failed on `main` @ `761c254`; both
  failures on `v_pg_stat_statements_top_queries` (anon + authenticated).
  No other view was red, so the single REVOKE statement on that view is
  the minimal fix.
- After migration applies via `pnpm --filter @binderly/db db:migrate`,
  verify-rls reports 125 passed / 0 failed (delta: +2 pass, -2 fail —
  exactly the two views that were red are now green).
