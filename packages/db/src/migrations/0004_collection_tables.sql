-- T-DL-SCHEMA-COLLECTIONS — collection-related tables.
--
-- Five tables for the user-facing collection surfaces:
--   * collection_item        — physical instances a user owns
--   * custom_collection      — user-defined groupings (manual / smart)
--   * custom_collection_item — manual-collection membership rows
--   * smart_collection_rule  — DSL AST for smart collections (1:1 with parent)
--   * shareable              — public-link configurations
--
-- Cross-schema FKs to `auth.users(id)` ON DELETE CASCADE for every
-- `user_id` column and Row Level Security policies live in the
-- companion migration `0005_collections_rls.sql`. The unique
-- constraint on `collection_item` is declared with NULLS NOT
-- DISTINCT (Postgres 15+) so two raw cards (no grade) collapse via
-- UPSERT instead of accruing duplicate rows — see the schema file
-- comment in `packages/db/src/schema/collections.ts`.

CREATE TABLE "collection_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"printing_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" text DEFAULT 'NEAR_MINT' NOT NULL,
	"grade_company" text,
	"grade" numeric(3, 1),
	"acquired_at" date,
	"acquired_price" numeric(10, 2),
	"acquired_currency" text,
	"notes" text,
	"photo_urls" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_item_owner_state_unique" UNIQUE NULLS NOT DISTINCT("user_id","printing_id","condition","grade_company","grade"),
	CONSTRAINT "collection_item_quantity_check" CHECK ("collection_item"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "custom_collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"cover_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_collection_user_id_slug_unique" UNIQUE("user_id","slug"),
	CONSTRAINT "custom_collection_kind_check" CHECK ("custom_collection"."kind" IN ('manual', 'smart'))
);
--> statement-breakpoint
CREATE TABLE "custom_collection_item" (
	"custom_collection_id" uuid NOT NULL,
	"printing_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_collection_item_pkey" PRIMARY KEY("custom_collection_id","printing_id")
);
--> statement-breakpoint
CREATE TABLE "smart_collection_rule" (
	"custom_collection_id" uuid PRIMARY KEY NOT NULL,
	"expression" jsonb NOT NULL,
	"last_evaluated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shareable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"target" jsonb NOT NULL,
	"theme" text DEFAULT 'default' NOT NULL,
	"show_values" boolean DEFAULT false NOT NULL,
	"show_missing" boolean DEFAULT true NOT NULL,
	"show_photos" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shareable_user_id_slug_unique" UNIQUE("user_id","slug"),
	CONSTRAINT "shareable_target_kind_check" CHECK ("shareable"."target" ? 'kind' AND "shareable"."target"->>'kind' IN ('full', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "collection_item" ADD CONSTRAINT "collection_item_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_collection_item" ADD CONSTRAINT "custom_collection_item_custom_collection_id_custom_collection_id_fk" FOREIGN KEY ("custom_collection_id") REFERENCES "public"."custom_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_collection_item" ADD CONSTRAINT "custom_collection_item_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_collection_rule" ADD CONSTRAINT "smart_collection_rule_custom_collection_id_custom_collection_id_fk" FOREIGN KEY ("custom_collection_id") REFERENCES "public"."custom_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_item_user_id_printing_id_idx" ON "collection_item" USING btree ("user_id","printing_id");--> statement-breakpoint
CREATE INDEX "collection_item_user_id_created_at_idx" ON "collection_item" USING btree ("user_id","created_at" DESC NULLS LAST);