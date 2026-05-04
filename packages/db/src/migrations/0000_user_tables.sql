-- T-DL-SCHEMA-USERS — user-side tables (profile, subscription).
--
-- `profile.handle` is `citext` so uniqueness is case-insensitive. Supabase
-- bundles the `citext` extension; this CREATE EXTENSION is idempotent and
-- a no-op when the extension already exists. Cross-schema foreign keys to
-- `auth.users(id)` and the RLS policies for these tables ship in the
-- companion migration `0001_users_rls.sql`.

CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TABLE "profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handle" "citext" NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"bio" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"source" text,
	"external_customer_id" text,
	"expires_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"raw" jsonb,
	CONSTRAINT "subscription_tier_check" CHECK ("subscription"."tier" IN ('free', 'pro'))
);
