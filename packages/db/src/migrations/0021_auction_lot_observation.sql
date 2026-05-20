-- T-GR-DATA-AUCTIONS — auction_lot_observation table.
--
-- Realised auction outcomes for graded Pokémon slabs from PWCC Marketplace
-- and Goldin Auctions.  Populated by the stage-07 auction archive scrapers.
--
-- Dual write-path:
--   1. This table — full pricing + provenance record.
--   2. grading_training_sample (already exists, CHECK constraint already
--      includes `auction_pwcc` / `auction_goldin` sources) — image + grade
--      tuple for ML training.
--
-- Idempotency:
--   UNIQUE(auction_house, lot_id) is the upsert key.  Re-scraping the same
--   closed lot bumps `updated_at` and refreshes columns only when content
--   changes (raw_html_sha256 differs).
--
-- RLS posture: service-role only.  Companion migration
--   0022_auction_lot_observation_rls.sql (follow-up) should REVOKE public /
--   authenticated access.  For now no explicit GRANT is needed beyond the
--   default (no grants = service_role only via Supabase conventions).
CREATE TABLE "auction_lot_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" text NOT NULL,
	"auction_house" text NOT NULL,
	"auction_id" text,
	"auction_name" text,
	"lot_title" text NOT NULL,
	"parsed_grading_company" text,
	"parsed_overall_grade" numeric(3, 1),
	"parsed_sub_grades" jsonb,
	"realised_price_cents" bigint,
	"currency_code" text,
	"realised_premium_cents" bigint,
	"closed_at" timestamp with time zone,
	"printing_id" uuid,
	"lot_image_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"raw_html_sha256" text,
	"parser_version" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auction_lot_observation_house_lot_unique" UNIQUE("auction_house","lot_id"),
	CONSTRAINT "auction_lot_observation_auction_house_check" CHECK ("auction_lot_observation"."auction_house" IN ('pwcc', 'goldin'))
);
--> statement-breakpoint
ALTER TABLE "auction_lot_observation" ADD CONSTRAINT "auction_lot_observation_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "auction_lot_observation_printing_id_idx" ON "auction_lot_observation" USING btree ("printing_id");
--> statement-breakpoint
CREATE INDEX "auction_lot_observation_house_grade_idx" ON "auction_lot_observation" USING btree ("auction_house","parsed_grading_company","parsed_overall_grade");
--> statement-breakpoint
CREATE INDEX "auction_lot_observation_closed_at_idx" ON "auction_lot_observation" USING btree ("closed_at" DESC NULLS LAST);
