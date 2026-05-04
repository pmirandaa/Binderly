-- T-DL-IMAGE-PIPELINE — RLS for the printing_image sidecar.
--
-- Mirrors the catalog-RLS posture established in
-- `0003_catalog_rls.sql` for `set` / `card` / `printing`:
--
--   - public-read (`anon`, `authenticated` may SELECT);
--   - service-role-write (no INSERT/UPDATE/DELETE policies; service
--     role bypasses RLS via Supabase's BYPASSRLS attribute);
--   - defence-in-depth REVOKE/GRANT pattern so the privilege
--     snapshot matches the policy posture even if someone disables
--     RLS for debugging.
--
-- Conventions:
--   - RLS policy changes ship in their own migration (per
--     `context/conventions.md` "Database migrations" + the
--     0008/0009 + 0006/0007 + 0002/0003 precedent).
--   - Idempotent: every statement is guarded with
--     `DROP POLICY IF EXISTS` so a partially-applied database
--     (e.g. after `supabase db reset`) is safe to re-migrate.

ALTER TABLE "public"."printing_image" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "printing_image_public_read" ON "public"."printing_image";
--> statement-breakpoint
CREATE POLICY "printing_image_public_read"
  ON "public"."printing_image"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "public"."printing_image" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT
  ON "public"."printing_image" TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "public"."printing_image" TO service_role;
