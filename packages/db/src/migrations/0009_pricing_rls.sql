-- T-DL-SCHEMA-PRICING — companion migration for the pricing tables.
--
-- Three concerns live here, intentionally bundled because they all
-- govern the security and seed posture of `market`,
-- `price_observation`, `price_aggregate`, and `fx_rate`:
--
--   1. Market seed data. Idempotent INSERT … ON CONFLICT DO NOTHING
--      for the seven canonical market codes named in
--      `context/data-model.md` § "Markets" and PROJECT.md § 13:
--      EBAY_US (primary), EBAY_DE, EBAY_UK, EBAY_JP, CARDMARKET_EU
--      (secondary), TCGPLAYER_DERIVED (secondary; via aggregator
--      only, never direct), and OTHER (fallback bucket). The seed
--      lands here rather than in a runtime job because (a) the
--      `market` enum is part of the schema contract referenced by
--      every `price_observation` / `price_aggregate` insert, and
--      (b) `data-model.md` § "market" explicitly says
--      "Seed data inserted in the schema migration".
--
--   2. No cross-schema FKs. Pricing tables have no `user_id` column
--      — pricing data is sourced from third-party APIs, not user
--      activity — so there is nothing to wire up against
--      `auth.users(id)`. Recorded here for clarity vs the
--      0001/0005/0007 RLS migrations which all carry such an FK.
--
--   3. Row Level Security policies for all four pricing tables,
--      mirroring `context/data-model.md` § "RLS policies"
--      ("Catalog tables (`set`, `card`, `printing`, `price`,
--      `price_snapshot`) are public-read, service-role-write")
--      plus the `rules/01-data-layer.md` hard rule on pricing
--      tables ("Catalog tables are write-protected to clients.
--      Only the service role and the data-pipeline can write
--      `set`, `card`, `printing`, `price`, `price_snapshot`"):
--
--      - `market`, `price_aggregate`, `fx_rate` (consumer-facing):
--          * Public-read (`anon, authenticated` SELECT).
--          * No write policies. service_role bypasses RLS via
--            BYPASSRLS, so no explicit service-role policy is
--            required. (Same posture as set / card / printing in
--            `0003_catalog_rls.sql`.)
--
--      - `price_observation` (pipeline-internal):
--          * RLS enabled with **no permissive policies** for
--            `anon` or `authenticated`. End-user sessions cannot
--            read or write at all.
--          * Service role has full DML, granted explicitly. The
--            stage-01 ingestion adapters (T-DL-PRICING-AGGREGATOR,
--            T-DL-PRICING-EBAY-BROWSE) all run with the service-
--            role key and write here. The display layer reads
--            from `price_aggregate` / `mv_current_price`, never
--            from `price_observation` directly. (Same posture as
--            grading_training_sample in `0007_grading_rls.sql`.)
--
-- Defense-in-depth REVOKE pattern (per T-DL-SCHEMA-CARDS' /
-- T-DL-SCHEMA-GRADING's precedent): Supabase's project init
-- applies very permissive `ALTER DEFAULT PRIVILEGES … GRANT ALL`
-- on `public`, so new tables get DELETE / INSERT / UPDATE /
-- TRUNCATE / TRIGGER grants to `anon` and `authenticated`
-- automatically. RLS already blocks those operations (no
-- permissive policy + RLS enabled = denied), but the SQL-level
-- grants are misleading on `\dp` and could become a foot-gun if
-- someone disables RLS for debugging. We REVOKE the unwanted
-- writes here so the privilege snapshot matches the policy
-- posture stated in `data-model.md`. PostgREST checks SQL
-- privileges before RLS, so the `authenticated` GRANT below is
-- what actually unlocks the read path on the consumer-facing
-- tables — RLS still gates which rows come back (here: all of
-- them, public-read).
--
-- Idempotency: every statement is guarded with
-- `DROP POLICY IF EXISTS` / `ON CONFLICT DO NOTHING` so this
-- migration is safe to re-run against a partially-applied database
-- (e.g. after `supabase db reset` or a re-spawn of the worktree).

-- =====================================================================
-- 1. Market seed data
-- =====================================================================
--
-- `tier` controls UI default behavior (PROJECT.md § 13):
--   - 'primary'   — surfaced as the default headline price
--   - 'secondary' — surfaced when the user toggles "all markets"
--                   or has set a non-default default_market in
--                   their profile preferences.
-- TCGPLAYER_DERIVED is reachable only through the paid aggregator
-- (Layer 1) — never via direct API calls — per
-- `context/legal-and-brand.md` ("No live API calls to
-- api.tcgplayer.com from any environment").

INSERT INTO "market" ("code", "display_name", "tier", "default_currency", "region", "notes") VALUES
  ('EBAY_US', 'eBay US', 'primary', 'USD', 'US', 'Primary market: highest volume and broadest grade-tier coverage.'),
  ('EBAY_DE', 'eBay Germany', 'secondary', 'EUR', 'EU', 'Secondary market: surfaced when the user toggles all-markets.'),
  ('EBAY_UK', 'eBay UK', 'secondary', 'GBP', 'UK', 'Secondary market: surfaced when the user toggles all-markets.'),
  ('EBAY_JP', 'eBay Japan', 'secondary', 'JPY', 'JP', 'Secondary market: limited Pokémon TCG coverage; populated post-launch.'),
  ('CARDMARKET_EU', 'Cardmarket', 'secondary', 'EUR', 'EU', 'Secondary market: reaches us only via the paid aggregator (Cardmarket API is closed).'),
  ('TCGPLAYER_DERIVED', 'TCGplayer (via aggregator)', 'secondary', 'USD', 'US', 'Aggregator-derived only; never via direct TCGplayer API per legal posture.'),
  ('OTHER', 'Other', 'secondary', 'USD', 'GLOBAL', 'Fallback bucket for ad-hoc sources we have not yet first-classed.')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security
-- =====================================================================

ALTER TABLE "market" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "price_observation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "price_aggregate" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fx_rate" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ----- market policies ----------------------------------------------

DROP POLICY IF EXISTS "market_public_read" ON "market";
--> statement-breakpoint
CREATE POLICY "market_public_read"
  ON "market"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- ----- price_aggregate policies -------------------------------------

DROP POLICY IF EXISTS "price_aggregate_public_read" ON "price_aggregate";
--> statement-breakpoint
CREATE POLICY "price_aggregate_public_read"
  ON "price_aggregate"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- ----- fx_rate policies ---------------------------------------------

DROP POLICY IF EXISTS "fx_rate_public_read" ON "fx_rate";
--> statement-breakpoint
CREATE POLICY "fx_rate_public_read"
  ON "fx_rate"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- ----- price_observation policies -----------------------------------
--
-- No authenticated/anon policies. Service role bypasses RLS via
-- BYPASSRLS, so no explicit service-role policy is required either.
-- The SQL-level GRANT/REVOKE below is what makes the privilege
-- snapshot match the policy posture documented above.

-- =====================================================================
-- 3. Privilege grants (defense-in-depth)
-- =====================================================================

-- ----- market: public-read, service-role-write ----------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "market" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT
  ON "market" TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "market" TO service_role;
--> statement-breakpoint

-- ----- price_aggregate: public-read, service-role-write -------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "price_aggregate" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT
  ON "price_aggregate" TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "price_aggregate" TO service_role;
--> statement-breakpoint

-- ----- fx_rate: public-read, service-role-write ---------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "fx_rate" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT
  ON "fx_rate" TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "fx_rate" TO service_role;
--> statement-breakpoint

-- ----- price_observation: service-role-only -------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "price_observation" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "price_observation" TO service_role;
