-- T-GR-COMMUNITY-FLYWHEEL — companion RLS migration for community_submission.
--
-- Two concerns, bundled because they both govern the security posture of the
-- user-owned `community_submission` table:
--
--   1. Cross-schema FK from `community_submission.user_id` to
--      `auth.users(id) ON DELETE CASCADE`. drizzle-kit can't author
--      cross-schema FKs targeting Supabase's managed `auth` schema, so it's
--      emitted by hand here — the same option-1 pattern T-DL-SCHEMA-USERS /
--      `0007_grading_rls.sql` established.
--
--   2. Row Level Security: owner-CRUD, identical in shape to
--      `grading_submission` (`0007_grading_rls.sql`) and every collections
--      table (`0005_collections_rls.sql`):
--
--      - Authenticated users SELECT/INSERT/UPDATE/DELETE only their own row
--        (matched by `auth.uid() = user_id`).
--      - No `anon` policy. Community submissions are private user data.
--      - Service role bypasses RLS via Supabase's BYPASSRLS attribute, so no
--        explicit service-role policy is required. The flywheel ingestion job
--        runs with the service-role key and reads only rows whose owner set
--        `consent = true` (enforced in the application layer, not RLS — same
--        posture the grading flywheel opt-in takes in `0007_grading_rls.sql`).
--
-- Defense-in-depth REVOKE pattern (per the 0005 / 0007 precedent): Supabase's
-- project init applies permissive `ALTER DEFAULT PRIVILEGES … GRANT ALL` on
-- `public`, so new tables get write grants to anon / authenticated
-- automatically. RLS already blocks those (no permissive policy + RLS = denied)
-- but the SQL-level grants are misleading on `\dp`, so we REVOKE the unwanted
-- ones and GRANT exactly what the policies intend. PostgREST checks SQL
-- privileges before RLS, so the `authenticated` GRANT below is what unlocks the
-- owner-scoped read/write path; RLS still gates which rows are visible.
--
-- Idempotency: every statement is guarded so the migration is safe to re-run
-- against a partially-applied database (e.g. after `supabase db reset`).

-- =====================================================================
-- 1. Cross-schema FK to auth.users
-- =====================================================================

ALTER TABLE "community_submission"
	ADD CONSTRAINT "community_submission_user_id_auth_users_fk"
	FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security
-- =====================================================================

ALTER TABLE "community_submission" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "community_submission_owner_select" ON "community_submission";
--> statement-breakpoint
CREATE POLICY "community_submission_owner_select"
	ON "community_submission"
	FOR SELECT
	TO authenticated
	USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "community_submission_owner_insert" ON "community_submission";
--> statement-breakpoint
CREATE POLICY "community_submission_owner_insert"
	ON "community_submission"
	FOR INSERT
	TO authenticated
	WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "community_submission_owner_update" ON "community_submission";
--> statement-breakpoint
CREATE POLICY "community_submission_owner_update"
	ON "community_submission"
	FOR UPDATE
	TO authenticated
	USING (auth.uid() = user_id)
	WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "community_submission_owner_delete" ON "community_submission";
--> statement-breakpoint
CREATE POLICY "community_submission_owner_delete"
	ON "community_submission"
	FOR DELETE
	TO authenticated
	USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 3. Privilege grants (defense-in-depth)
-- =====================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
	ON "community_submission" FROM anon, authenticated;
--> statement-breakpoint
REVOKE SELECT
	ON "community_submission" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
	ON "community_submission" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
	ON "community_submission" TO service_role;
