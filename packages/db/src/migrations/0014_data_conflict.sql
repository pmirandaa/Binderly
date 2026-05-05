-- T-DL-DATA-CONFLICT-TABLE — data_conflict table.
--
-- Pipeline-internal admin-debug log of resolver disagreements.
-- Persists every conflict the resolver
-- (`data-pipeline/src/resolver/resolver.ts`) emits today as an
-- in-memory `DataConflict`. Re-running the resolver against the same
-- (entity, key, field) bumps `dispute_count` instead of inserting a
-- duplicate row.
--
-- Why this table:
--   - `rules/01-data-layer.md` mandates "Conflicts are surfaced, not
--     silenced". Today they're surfaced only as a per-source counter
--     in the seed-run report — the conflict itself is lost. This
--     table makes them queryable for ops debugging and the future
--     T-DL-ADMIN-DEBUG-SURFACES read-only views.
--
-- Idempotency:
--   - `(entity_kind, entity_canonical_key, field_name)` UNIQUE is the
--     conflict target. The Drizzle repo
--     (`data-pipeline/src/resolver/conflict-log.ts`) issues
--     `ON CONFLICT (entity_kind, entity_canonical_key, field_name)
--     DO UPDATE SET dispute_count = data_conflict.dispute_count + 1,
--     last_seen_at = excluded.last_seen_at,
--     sources = excluded.sources, kept_value = excluded.kept_value,
--     resolution = excluded.resolution, updated_at = now()`.
--
-- entity_canonical_key is intentionally NOT a foreign key into
-- set / card / printing — the resolver can flag a conflict from a
-- source that emits a row the catalog doesn't yet know about (the
-- `__presence` conflict shape from resolver.ts). Persisting requires
-- no FK constraint.
--
-- RLS posture: companion migration `0015_data_conflict_rls.sql`
-- (per the conventions.md "RLS policy changes ship in their own
-- migration" rule).
CREATE TABLE "data_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_canonical_key" text NOT NULL,
	"field_name" text NOT NULL,
	"sources" jsonb NOT NULL,
	"resolution" text,
	"kept_value" jsonb,
	"dispute_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_conflict_entity_field_unique" UNIQUE("entity_kind","entity_canonical_key","field_name"),
	CONSTRAINT "data_conflict_entity_kind_check" CHECK ("data_conflict"."entity_kind" IN ('set', 'card', 'printing'))
);
--> statement-breakpoint
CREATE INDEX "data_conflict_dispute_count_idx" ON "data_conflict" USING btree ("dispute_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "data_conflict_last_seen_at_idx" ON "data_conflict" USING btree ("last_seen_at" DESC NULLS LAST);
