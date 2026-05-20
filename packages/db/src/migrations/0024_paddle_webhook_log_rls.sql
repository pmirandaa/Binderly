-- T-PB-PADDLE — RLS for the paddle_webhook_log table.
--
-- Service-role-only posture, mirroring the precedents from
-- `0007_grading_rls.sql` (grading_training_sample),
-- `0009_pricing_rls.sql` (price_observation), and
-- `0015_data_conflict_rls.sql` (data_conflict):
--
--   * RLS is enabled with NO permissive policies for anon /
--     authenticated. End-user sessions cannot read or write at all.
--   * service_role has full DML, granted explicitly. The webhook
--     handler in `apps/web/app/api/paddle/webhook/route.ts` runs with
--     the service-role key (server-only env var; never bundled into
--     the client). End users never touch this audit log.
--
-- Defense-in-depth REVOKE pattern (per the 0007 / 0009 / 0011 / 0015
-- precedent): Supabase's project init applies very permissive
-- `ALTER DEFAULT PRIVILEGES … GRANT ALL` on `public`, so new tables
-- get DELETE / INSERT / UPDATE / TRUNCATE / TRIGGER grants to anon
-- and authenticated automatically. RLS already blocks those
-- operations (no permissive policy + RLS enabled = denied), but the
-- SQL-level grants are misleading on `\dp` and could become a
-- foot-gun if someone disables RLS for debugging. We REVOKE them
-- here so the privilege snapshot matches the policy posture.
-- PostgREST checks SQL privileges before RLS, so the matching
-- service_role GRANT is what unlocks the write path for the webhook
-- handler.
--
-- Idempotent: re-running this migration against a partially-applied
-- database (e.g. after `supabase db reset`) is safe — `ALTER TABLE …
-- ENABLE ROW LEVEL SECURITY` is a no-op when already enabled, and
-- REVOKE / GRANT statements are declarative.

ALTER TABLE "public"."paddle_webhook_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- No anon / authenticated policies. service_role bypasses RLS via
-- BYPASSRLS, so no explicit service-role policy is required either.
-- The SQL-level GRANT/REVOKE below is what makes the privilege
-- snapshot match the policy posture documented above.

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "public"."paddle_webhook_log" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "public"."paddle_webhook_log" TO service_role;
