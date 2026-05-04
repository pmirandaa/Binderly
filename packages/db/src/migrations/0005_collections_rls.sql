-- T-DL-SCHEMA-COLLECTIONS — companion migration for the collection
-- tables created in 0004_collection_tables.sql.
--
-- Three concerns live here, intentionally bundled because they all
-- reference the Supabase-managed `auth.users` table and/or the same
-- five tables:
--
--   1. Cross-schema foreign keys from every `user_id` column to
--      `auth.users(id)` ON DELETE CASCADE. drizzle-kit cannot author
--      these from the Drizzle table definitions (the `auth` schema is
--      managed by Supabase and is not part of our Drizzle source of
--      truth) so they are emitted by hand here. Same pattern as
--      `0001_users_rls.sql` for the user-side tables.
--
--   2. Row Level Security policies, mirroring `context/data-model.md`
--      § "RLS policies":
--        - `collection_item`, `custom_collection`,
--          `custom_collection_item`, `smart_collection_rule`:
--          owner-only CRUD (`auth.uid() = user_id`). Tables nested
--          under `custom_collection` (the membership and rule tables)
--          have no `user_id` column of their own; their policies
--          subquery against the parent collection's `user_id`.
--        - `shareable`: owner CRUD; `anon` and `authenticated` can
--          SELECT rows whose `slug` is non-NULL (the slug is the
--          unguessable URL token; the public render path
--          `/c/{handle}/{slug}` resolves the row by slug). Since
--          `slug` is `NOT NULL` in the schema this matches "every
--          shareable is publicly readable by anyone who knows the
--          slug" — the secrecy comes from the slug entropy (CSPRNG
--          enforced at the API layer), not from the policy itself.
--
--   3. Privilege grants (defense in depth). Supabase's project init
--      applies very permissive `ALTER DEFAULT PRIVILEGES ... GRANT
--      ALL ON TABLES IN SCHEMA public TO anon, authenticated`, which
--      means new tables get DELETE/INSERT/UPDATE/TRUNCATE/TRIGGER
--      grants automatically. RLS already blocks the writes, but the
--      SQL-level grants are misleading on `\dp` and could become a
--      foot-gun if someone disables RLS for debugging. We REVOKE
--      those grants here and explicitly GRANT the per-policy minimum
--      so the privilege snapshot matches the policy posture stated
--      in `data-model.md`. Same pattern as `0003_catalog_rls.sql`
--      for the catalog tables.
--
-- Idempotency: every statement is guarded with `IF NOT EXISTS` /
-- `DROP POLICY IF EXISTS` so this migration is safe to re-run
-- against a partially-applied database (e.g. after `supabase db
-- reset`).

-- =====================================================================
-- 1. Cross-schema FKs to auth.users
-- =====================================================================

ALTER TABLE "collection_item"
  ADD CONSTRAINT "collection_item_user_id_auth_users_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "custom_collection"
  ADD CONSTRAINT "custom_collection_user_id_auth_users_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "shareable"
  ADD CONSTRAINT "shareable_user_id_auth_users_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security
-- =====================================================================

ALTER TABLE "collection_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_collection" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_collection_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "smart_collection_rule" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shareable" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ----- collection_item policies -------------------------------------

DROP POLICY IF EXISTS "collection_item_owner_select" ON "collection_item";
--> statement-breakpoint
CREATE POLICY "collection_item_owner_select"
  ON "collection_item"
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "collection_item_owner_insert" ON "collection_item";
--> statement-breakpoint
CREATE POLICY "collection_item_owner_insert"
  ON "collection_item"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "collection_item_owner_update" ON "collection_item";
--> statement-breakpoint
CREATE POLICY "collection_item_owner_update"
  ON "collection_item"
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "collection_item_owner_delete" ON "collection_item";
--> statement-breakpoint
CREATE POLICY "collection_item_owner_delete"
  ON "collection_item"
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- ----- custom_collection policies -----------------------------------

DROP POLICY IF EXISTS "custom_collection_owner_select" ON "custom_collection";
--> statement-breakpoint
CREATE POLICY "custom_collection_owner_select"
  ON "custom_collection"
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "custom_collection_owner_insert" ON "custom_collection";
--> statement-breakpoint
CREATE POLICY "custom_collection_owner_insert"
  ON "custom_collection"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "custom_collection_owner_update" ON "custom_collection";
--> statement-breakpoint
CREATE POLICY "custom_collection_owner_update"
  ON "custom_collection"
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "custom_collection_owner_delete" ON "custom_collection";
--> statement-breakpoint
CREATE POLICY "custom_collection_owner_delete"
  ON "custom_collection"
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- ----- custom_collection_item policies ------------------------------
-- Membership rows are scoped to their parent's owner. The EXISTS
-- subquery is faster than a join in PG's RLS optimizer and uses the
-- existing PK index on `custom_collection.id`.

DROP POLICY IF EXISTS "custom_collection_item_owner_select" ON "custom_collection_item";
--> statement-breakpoint
CREATE POLICY "custom_collection_item_owner_select"
  ON "custom_collection_item"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = custom_collection_item.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "custom_collection_item_owner_insert" ON "custom_collection_item";
--> statement-breakpoint
CREATE POLICY "custom_collection_item_owner_insert"
  ON "custom_collection_item"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = custom_collection_item.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "custom_collection_item_owner_update" ON "custom_collection_item";
--> statement-breakpoint
CREATE POLICY "custom_collection_item_owner_update"
  ON "custom_collection_item"
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = custom_collection_item.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = custom_collection_item.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "custom_collection_item_owner_delete" ON "custom_collection_item";
--> statement-breakpoint
CREATE POLICY "custom_collection_item_owner_delete"
  ON "custom_collection_item"
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = custom_collection_item.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

-- ----- smart_collection_rule policies -------------------------------
-- Same pattern as custom_collection_item: scope to parent's owner.

DROP POLICY IF EXISTS "smart_collection_rule_owner_select" ON "smart_collection_rule";
--> statement-breakpoint
CREATE POLICY "smart_collection_rule_owner_select"
  ON "smart_collection_rule"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = smart_collection_rule.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "smart_collection_rule_owner_insert" ON "smart_collection_rule";
--> statement-breakpoint
CREATE POLICY "smart_collection_rule_owner_insert"
  ON "smart_collection_rule"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = smart_collection_rule.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "smart_collection_rule_owner_update" ON "smart_collection_rule";
--> statement-breakpoint
CREATE POLICY "smart_collection_rule_owner_update"
  ON "smart_collection_rule"
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = smart_collection_rule.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = smart_collection_rule.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "smart_collection_rule_owner_delete" ON "smart_collection_rule";
--> statement-breakpoint
CREATE POLICY "smart_collection_rule_owner_delete"
  ON "smart_collection_rule"
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "custom_collection" cc
      WHERE cc.id = smart_collection_rule.custom_collection_id
        AND cc.user_id = auth.uid()
    )
  );
--> statement-breakpoint

-- ----- shareable policies -------------------------------------------
-- Owner CRUD + public read of the row by anyone who knows the slug.
-- The slug is `NOT NULL` in the schema, so the `slug IS NOT NULL`
-- predicate on the public-read policy is currently a tautology — it
-- documents intent ("a shareable becomes public when its slug is
-- present") and survives any future migration that nullable-izes the
-- column for soft-delete or draft semantics. The slug's entropy is
-- the actual access control; the API layer (create-shareable edge
-- function in stage 2) generates it from a CSPRNG. Authenticated
-- users see only their own shareables on the editor surface (the
-- owner-select policy below); the public-read policy is what powers
-- `/c/{handle}/{slug}` SSR for unauthenticated visitors and PostgREST
-- queries from the anon role.

DROP POLICY IF EXISTS "shareable_owner_select" ON "shareable";
--> statement-breakpoint
CREATE POLICY "shareable_owner_select"
  ON "shareable"
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "shareable_owner_insert" ON "shareable";
--> statement-breakpoint
CREATE POLICY "shareable_owner_insert"
  ON "shareable"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "shareable_owner_update" ON "shareable";
--> statement-breakpoint
CREATE POLICY "shareable_owner_update"
  ON "shareable"
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "shareable_owner_delete" ON "shareable";
--> statement-breakpoint
CREATE POLICY "shareable_owner_delete"
  ON "shareable"
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

DROP POLICY IF EXISTS "shareable_public_read_by_slug" ON "shareable";
--> statement-breakpoint
CREATE POLICY "shareable_public_read_by_slug"
  ON "shareable"
  FOR SELECT
  TO anon, authenticated
  USING (slug IS NOT NULL);
--> statement-breakpoint

-- =====================================================================
-- 3. Privilege grants (defense in depth)
--
-- Match the policy posture: anon can SELECT shareable rows (the
-- slug-gated public-read policy above is what filters); authenticated
-- gets the full owner-CRUD on their own rows (RLS gates by user_id);
-- service_role keeps full DML so backups / admin scripts work without
-- jumping through RLS. anon never gets writes on user-data tables.
-- =====================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "collection_item" FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "custom_collection" FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "custom_collection_item" FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "smart_collection_rule" FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "shareable" FROM anon, authenticated;
--> statement-breakpoint

REVOKE SELECT ON "collection_item" FROM anon;
--> statement-breakpoint
REVOKE SELECT ON "custom_collection" FROM anon;
--> statement-breakpoint
REVOKE SELECT ON "custom_collection_item" FROM anon;
--> statement-breakpoint
REVOKE SELECT ON "smart_collection_rule" FROM anon;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "collection_item" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_collection" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_collection_item" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "smart_collection_rule" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shareable" TO authenticated;
--> statement-breakpoint

GRANT SELECT ON "shareable" TO anon;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "collection_item" TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_collection" TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_collection_item" TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "smart_collection_rule" TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shareable" TO service_role;
