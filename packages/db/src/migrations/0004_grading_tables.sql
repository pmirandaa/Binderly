CREATE TABLE "grading_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"printing_id" uuid,
	"front_url" text NOT NULL,
	"back_url" text NOT NULL,
	"corner_urls" text[] NOT NULL,
	"surface_url" text NOT NULL,
	"predicted" jsonb NOT NULL,
	"actual" jsonb,
	"status" text DEFAULT 'predicted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_submission_status_check" CHECK ("grading_submission"."status" IN ('predicted', 'submitted_for_grading', 'graded')),
	CONSTRAINT "grading_submission_corner_urls_length_check" CHECK (array_length("grading_submission"."corner_urls", 1) = 4)
);
--> statement-breakpoint
CREATE TABLE "grading_training_sample" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text,
	"printing_id" uuid,
	"grade_company" text NOT NULL,
	"grade" numeric(3, 1),
	"subgrades" jsonb,
	"images" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parse_confidence" numeric(3, 2),
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_training_sample_source_source_id_unique" UNIQUE("source","source_id"),
	CONSTRAINT "grading_training_sample_source_check" CHECK ("grading_training_sample"."source" IN ('psa_cert', 'ebay_sold', 'auction_pwcc', 'auction_goldin', 'community_flywheel')),
	CONSTRAINT "grading_training_sample_grade_company_check" CHECK ("grading_training_sample"."grade_company" IN ('PSA', 'BGS', 'CGC', 'SGC', 'OTHER'))
);
--> statement-breakpoint
ALTER TABLE "grading_submission" ADD CONSTRAINT "grading_submission_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_training_sample" ADD CONSTRAINT "grading_training_sample_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grading_submission_user_id_created_at_idx" ON "grading_submission" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "grading_submission_printing_id_idx" ON "grading_submission" USING btree ("printing_id");--> statement-breakpoint
CREATE INDEX "grading_training_sample_printing_id_idx" ON "grading_training_sample" USING btree ("printing_id");--> statement-breakpoint
CREATE INDEX "grading_training_sample_grade_company_grade_idx" ON "grading_training_sample" USING btree ("grade_company","grade");