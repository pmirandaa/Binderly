-- T-DL-DATA-CONFLICT-TABLE — RLS for the data_conflict table.
--
-- Service-role-only posture. Mirrors the
-- `price_observation` block from `0009_pricing_rls.sql` and the
-- `grading_training_sample` block from `0007_grading_rls.sql`:
--
--   - RLS is enabled with NO permissive policies for anon /
--     authenticated. End-user sessions cannot read or write at all.
--   - service_role has full DML, granted explicitly. The data-
--     pipeline runs with the service-role key and writes here via
--     `DrizzleConflictLogRepo`
--     (`data-pipeline/src/resolver/conflict-log.ts`). Per
--     `rules/01-data-layer.md` ("Conflicts are surfaced, not
--     silenced") this table is debug-tier — operators query it via
--     psql or the future T-DL-ADMIN-DEBUG-SURFACES read-only views.
--
-- Defense-in-depth REVOKE pattern (per the 0007 / 0009 / 0011
-- precedent): Supabase's project init applies very permissive
-- `ALTER DEFAULT PRIVILEGES … GRANT ALL` on `public`, so new tables
-- get DELETE / INSERT / UPDATE / TRUNCATE / TRIGGER grants to anon
-- and authenticated automatically. RLS already blocks those
-- operations (no permissive policy + RLS enabled = denied), but the
-- SQL-level grants are misleading on `\dp` and could become a
-- foot-gun if someone disables RLS for debugging. We REVOKE them
-- here so the privilege snapshot matches the policy posture.
-- PostgREST checks SQL privileges before RLS, so the matching
-- service_role GRANT is what unlocks the write path for the
-- data-pipeline.
--
-- Idempotent: re-running this migration against a partially-
-- applied database (e.g. after `supabase db reset`) is safe —
-- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` is a no-op when
-- already enabled, and REVOKE / GRANT statements are
-- declarative.

ALTER TABLE "public"."data_conflict" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- No anon / authenticated policies. service_role bypasses RLS via
-- BYPASSRLS, so no explicit service-role policy is required either.
-- The SQL-level GRANT/REVOKE below is what makes the privilege
-- snapshot match the policy posture documented above.

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "public"."data_conflict" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "public"."data_conflict" TO service_role;
