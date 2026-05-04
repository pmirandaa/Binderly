-- T-DL-PROFILE-GRANTS-FIX (fixes Q-003) — additive grants for profile + subscription.
--
-- Background: `0001_users_rls.sql` shipped RLS policies for `profile` and
-- `subscription` but is missing the companion `REVOKE`/`GRANT` block that
-- every other RLS migration in this repo carries
-- (`0003_catalog_rls.sql`, `0005_collections_rls.sql`,
-- `0007_grading_rls.sql`, `0009_pricing_rls.sql`,
-- `0011_image_provenance_rls.sql`). The verify-rls suite shipped in
-- T-DL-RLS-POLICIES (PR #28) surfaced the gap: against fresh local
-- Supabase (CLI 2.98.1 / PG17, where `pg_default_acl` for `public` is
-- empty) the four `profile`-touching behavioral assertions fail with
-- `permission denied for table profile` because PostgREST checks SQL
-- privileges before RLS — and `profile` ends up with no grants at all
-- for `anon` / `authenticated` / `service_role`.
--
-- In hosted Supabase the platform's project-init runs
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
-- authenticated, service_role` before any migration, so `profile` and
-- `subscription` already have these grants in production. This migration
-- is a no-op there (the GRANTs match what's already present; the REVOKEs
-- strip a write slice that's already blocked by the missing INSERT/
-- UPDATE/DELETE policies). Locally it brings the privilege snapshot in
-- line with the policy posture and unblocks the verify-rls suite (97
-- passed / 0 failed).
--
-- We do NOT modify `0001_users_rls.sql` — that migration is merged on
-- `main` and rewriting it would change history. This is the additive
-- corrective per Q-003 Option 1.
--
-- Pattern source (mirrored verbatim, adapted for the two tables):
--   - REVOKE INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from anon
--     and authenticated, then GRANT only what each policy needs. Same
--     shape as `0003_catalog_rls.sql` / `0005_collections_rls.sql`.
--   - For tables with no `anon` SELECT policy (`subscription`), also
--     REVOKE SELECT from anon. Same shape as `grading_submission` in
--     `0007_grading_rls.sql`.
--   - GRANT SELECT/INSERT/UPDATE/DELETE to service_role for both
--     tables (service_role bypasses RLS via Supabase's BYPASSRLS
--     attribute, but PostgREST still checks SQL privileges first;
--     keeping the GRANT explicit matches the convention from every
--     other RLS migration).
--
-- Per-table posture (from `packages/db/src/migrations/rls/README.md`
-- §§ 2 + 3 and the policies in 0001):
--
--   `profile` — hybrid owner-CRUD + anon-public-read (same shape as
--   `shareable` in 0005):
--     * authenticated: SELECT (owner row), INSERT/UPDATE/DELETE (own
--       row only) — gated by `profile_owner_*` policies.
--     * anon:          SELECT (every row) — gated by
--       `profile_public_read` USING (true). Application layer projects
--       only the public columns for unauthenticated traffic; RLS does
--       not gate the column projection.
--     * service_role:  full DML (BYPASSRLS).
--
--   `subscription` — owner-SELECT, service-role-write (same shape as
--   `grading_submission` in 0007 minus the owner write grants):
--     * authenticated: SELECT only (own row) — gated by
--       `subscription_owner_select`. Writes are webhook-only via the
--       service-role key per `subscription_service_role_write`; end
--       users never INSERT/UPDATE/DELETE here.
--     * anon:          no access at all (no anon policy → no rows under
--       RLS, and no SELECT grant under PostgREST).
--     * service_role:  full DML (BYPASSRLS).
--
-- Idempotency: REVOKE / GRANT are idempotent in PostgreSQL by
-- construction; re-running this migration against a database that
-- already has the grants is a no-op. No `IF EXISTS` guards needed.

-- =====================================================================
-- profile — owner CRUD for authenticated, public SELECT for anon,
--           full DML for service_role.
-- =====================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "profile" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "profile" TO authenticated;
--> statement-breakpoint
GRANT SELECT
  ON "profile" TO anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "profile" TO service_role;
--> statement-breakpoint

-- =====================================================================
-- subscription — owner SELECT for authenticated, no anon access,
--                full DML for service_role.
-- =====================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "subscription" FROM anon, authenticated;
--> statement-breakpoint
REVOKE SELECT
  ON "subscription" FROM anon;
--> statement-breakpoint
GRANT SELECT
  ON "subscription" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "subscription" TO service_role;
