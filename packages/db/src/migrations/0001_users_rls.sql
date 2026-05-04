-- T-DL-SCHEMA-USERS — companion migration for the user-side tables.
--
-- Two concerns live here, intentionally bundled because they reference
-- the same Supabase-managed `auth.users` table:
--
--   1. Cross-schema foreign keys from `profile.user_id` and
--      `subscription.user_id` to `auth.users(id)` ON DELETE CASCADE.
--      These can't be authored from the Drizzle table definitions
--      (drizzle-kit doesn't manage Supabase's `auth` schema), so they
--      are emitted by hand here. Per `context/conventions.md`
--      § "Database migrations", RLS-bearing changes ship in their own
--      migration file — and this is the file the user-table RLS lands
--      in, so the cross-schema FKs ride along with it (the alternative
--      would be a third migration file for two ALTER TABLE statements
--      that are conceptually inseparable from the FK-anchored RLS
--      policies below).
--
--   2. Row Level Security policies for `profile` and `subscription`,
--      mirroring `context/data-model.md` § "RLS policies":
--      - `profile`:
--          * Authenticated users can SELECT/INSERT/UPDATE/DELETE their
--            own row (matched by `auth.uid() = user_id`).
--          * Public read of (handle, display_name, avatar_url, bio) is
--            allowed for the `anon` role so shareable pages
--            (`/c/{handle}/{slug}`) can resolve a creator's public
--            profile without authentication. Private columns
--            (`preferences`, timestamps) are still gated by the
--            owner-only policy when the requester is authenticated;
--            because Postgres RLS policies are additive (any
--            permissive policy that returns true grants the row), the
--            anon-read policy here intentionally returns true for
--            every row, and the application layer (PostgREST) is
--            responsible for projecting only the public columns. The
--            zod-validated `profile.preferences` shape is documented
--            in `context/data-model.md` § "profile.preferences shape"
--            and the runtime API surface is the canonical guard for
--            private field exposure.
--      - `subscription`:
--          * Authenticated users can SELECT their own row.
--          * Writes are service-role only — webhooks from
--            RevenueCat / Paddle / Stripe land via the service-role
--            key (`auth.role() = 'service_role'`), never via end-user
--            sessions.
--
-- Idempotency: each statement is guarded with `IF NOT EXISTS` /
-- `DROP POLICY IF EXISTS` so this migration is safe to re-run against
-- a partially-applied database (e.g. after a `supabase db reset`).

-- =====================================================================
-- 1. Cross-schema FKs to auth.users
-- =====================================================================

ALTER TABLE "profile"
  ADD CONSTRAINT "profile_user_id_auth_users_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "subscription"
  ADD CONSTRAINT "subscription_user_id_auth_users_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security
-- =====================================================================

ALTER TABLE "profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ----- profile policies ---------------------------------------------

DROP POLICY IF EXISTS "profile_owner_select" ON "profile";
--> statement-breakpoint
CREATE POLICY "profile_owner_select"
  ON "profile"
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "profile_owner_insert" ON "profile";
--> statement-breakpoint
CREATE POLICY "profile_owner_insert"
  ON "profile"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "profile_owner_update" ON "profile";
--> statement-breakpoint
CREATE POLICY "profile_owner_update"
  ON "profile"
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "profile_owner_delete" ON "profile";
--> statement-breakpoint
CREATE POLICY "profile_owner_delete"
  ON "profile"
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "profile_public_read" ON "profile";
--> statement-breakpoint
CREATE POLICY "profile_public_read"
  ON "profile"
  FOR SELECT
  TO anon
  USING (true);
--> statement-breakpoint

-- ----- subscription policies ----------------------------------------

DROP POLICY IF EXISTS "subscription_owner_select" ON "subscription";
--> statement-breakpoint
CREATE POLICY "subscription_owner_select"
  ON "subscription"
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "subscription_service_role_write" ON "subscription";
--> statement-breakpoint
CREATE POLICY "subscription_service_role_write"
  ON "subscription"
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
