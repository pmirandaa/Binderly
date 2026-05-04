-- T-DL-SCHEMA-CARDS: row-level security for the catalog tables.
--
-- Posture (from context/data-model.md and rules/01-data-layer.md):
--   - Catalog tables are PUBLIC-READ. Anyone (anon, signed-in user) can
--     SELECT. Browse, search, scanner lookup, and shareable rendering
--     all rely on this.
--   - Catalog tables are SERVICE-ROLE-WRITE. Ingestion (data-pipeline,
--     edge functions running with service_role) is the only writer.
--     Supabase's `service_role` has BYPASSRLS, so we do not author
--     INSERT/UPDATE/DELETE policies here — the absence of a policy
--     plus RLS-enabled means non-service roles cannot write.
--
-- Authoring this migration *separately* from the schema migration is
-- the convention from context/conventions.md ("RLS policy changes ship
-- in their own migration") and is restated in packages/db/README.md
-- ("If you need to author a non-Drizzle migration ... increment the
-- next free number and add a SQL file by hand. Keep the journal in
-- sync."). Drizzle-kit does not model RLS in its diff engine.
--
-- Scope note: the broader user-data RLS work (profiles, collections,
-- grading, etc.) lives in T-DL-RLS-POLICIES, which owns
-- `packages/db/src/migrations/rls/` per dependencies.yaml. That task
-- can layer on additional catalog policies if/when needed (e.g.
-- admin-only debug surfaces); the public-read posture established
-- here is the steady state.

-- ---------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------
ALTER TABLE "public"."set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."card" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."printing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------
-- Public-read policies
--
-- `USING (true)` evaluates per row at SELECT time; with RLS enabled
-- and no other policies, this is the only thing letting anon /
-- authenticated read.
-- ---------------------------------------------------------------
CREATE POLICY "set_public_read"
  ON "public"."set"
  FOR SELECT
  TO anon, authenticated
  USING (true);--> statement-breakpoint

CREATE POLICY "card_public_read"
  ON "public"."card"
  FOR SELECT
  TO anon, authenticated
  USING (true);--> statement-breakpoint

CREATE POLICY "printing_public_read"
  ON "public"."printing"
  FOR SELECT
  TO anon, authenticated
  USING (true);--> statement-breakpoint

-- ---------------------------------------------------------------
-- Privilege grants (defense-in-depth)
--
-- Supabase's project init applies very permissive `ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL` on the `public` schema, which means
-- new tables get DELETE / INSERT / UPDATE / TRUNCATE / TRIGGER
-- grants to `anon` and `authenticated` automatically. RLS already
-- blocks those operations (no write policy + RLS enabled =
-- denied), but the SQL-level grants are misleading on `\dp` and
-- could become a foot-gun if someone disables RLS for debugging.
--
-- We REVOKE the unwanted writes here so the privilege snapshot
-- matches the policy posture stated in `data-model.md`
-- ("public-read, service-role-write"). PostgREST checks SQL
-- privileges before RLS, so we re-GRANT SELECT explicitly to make
-- the read path airtight regardless of Supabase default drift.
-- ---------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "public"."set" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "public"."card" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "public"."printing" FROM anon, authenticated;--> statement-breakpoint

GRANT SELECT ON "public"."set" TO anon, authenticated;--> statement-breakpoint
GRANT SELECT ON "public"."card" TO anon, authenticated;--> statement-breakpoint
GRANT SELECT ON "public"."printing" TO anon, authenticated;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."set" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."card" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."printing" TO service_role;
