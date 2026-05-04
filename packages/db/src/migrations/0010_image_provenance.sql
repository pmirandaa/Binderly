-- T-DL-IMAGE-PIPELINE — printing_image provenance sidecar.
--
-- Records every (printing, upstream-source) image observation the
-- pipeline ingests: source URL, raw-byte sha256, byte size, the
-- WebP variant ladder we transcoded, the license tag we persisted
-- under, and a transcoded_at audit timestamp.
--
-- Why a sidecar:
--   - A single printing can have images from multiple primary /
--     validation sources (TCGdex + PTCGIO). Storing them on
--     `printing` would either pick a winner at write time (losing
--     audit) or widen the row by N×4 columns. The sidecar keeps
--     every observation; the chosen canonical R2 URLs continue to
--     live on `printing.image_small_url` / `image_large_url`,
--     which is the hot read path for browse / set / card detail.
--
-- Idempotency: the dedup contract is the
-- `(source, original_sha256)` UNIQUE constraint. Re-running the
-- image pipeline against the same upstream bytes upserts onto this
-- key — see `data-pipeline/src/images/processor.ts`.
--
-- License posture: the CHECK constraint enumerates the three
-- permitted tags (`TCGDEX`, `PTCGIO`, `POKEMON_CARD_JP`).
-- Bulbapedia is intentionally absent: per
-- `context/legal-and-brand.md` we do not persist Bulbapedia images
-- (CC-BY-NC-SA), and the constraint is defence in depth on top of
-- the adapter-level skip.

CREATE TABLE "printing_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printing_id" uuid,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"source_content_type" text,
	"original_sha256" text NOT NULL,
	"original_byte_size" integer NOT NULL,
	"variants" jsonb NOT NULL,
	"license" text NOT NULL,
	"transcoded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printing_image_source_original_sha256_unique" UNIQUE("source","original_sha256"),
	CONSTRAINT "printing_image_license_check" CHECK ("printing_image"."license" IN ('TCGDEX', 'PTCGIO', 'POKEMON_CARD_JP'))
);
--> statement-breakpoint
ALTER TABLE "printing_image" ADD CONSTRAINT "printing_image_printing_id_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printing"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "printing_image_printing_id_idx" ON "printing_image" USING btree ("printing_id");
--> statement-breakpoint
CREATE INDEX "printing_image_original_sha256_idx" ON "printing_image" USING btree ("original_sha256");
