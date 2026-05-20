-- T-GR-DATA-EBAY — `ebay_graded_listing_observation`
--
-- New table for eBay completed-listing observations for graded Pokémon
-- card slabs (PSA, BGS, CGC, SGC). Populated by the Python scraper at
-- `apps/api-python/grading/scrapers/ebay/`.
--
-- Two downstream consumers:
--   1. Graded-card pricing intelligence — final sale prices feed the
--      "PSA 10 sold for $X" callout on the card detail page.
--   2. Training corpus — a downstream job copies rows (with images) into
--      `grading_training_sample` (source = 'ebay_sold').
--
-- Deduplication: `UNIQUE(listing_id)` ensures idempotent re-runs.
-- Re-parsing when regex evolves: bump `parser_version` and update rows
-- in-place — `raw_blob_json` preserves the original eBay payload so
-- re-parsing never requires a re-fetch.
--
-- `printing_id` is nullable — the scraper leaves it NULL; a separate
-- fuzzy-match pass (follow-up #FU-38) backfills it from the printing
-- catalog using set + collector-number heuristics.
--
-- No RLS needed: this table is service-role-only (training / analytics
-- pipeline). The `anon` / `authenticated` roles are explicitly excluded.

CREATE TABLE IF NOT EXISTS public.ebay_graded_listing_observation (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  -- Grading company parsed from the listing title.
  -- CHECK constraint mirrors `grading_training_sample.grade_company`.
  parsed_grading_company  TEXT,
  -- Overall grade (1.0–10.0). NULL when parse failed or listing is
  -- an Authentic slab (non-numeric grade).
  parsed_overall_grade    NUMERIC(3, 1),
  -- BGS / Beckett Black Label sub-grades: {centering, corners, edges,
  -- surface} floats. NULL for PSA / CGC / SGC / OTHER.
  parsed_sub_grades       JSONB,
  -- Final sale price in the smallest currency unit (cents for USD/GBP/EUR,
  -- yen for JPY where 1 yen = 1 unit).
  final_price_cents       INTEGER     NOT NULL,
  -- ISO 4217 currency code returned by eBay (USD, GBP, EUR, JPY, …).
  currency_code           TEXT        NOT NULL,
  -- eBay listing end time (when the sale closed). May be NULL if absent
  -- from the Finding API response for older listings.
  sold_at                 TIMESTAMPTZ,
  -- FK to `printing` catalog. Nullable — backfilled by follow-up #FU-38.
  printing_id             UUID        REFERENCES public.printing(id) ON DELETE SET NULL,
  -- eBay hosted thumbnail URL. NOT proxied or downloaded by this task
  -- (follow-up #FU-37 handles image ingestion into Supabase Storage).
  thumbnail_url           TEXT,
  -- Full eBay Finding API item dict (JSON). Preserved for re-parsing when
  -- the title regex evolves without re-fetching.
  raw_blob_json           JSONB       NOT NULL,
  -- Parser version string. Increment in `parser.py::PARSER_VERSION` when
  -- the regex logic changes so stale rows can be identified and re-parsed.
  parser_version          TEXT        NOT NULL,
  -- Wall-clock timestamp when this row was written.
  fetched_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup key: eBay item IDs are globally unique within a marketplace.
ALTER TABLE public.ebay_graded_listing_observation
  ADD CONSTRAINT ebay_graded_listing_observation_listing_id_unique UNIQUE (listing_id);

-- CHECK: parsed_grading_company must be one of the four known grading
-- companies or OTHER/NULL (NULL = pre-parse; scraped but not yet classified).
ALTER TABLE public.ebay_graded_listing_observation
  ADD CONSTRAINT ebay_graded_listing_observation_company_check
  CHECK (
    parsed_grading_company IS NULL OR
    parsed_grading_company IN ('PSA', 'BGS', 'CGC', 'SGC', 'OTHER')
  );

-- Hot path: "give me all PSA 10 sold prices for a given printing".
CREATE INDEX ebay_graded_listing_observation_printing_company_grade_idx
  ON public.ebay_graded_listing_observation (
    printing_id,
    parsed_grading_company,
    parsed_overall_grade
  )
  WHERE printing_id IS NOT NULL;

-- Hot path: recent pricing queries (last 90 days of sold data).
CREATE INDEX ebay_graded_listing_observation_sold_at_idx
  ON public.ebay_graded_listing_observation (sold_at DESC NULLS LAST);

-- Hot path: re-parse sweep — find all rows for an old parser version.
CREATE INDEX ebay_graded_listing_observation_parser_version_idx
  ON public.ebay_graded_listing_observation (parser_version);

-- Service-role-only: revoke public + per-role grants mirroring the
-- same pattern used by the grading_training_sample RLS posture.
REVOKE ALL ON public.ebay_graded_listing_observation FROM anon, authenticated;
