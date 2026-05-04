-- T-DL-SCHEMA-GRADING — companion migration for the grading tables.
--
-- Two concerns live here, intentionally bundled because they all
-- govern the security posture of `grading_submission` and
-- `grading_training_sample`:
--
--   1. Cross-schema foreign key from `grading_submission.user_id` to
--      `auth.users(id) ON DELETE CASCADE`. drizzle-kit can't author
--      cross-schema FKs that target Supabase's managed `auth` schema
--      (it doesn't track that schema), so this is emitted by hand
--      here. `grading_training_sample` has no `user_id` column —
--      training samples are not user-owned — and therefore needs no
--      such FK. Same option-1 pattern T-DL-SCHEMA-USERS established
--      (declare `user_id uuid` plain in Drizzle, attach the FK in
--      this RLS migration).
--
--   2. Row Level Security policies for both tables, mirroring
--      `context/data-model.md` § "RLS policies":
--
--      - `grading_submission`:
--          * Authenticated users can SELECT/INSERT/UPDATE/DELETE
--            their own row (matched by `auth.uid() = user_id`).
--          * No `anon` policy. Grading submissions are private user
--            data; even the public profile-shareable surface
--            (`/c/{handle}/{slug}`) does not expose grading data.
--            A user signed out completely sees nothing.
--          * Service role bypasses RLS via Supabase's BYPASSRLS
--            attribute, so no explicit service-role policy is
--            required. (The community-flywheel ingestion job runs
--            with the service-role key and reads only from rows
--            whose owner has set
--            `profile.preferences.grading_flywheel_opt_in = true` —
--            that opt-in check is enforced in the application layer,
--            not in RLS, so a single SQL-level posture covers both
--            user-visible reads and pipeline reads.)
--
--      - `grading_training_sample`:
--          * RLS enabled with **no permissive policies** for `anon`
--            or `authenticated`. Combined with the SQL-level REVOKE
--            below, end-user sessions cannot read or write at all.
--          * Service role has full DML, granted explicitly. The
--            stage-07 ingestion pipelines (T-GR-DATA-PSA,
--            T-GR-DATA-EBAY, T-GR-DATA-AUCTIONS) and the
--            community-flywheel cron all run with the service-role
--            key and write here.
--
-- Defense-in-depth REVOKE pattern (per T-DL-SCHEMA-CARDS' precedent):
-- Supabase's project init applies very permissive `ALTER DEFAULT
-- PRIVILEGES … GRANT ALL` on `public`, so new tables get
-- DELETE / INSERT / UPDATE / TRUNCATE / TRIGGER grants to `anon` and
-- `authenticated` automatically. RLS already blocks those operations
-- (no permissive policy + RLS enabled = denied), but the SQL-level
-- grants are misleading on `\dp` and could become a foot-gun if
-- someone disables RLS for debugging. We REVOKE the unwanted writes
-- here so the privilege snapshot matches the policy posture stated
-- in `data-model.md`. PostgREST checks SQL privileges before RLS, so
-- the `authenticated` GRANT below is what actually unlocks the read
-- path — RLS still gates which rows come back.
--
-- Idempotency: every statement is guarded with `IF NOT EXISTS` /
-- `DROP POLICY IF EXISTS` so this migration is safe to re-run
-- against a partially-applied database (e.g. after `supabase db
-- reset` or a re-spawn of the worktree).

-- =====================================================================
-- 1. Cross-schema FK to auth.users (grading_submission only)
-- =====================================================================

ALTER TABLE "grading_submission"
  ADD CONSTRAINT "grading_submission_user_id_auth_users_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security
-- =====================================================================

ALTER TABLE "grading_submission" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "grading_training_sample" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ----- grading_submission policies ----------------------------------

DROP POLICY IF EXISTS "grading_submission_owner_select" ON "grading_submission";
--> statement-breakpoint
CREATE POLICY "grading_submission_owner_select"
  ON "grading_submission"
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "grading_submission_owner_insert" ON "grading_submission";
--> statement-breakpoint
CREATE POLICY "grading_submission_owner_insert"
  ON "grading_submission"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "grading_submission_owner_update" ON "grading_submission";
--> statement-breakpoint
CREATE POLICY "grading_submission_owner_update"
  ON "grading_submission"
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "grading_submission_owner_delete" ON "grading_submission";
--> statement-breakpoint
CREATE POLICY "grading_submission_owner_delete"
  ON "grading_submission"
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- ----- grading_training_sample policies -----------------------------
--
-- No authenticated/anon policies. Service role bypasses RLS via
-- BYPASSRLS, so no explicit service-role policy is required either.
-- The SQL-level GRANT/REVOKE below is what makes the privilege
-- snapshot match the policy posture documented above.

-- =====================================================================
-- 3. Privilege grants (defense-in-depth)
-- =====================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "grading_submission" FROM anon, authenticated;
--> statement-breakpoint
REVOKE SELECT
  ON "grading_submission" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "grading_submission" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "grading_submission" TO service_role;
--> statement-breakpoint

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "grading_training_sample" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "grading_training_sample" TO service_role;
