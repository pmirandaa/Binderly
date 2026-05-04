# T-DL-SCHEMA-USERS — DB schema for profiles + subscriptions

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** S
**Status:** pending

## Hard dependencies
- T-FN-DB-MIGRATIONS

## Soft dependencies
- T-DL-SCHEMA-CARDS, T-DL-SCHEMA-COLLECTIONS, T-DL-SCHEMA-GRADING,
  T-DL-SCHEMA-PRICING (parallel-safe)

## Required reading
- PROJECT.md § 5 (Auth & Accounts), § 6 (Data Model), § 16 (Freemium)
- rules/01-data-layer.md
- context/data-model.md (`profile`, `subscription`)
- context/conventions.md

## Goal
Define schemas for `profile` and `subscription` exactly as in
`context/data-model.md`. Both reference Supabase's `auth.users(id)` for
their primary key.

## Deliverables

- `packages/db/src/schema/profiles.ts` — `profile` table.
  - `user_id` PK and FK to `auth.users(id)` ON DELETE CASCADE
  - `handle` is citext unique, not null
  - `preferences` jsonb default `'{}'` — shape contract is documented
    in `context/data-model.md` § `profile.preferences shape`. The zod
    validation lives in `packages/shared-types` (out of scope for
    *this* schema task; this task only ensures the column exists with
    the right type and default). Add a comment on the column pointing
    at both files so future readers know where to look.
  - All other fields per spec
- `packages/db/src/schema/subscriptions.ts` — `subscription` table.
  - `user_id` PK and FK to `auth.users(id)` ON DELETE CASCADE
  - `tier` text default 'free' with check constraint (`'free' | 'pro'`)
  - All other fields per spec
- `packages/db/src/schema/index.ts` — re-export both.
- `packages/db/src/migrations/0002_user_tables.sql` — generated SQL.
  References `auth.users(id)` — verify Supabase's auth schema is in
  scope at migration time (it is by default in Supabase Postgres).
- `packages/db/src/fixtures/users.ts` — `makeProfile`, `makeSubscription`
  builders.
- `packages/db/src/fixtures/users.test.ts` — round-trip tests with a
  test `auth.users` row created via `supabase` SQL helper or directly via
  the migration test harness (document the approach).

## Acceptance criteria

- [ ] Migration applies cleanly to local Supabase Postgres.
- [ ] Profile FK CASCADE works: deleting `auth.users` row removes
      profile.
- [ ] `handle` uniqueness enforced case-insensitively.
- [ ] Subscription `tier` check constraint rejects bad values.
- [ ] Round-trip fixtures pass.
- [ ] No modifications outside the listed paths.

## Out of scope

- RLS policies — T-DL-RLS-POLICIES.
- Default profile creation trigger on signup — that's a small Edge
  Function task in stage 02.
- Subscription mutation paths — stage 10.

## Branch & PR

- Branch: `agent/T-DL-SCHEMA-USERS`
- PR title: `T-DL-SCHEMA-USERS: DB schema for profiles + subscriptions`

## Escalation triggers

- Citext extension issues (should be enabled in init).
- Supabase's `auth.users` schema differs from expectations. Verify with
  `supabase db dump --schema auth` if uncertain.

## Notes from execution

Executed against the freshly-spawned worktree at `agent/T-DL-SCHEMA-USERS`,
parallel with `T-DL-SCHEMA-CARDS`. Both schema PRs only touch their
designated section of `packages/db/src/schema/index.ts` (no cross-task
edits) and live entirely under `packages/db/`.

### Scope adjustments vs the spec

- **RLS migration included.** The orchestrator's dispatch directive
  reclassified the user-table RLS as part of this task's deliverables
  (the spec text under "Out of scope → RLS policies" predated the
  parallel-dispatch plan). Per the conventions doc, RLS ships in its
  own migration file, so it lives in `0001_users_rls.sql` alongside
  the cross-schema FKs that anchor the policies.
- **Fixtures (`packages/db/src/fixtures/*.ts`) deferred.** The
  dispatch `owns_paths` for this task limits writes to
  `packages/db/src/schema/` and `packages/db/src/migrations/`; fixtures
  will land in the dedicated fixture task. The schema's `$inferSelect`
  / `$inferInsert` helper types are exported from each schema file so
  whoever picks up fixtures has typed builders out of the box.

### Cross-schema FK to `auth.users`

Drizzle's `references()` helper can't author cross-schema FKs that
target Supabase's managed `auth.users` table — drizzle-kit's diff
engine doesn't track the `auth` schema and would either (a) noop or
(b) try to create the table itself. Two options were on the table:

1. **(chosen)** Declare `user_id uuid` in Drizzle without a `references()`
   call, then add the FK with a hand-authored `ALTER TABLE` in the
   companion `0001_users_rls.sql` migration. Drizzle-kit ignores it
   on subsequent diffs (it only tracks columns/types it generated).
2. Define a `pgSchema('auth')` placeholder for `auth.users` inside the
   db package and use `references(() => authUsers.id)`. Generates
   correctly today but couples our schema to a placeholder for a
   table we don't own.

Option 1 was chosen. It's the explicit, surgical approach the spec
hint pointed at; it keeps the Drizzle-managed schema strictly scoped
to tables this package owns; and the FK shows up in the same migration
file as the RLS policies that depend on it being there (logically
inseparable from the policies).

### Migration files produced

| File | Notes |
| ---- | ----- |
| `packages/db/src/migrations/0000_user_tables.sql` | Drizzle-generated table creation. Hand-edited only to (a) prepend `CREATE EXTENSION IF NOT EXISTS citext` so the `profile.handle` column type resolves on a fresh Supabase database, and (b) rename the file from drizzle-kit's random `lean_scarecrow` codename to `user_tables` for human readability (journal `tag` updated in lockstep). |
| `packages/db/src/migrations/0001_users_rls.sql` | Hand-authored. Two cross-schema FKs (`profile.user_id` and `subscription.user_id` → `auth.users(id)` ON DELETE CASCADE) plus the RLS posture from `context/data-model.md`: owner CRUD on `profile` for authenticated, public SELECT on `profile` for anon (column projection enforced at the API layer), owner SELECT on `subscription` for authenticated, service-role-only writes on `subscription`. Each policy is `DROP POLICY IF EXISTS … / CREATE POLICY` so re-runs are idempotent. |

`packages/db/src/migrations/meta/_journal.json` carries entries for
both migrations.

### Acceptance criteria results (verified live)

All ACs verified against the local Supabase Postgres at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`:

- ✅ Migration applies cleanly (`pnpm db:migrate:local` exits 0; both
  migrations recorded in `drizzle.__drizzle_migrations`).
- ✅ `profile.user_id` FK to `auth.users.id` with ON DELETE CASCADE:
  inserting a row with a fabricated `user_id` raises
  `foreign_key_violation`; deleting the matching `auth.users` row
  cascades and removes the `profile` and `subscription` rows.
- ✅ `handle` uniqueness is case-insensitive: a second insert with a
  case-different handle raises `unique_violation`.
- ✅ `subscription.tier` rejects out-of-enum values
  (`subscription_tier_check`).
- ✅ Default `subscription.tier` is `'free'`.
- ✅ RLS enabled on both `public.profile` and `public.subscription`,
  policies installed as listed above.
- ✅ Re-runnable: a `DROP TABLE … CASCADE; DROP SCHEMA drizzle CASCADE`
  followed by `db:migrate:local` rebuilds everything cleanly.
- ✅ `pnpm --filter @binderly/db build && lint && typecheck &&
  format:check` all exit 0.
- ✅ No edits outside `owns_paths`.

Round-trip fixture tests are deferred to the fixtures task as noted
above.

### Notes for downstream tasks

- `T-DL-SCHEMA-COLLECTIONS`, `T-DL-SCHEMA-GRADING`, `T-DL-SCHEMA-PRICING`:
  these all FK to `auth.users(id)` (and some to `profile.user_id`).
  Use the same option-1 pattern — keep Drizzle's column as plain
  `uuid` and emit the cross-schema FK in the matching RLS migration.
  When FK'ing to `profile.user_id`, you can use Drizzle's
  `references()` because `profile` lives in `public`.
- Billing tasks (e.g. `T-BE-EDGE-FUNCTIONS` Stripe / RevenueCat
  webhooks) write to `subscription` exclusively via the
  service-role key; the `subscription_service_role_write` policy
  covers INSERT / UPDATE / DELETE. No additional policy work needed
  on this side.
- The shape contract for `profile.preferences` is documented in
  `context/data-model.md` § "profile.preferences shape"; the matching
  zod schema lives at
  `packages/shared-types/src/profile-preferences.ts` (out of scope
  for this task — column type only).
