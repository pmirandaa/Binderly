# T-DL-PROFILE-GRANTS-FIX — Additive migration to fix Q-003 (profile/subscription grants gap)

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** XS (≤30 min of focused SQL; one new migration file + one journal append)
**Status:** in_progress (elaborated 2026-05-04)

## Hard dependencies

- T-DL-RLS-POLICIES (merged, PR #28, `3c448db`) — shipped the verify-rls suite
  (`pnpm --filter @binderly/db verify-rls`) plus the consolidated RLS posture
  README. The script reports 93 passed / 4 failed against fresh local Supabase;
  all four failures are the same Q-003 finding this task fixes.

(Transitively: T-DL-SCHEMA-USERS owns the underlying `0001_users_rls.sql` that
ships RLS policies for `profile` and `subscription` without companion
GRANT/REVOKE statements. That migration is **not** edited here — modifying a
merged migration would rewrite `main`'s history, which Q-003 explicitly forbids
as Option 3.)

## Soft dependencies

- T-FN-SUPABASE-LOCAL — local Supabase must be running with all migrations
  applied (0000–0011) for `pnpm --filter @binderly/db verify-rls` to exercise
  the fix end-to-end. If Supabase is up, this PR runs the suite and reports
  before/after counts in the body. If not, a paste-able human smoke test is
  included instead.

## Required reading

- AGENT_ORCHESTRATOR.md § 7 (full task template).
- `open-questions.md` — Q-003 in full (the gap, the repro, the recommended
  Option 1).
- All five existing RLS migrations (must read end-to-end for canonical pattern):
  - `packages/db/src/migrations/0001_users_rls.sql` — the gap (RLS policies
    for `profile` / `subscription` but no companion GRANT/REVOKE).
  - `packages/db/src/migrations/0003_catalog_rls.sql` — canonical pattern
    (public-read, service-role-write).
  - `packages/db/src/migrations/0005_collections_rls.sql` — canonical pattern
    (owner CRUD; the `shareable` block is the reference for hybrid
    owner-CRUD + anon-public-read tables, which is the exact shape of
    `profile`).
  - `packages/db/src/migrations/0007_grading_rls.sql` — canonical pattern
    (owner CRUD with no anon SELECT; the `grading_submission` block is the
    reference for `subscription`'s owner-SELECT-only posture).
  - `packages/db/src/migrations/0009_pricing_rls.sql` — canonical pattern
    (mixed public-read + service-role-only).
- `packages/db/src/migrations/rls/README.md` — § 3 (Users) and § 8.1 (Known
  posture gap — `profile` SQL grants), § 9 (Defense-in-depth: SQL grants).
- `packages/db/scripts/verify-rls/{assertions,inventory}.ts` — the suite
  whose four `permission denied for table profile` failures this task fixes.
- `packages/db/src/migrations/meta/_journal.json` — must be appended with
  the new entry (idx 12) so the migrator picks the file up.

## Goal

Land a single additive migration `0012_profile_grants_fix.sql` that ships the
defense-in-depth SQL grants for `profile` and `subscription` that
`0001_users_rls.sql` omitted. The grants mirror the canonical REVOKE/GRANT
pattern from `0003_catalog_rls.sql` / `0005_collections_rls.sql` /
`0007_grading_rls.sql` / `0009_pricing_rls.sql`, adapted for the documented
posture of each table:

- `profile` — owner CRUD for `authenticated`, public SELECT for `anon`,
  full DML for `service_role`. Same hybrid shape as `shareable` in 0005.
- `subscription` — owner SELECT for `authenticated`, no `anon` access at
  all, full DML for `service_role` (writes are webhook-only via the
  service-role key per the existing `subscription_service_role_write`
  policy). Same shape as `grading_submission` in 0007 minus the owner
  INSERT/UPDATE/DELETE.

Verification target: `pnpm --filter @binderly/db verify-rls` against fresh
local Supabase moves from **93 passed / 4 failed** (current `main`) to
**97 passed / 0 failed** once this migration applies.

### Decisions locked at elaboration time

- **Migration index → 0012.** The next free index in
  `packages/db/src/migrations/`. 0010 / 0011 were claimed by
  T-DL-IMAGE-PIPELINE (image_provenance + its RLS).
- **Filename → `0012_profile_grants_fix.sql`.** Mirrors the
  `<idx>_<description>` convention used by every existing migration.
- **Pattern source → 0003 / 0005 / 0007 / 0009 verbatim, adapted.** The
  REVOKE block strips the Supabase-default
  `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` grants on `anon` and
  `authenticated`; the GRANT block re-grants the per-policy minimum to
  `anon`, `authenticated`, and `service_role`. SELECT for `anon` is
  REVOKEd on `subscription` (no anon policy) and re-granted on `profile`
  (the `profile_public_read` policy needs it).
- **Tables touched → `public.profile`, `public.subscription`** only. No
  other tables get grants here; every other RLS-bearing table already
  shipped its grants in 0003/0005/0007/0009/0011.
- **Roles touched → `anon`, `authenticated`, `service_role`** (Supabase's
  three application roles per `rls/README.md` § 1).
- **Snapshot file → none.** Per the existing journal pattern, only
  schema-shape migrations have snapshot files (idx 0/2/4/6/8/10 — the
  `_tables.sql` migrations). RLS-only migrations (idx 1/3/5/7/9/11) do
  not. This is a privileges-only migration with no schema-shape impact,
  so no `0012_snapshot.json` is required.
- **Drizzle journal → append entry 12** with `tag: "0012_profile_grants_fix"`,
  `version: "7"`, `breakpoints: true`, mirroring the existing entries.
- **Idempotency → REVOKE/GRANT are idempotent in PostgreSQL by
  construction.** Re-running this migration against a database that
  already has the grants is a no-op. No `IF EXISTS` guards are needed
  (the existing RLS migrations don't use them on REVOKE/GRANT either).
- **Identifier quoting → unqualified table names** (`"profile"`,
  `"subscription"`), to mirror `0001_users_rls.sql` (the migration this
  one corrects) and `0005_collections_rls.sql` / `0007_grading_rls.sql`
  / `0009_pricing_rls.sql` (the canonical pattern source). The
  `search_path` includes `public`, so unqualified is unambiguous.
- **Statement separator → `--> statement-breakpoint`** between every
  REVOKE / GRANT statement. Matches the convention used by every
  existing migration; the migrator splits on this token.

### What this migration does NOT do

- Does **not** modify `0001_users_rls.sql`. Editing a merged migration
  would rewrite `main`'s history; Q-003 Option 3 is explicitly off the
  table.
- Does **not** add or change any RLS policy. The four existing policies
  on `profile` (`profile_owner_select`, `profile_owner_insert`,
  `profile_owner_update`, `profile_owner_delete`, `profile_public_read`)
  and the two on `subscription` (`subscription_owner_select`,
  `subscription_service_role_write`) stay exactly as 0001 created them.
- Does **not** touch any other table. Only `profile` and `subscription`
  get new grants.
- Does **not** change behavior in hosted Supabase. The hosted platform's
  project-init runs
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO
  anon, authenticated, service_role` before any migration, so `profile`
  and `subscription` already had these grants in production. This
  migration is a no-op there (the GRANTs match what's already present;
  the REVOKEs strip a `TRUNCATE/REFERENCES/TRIGGER` slice that's
  invisible to the read/write paths). It fixes **local** Supabase
  (where `pg_default_acl` for `public` is empty) and tightens the
  defense-in-depth posture so the privilege snapshot matches the policy
  posture across both environments.

## Deliverables

- `tasks/01-data-layer/T-DL-PROFILE-GRANTS-FIX.md` — this elaborated spec
  (Phase 1 commit).
- `packages/db/src/migrations/0012_profile_grants_fix.sql` — the migration
  itself. ~30–50 lines, REVOKE block + GRANT block per table, mirroring
  the canonical pattern from 0003/0005/0007/0009. Includes a header
  comment that names the gap, names Q-003, names the four reference
  migrations, and explains why the migration is hosted-Supabase inert
  but local-Supabase load-bearing.
- `packages/db/src/migrations/meta/_journal.json` — appended with the
  idx-12 entry. `version: "7"`, `tag: "0012_profile_grants_fix"`,
  `breakpoints: true`, `when: <timestamp>` (monotonically after
  `1777920000001`).

## Acceptance criteria

- [ ] `packages/db/src/migrations/0012_profile_grants_fix.sql` exists and
      follows the canonical REVOKE/GRANT pattern from
      0003/0005/0007/0009 verbatim, adapted for `profile` and
      `subscription`.
- [ ] The migration revokes
      `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` from `anon`
      and `authenticated` on both tables (matches the
      `0003_catalog_rls.sql` REVOKE shape).
- [ ] The migration revokes `SELECT` from `anon` on `subscription`
      (no anon policy) but **does not** revoke `SELECT` from `anon` on
      `profile` (the `profile_public_read` policy requires it).
- [ ] The migration grants `SELECT, INSERT, UPDATE, DELETE` on `profile`
      to `authenticated` (owner CRUD), `SELECT` on `profile` to `anon`
      (public read), and `SELECT, INSERT, UPDATE, DELETE` on `profile`
      to `service_role`.
- [ ] The migration grants `SELECT` on `subscription` to `authenticated`
      (owner SELECT only — no INSERT/UPDATE/DELETE because writes are
      service-role-only per the `subscription_service_role_write`
      policy) and `SELECT, INSERT, UPDATE, DELETE` on `subscription` to
      `service_role`.
- [ ] `packages/db/src/migrations/meta/_journal.json` has a new entry at
      `idx: 12`, `tag: "0012_profile_grants_fix"`, `version: "7"`,
      `breakpoints: true`. No other journal entries are modified.
- [ ] No `0012_snapshot.json` is added (this is a privileges-only
      migration; the existing journal pattern doesn't include snapshots
      for RLS-only files).
- [ ] `pnpm --filter @binderly/db typecheck` clean.
- [ ] `pnpm --filter @binderly/db lint` clean (max-warnings=0).
- [ ] `pnpm --filter @binderly/db format:check` clean.
- [ ] `pnpm --filter @binderly/db build` clean.
- [ ] `pnpm --filter @binderly/db verify-rls` against fresh local
      Supabase reports **97 passed / 0 failed** (or, if local Supabase
      is unreachable from the sandbox, the PR body includes a
      paste-able human smoke test that the orchestrator can run).
- [ ] No file modified outside
      `packages/db/src/migrations/` (the SQL file + journal append) and
      `tasks/01-data-layer/T-DL-PROFILE-GRANTS-FIX.md` (this elaborated
      spec).

## Out of scope

- Editing `0001_users_rls.sql` (would rewrite `main` history).
- Adding/changing any RLS policy on `profile` or `subscription`. The
  `profile_public_read` policy returns every row to anon by design — the
  application layer (PostgREST + edge functions) is responsible for
  projecting only the public columns. That projection logic is owned by
  stage 02 (T-BE-AUTH and downstream), not here.
- Adding grants to any other table. Every other RLS-bearing table
  already ships its grants in its companion RLS migration.
- Augmenting `verify-rls.ts` to also assert
  `information_schema.role_table_grants` directly. That follow-up is
  enumerated in `rls/README.md` § 11; it's a sibling task, not a part
  of this fix.
- Backfilling grants for `auth.users` or any other Supabase-managed
  schema. Out of scope; Supabase owns those.

## Branch & PR

- Branch: `agent/T-DL-PROFILE-GRANTS-FIX`
- Base: `main` @ `f7381cc`
- PR title: `T-DL-PROFILE-GRANTS-FIX: profile/subscription grants fix (Q-003)`
- Commits (Conventional Commits):
  1. `docs(tasks): elaborate T-DL-PROFILE-GRANTS-FIX`
  2. `feat(db): profile/subscription grants fix (T-DL-PROFILE-GRANTS-FIX, fixes Q-003)`

## Escalation triggers

Stop and append to `open-questions.md` (and surface to the orchestrator)
if:

- The 0001 RLS policies imply a privileges shape that doesn't fit the
  canonical REVOKE/GRANT pattern. (Unlikely — the policies on `profile`
  are owner-CRUD + anon-public-read, structurally identical to
  `shareable` in 0005; the policies on `subscription` are owner-SELECT
  + service-role-write, a subset of `grading_submission` in 0007.)
- `pnpm --filter @binderly/db verify-rls` after the migration applies
  reveals **more** failures than before (a new gap surfaced). Escalate
  rather than silently widening scope.
- `drizzle-kit` (or any migrator step) insists on regenerating
  `meta/_journal.json` or adding a snapshot in a way that conflicts
  with the hand-authored pattern from 0001/0003/0005/0007/0009/0011
  (none of which carry SQL-only snapshot files).
- A change is needed outside `packages/db/src/migrations/` (or this
  task file).

## Notes from execution

(Sub-agent appends here at end. Empty until then.)
