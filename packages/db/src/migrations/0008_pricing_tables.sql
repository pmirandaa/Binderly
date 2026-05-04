CREATE TABLE "market" (
	"code" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"tier" text NOT NULL,
	"default_currency" text NOT NULL,
	"region" text,
	"notes" text,
	CONSTRAINT "market_tier_check" CHECK ("market"."tier" IN ('primary', 'secondary'))
);
--> statement-breakpoint
CREATE TABLE "price_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printing_id" uuid NOT NULL,
	"grade_tier" text NOT NULL,
	"market" text NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text,
	"observation_kind" text NOT NULL,
	"observed_price" numeric(12, 2) NOT NULL,
	"observed_currency" text NOT NULL,
	"shipping" numeric(12, 2),
	"parse_confidence" numeric(3, 2),
	"observed_at" timestamp with time zone NOT NULL,
	"observed_date" date NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_metadata" jsonb,
	CONSTRAINT "price_observation_source_source_listing_id_unique" UNIQUE("source","source_listing_id"),
	CONSTRAINT "price_observation_observation_kind_check" CHECK ("price_observation"."observation_kind" IN ('sold', 'active_listing', 'aggregator_quote'))
);
--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"rate_date" date NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" numeric(14, 6) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "fx_rate_pkey" PRIMARY KEY("rate_date","base_currency","quote_currency")
);
--> statement-breakpoint
CREATE TABLE "price_aggregate" (
	"printing_id" uuid NOT NULL,
	"grade_tier" text NOT NULL,
	"market" text NOT NULL,
	"currency" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"median_price" numeric(12, 2),
	"mean_price" numeric(12, 2),
	"low_price" numeric(12, 2),
	"high_price" numeric(12, 2),
	"sample_count" integer NOT NULL,
	"source_breakdown" jsonb NOT NULL,
	"observation_kind_breakdown" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "price_aggregate_pkey" PRIMARY KEY("printing_id","grade_tier","market","currency","period_start")
);
--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_market_market_code_fk" FOREIGN KEY ("market") REFERENCES "public"."market"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_aggregate" ADD CONSTRAINT "price_aggregate_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_aggregate" ADD CONSTRAINT "price_aggregate_market_market_code_fk" FOREIGN KEY ("market") REFERENCES "public"."market"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_observation_printing_grade_market_observed_idx" ON "price_observation" USING btree ("printing_id","grade_tier","market","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_observation_observed_date_idx" ON "price_observation" USING btree ("observed_date");--> statement-breakpoint
CREATE INDEX "fx_rate_rate_date_quote_currency_idx" ON "fx_rate" USING btree ("rate_date" DESC NULLS LAST,"quote_currency");