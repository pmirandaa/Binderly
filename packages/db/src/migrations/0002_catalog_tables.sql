-- T-DL-SCHEMA-CARDS: catalog tables (set, card, printing).
--
-- The `pg_trgm` extension is required for the GIN trigram index on
-- `card.name` (in-app autocomplete + scanner OCR fallback). Drizzle-kit
-- does not auto-emit `CREATE EXTENSION` statements, so we prepend it
-- here. Local Supabase + the cloud Supabase image both have pg_trgm
-- available; the `IF NOT EXISTS` guard makes this idempotent against
-- environments where it's already enabled (e.g. via a prior init.sql).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TABLE "set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_key" text NOT NULL,
	"code" text NOT NULL,
	"language" text NOT NULL,
	"name" text NOT NULL,
	"series" text,
	"release_date" date NOT NULL,
	"printed_total" integer,
	"total" integer,
	"logo_url" text,
	"symbol_url" text,
	"master_set_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_canonical_key_unique" UNIQUE("canonical_key")
);
--> statement-breakpoint
CREATE TABLE "card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_key" text NOT NULL,
	"set_id" uuid NOT NULL,
	"language" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"name_localized" jsonb,
	"type" text,
	"subtype" text,
	"hp" integer,
	"illustrator" text,
	"flavor_text" text,
	"attacks" jsonb,
	"weakness" jsonb,
	"resistance" jsonb,
	"retreat_cost" integer,
	"rarity" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_canonical_key_unique" UNIQUE("canonical_key")
);
--> statement-breakpoint
CREATE TABLE "printing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_key" text NOT NULL,
	"card_id" uuid NOT NULL,
	"variant_class" text NOT NULL,
	"variant_flags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"variant_code" text NOT NULL,
	"include_in_master_set" boolean NOT NULL,
	"image_small_url" text,
	"image_large_url" text,
	"image_source_url" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printing_variant_key_unique" UNIQUE("variant_key")
);
--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_set_id_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printing" ADD CONSTRAINT "printing_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "set_release_date_language_code_idx" ON "set" USING btree ("release_date" DESC NULLS LAST,"language","code");--> statement-breakpoint
CREATE INDEX "card_set_id_number_idx" ON "card" USING btree ("set_id","number");--> statement-breakpoint
CREATE INDEX "card_name_trgm_idx" ON "card" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "printing_card_id_idx" ON "printing" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "printing_master_set_idx" ON "printing" USING btree ("card_id") WHERE include_in_master_set = true;