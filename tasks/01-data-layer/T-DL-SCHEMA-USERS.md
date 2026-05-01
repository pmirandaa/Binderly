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
_(empty)_
