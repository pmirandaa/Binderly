-- T-GR-COMMUNITY-FLYWHEEL — community_submission table.
--
-- User-owned raw row for the community grading flywheel (PROJECT.md § 12). A
-- pro user submits the real graded outcome of one of their cards (slab grading
-- company + cert number + the company's overall grade / sub-grades) linked to
-- the photos they captured. The Python ingestion job
-- (`apps/api-python/grading/flywheel/`) reads opted-in rows with the
-- service-role key and upserts normalised rows into `grading_training_sample`
-- (`source='community_flywheel'` — already in that table's CHECK constraint,
-- so no change to it here).
--
-- Two-table split mirrors `grading_submission` / `grading_training_sample`
-- (see `0006_grading_tables.sql`): the user-owned table stays user-owned
-- (owner-CRUD RLS, companion `0026_community_submission_rls.sql`), the corpus
-- stays service-role-only. The training pipeline never reads user rows through
-- an end-user session.
--
-- Idempotency: `UNIQUE(user_id, grade_company, cert_number_normalized)` — a
-- user re-submitting the same slab upserts. Cross-user / cross-source dedup
-- happens at the corpus layer via `grading_training_sample(source, source_id)`.
--
-- `images` is jsonb ({front?, back?, corners?: text[], surface?, slab?}) —
-- URL references only; image download / R2 transcode is the separate #FU-39
-- pipeline, exactly as the scrapers left `thumbnail_url`.
CREATE TABLE "community_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"grading_submission_id" uuid,
	"grade_company" text NOT NULL,
	"cert_number" text NOT NULL,
	"cert_number_normalized" text NOT NULL,
	"overall_grade" numeric(3, 1),
	"subgrades" jsonb,
	"black_label" boolean DEFAULT false NOT NULL,
	"raw_grade_label" text,
	"images" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ingested_source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_submission_user_company_cert_unique" UNIQUE("user_id","grade_company","cert_number_normalized"),
	CONSTRAINT "community_submission_grade_company_check" CHECK ("community_submission"."grade_company" IN ('PSA', 'BGS', 'CGC', 'SGC')),
	CONSTRAINT "community_submission_status_check" CHECK ("community_submission"."status" IN ('pending', 'ingested', 'rejected'))
);
--> statement-breakpoint
-- Capture-session link. ON DELETE SET NULL keeps the submission alive if the
-- capture row is deleted. (Cross-schema FK to auth.users is in the RLS file.)
ALTER TABLE "community_submission"
	ADD CONSTRAINT "community_submission_grading_submission_id_grading_submission_id_fk"
	FOREIGN KEY ("grading_submission_id") REFERENCES "public"."grading_submission"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "community_submission_user_id_created_at_idx" ON "community_submission" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "community_submission_status_idx" ON "community_submission" USING btree ("status");
