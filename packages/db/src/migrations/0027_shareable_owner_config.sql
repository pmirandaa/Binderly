-- T-SH-OWNER-CONFIG — shareables owner-config polish (#FU-50 + #FU-51).
--
-- Two additive columns + one policy tightening, bundled because they
-- both belong to the "owner configures their public surface" story and
-- both touch the security posture of the public render path:
--
--   1. #FU-50 — kill switch. `shareable.is_active boolean NOT NULL
--      DEFAULT true`. When false the shareable is unpublished: the
--      public render endpoint 404s (the handler filters it server-side,
--      since it reads with the service-role client that BYPASSRLS) and
--      the slug-gated anon/authenticated public-read policy hides the
--      row too (defense in depth — a direct PostgREST anon read no
--      longer returns it). The owner still sees the row through the
--      owner-select policy (`auth.uid() = user_id`), so it stays
--      editable in settings.
--
--   2. #FU-51 — social links. `profile.social_links_json jsonb`
--      (nullable). Stores the owner's ordered "link in bio" list as an
--      array of `{ label, url }` objects. Owner-level (not per
--      shareable) so it renders in the header of every public shareable
--      the owner publishes. The shape is validated by
--      `socialLinksSchema` in `@binderly/api-contracts`; the column is
--      deliberately untyped jsonb (NULL = "no links"), matching the
--      `profile.preferences` precedent in `0000_user_tables.sql`.
--
-- RLS posture. The only policy change is folding `is_active = true`
-- into the existing `shareable_public_read_by_slug` SELECT policy from
-- `0005_collections_rls.sql`. Every other policy / grant on `shareable`
-- and `profile` is unchanged: owner CRUD still keys on
-- `auth.uid() = user_id`, anon still has SELECT (now gated on
-- is_active), and `profile`'s public-read policy already returns true
-- for every row (the new column rides under the same projection rules).
--
-- Idempotency: the column adds use `IF NOT EXISTS`; the policy is
-- `DROP POLICY IF EXISTS` then `CREATE`, so the migration is safe to
-- re-run against a partially-applied database (e.g. after
-- `supabase db reset`). Mirrors the 0024 / 0026 hand-authored style.

-- =====================================================================
-- 1. #FU-50 — shareable.is_active kill switch
-- =====================================================================

ALTER TABLE "shareable"
	ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

-- Re-issue the public-read policy so an inactive shareable is invisible
-- to the anon role (and to authenticated callers who aren't the owner).
-- The slug-non-null predicate is preserved from 0005 (documents the
-- "public once it has a slug" intent); the `is_active` conjunct is the
-- new gate. Owners keep visibility through `shareable_owner_select`.
DROP POLICY IF EXISTS "shareable_public_read_by_slug" ON "shareable";
--> statement-breakpoint
CREATE POLICY "shareable_public_read_by_slug"
	ON "shareable"
	FOR SELECT
	TO anon, authenticated
	USING (slug IS NOT NULL AND is_active = true);
--> statement-breakpoint

-- =====================================================================
-- 2. #FU-51 — profile.social_links_json
-- =====================================================================

ALTER TABLE "profile"
	ADD COLUMN IF NOT EXISTS "social_links_json" jsonb;
