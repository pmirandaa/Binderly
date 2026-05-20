# T-GR-DATA-EBAY — eBay sold listings scraper for graded slabs

**Stage:** 07-grading
**Agent role:** data
**Effort:** L
**Status:** in_progress

---

## Goal

Build a Python scraper at `apps/api-python/grading/scrapers/ebay/` that
fetches **completed (sold) eBay listings** for graded Pokémon card slabs —
PSA, BGS, CGC, and SGC — and stores structured observations in a new
`ebay_graded_listing_observation` table and in the existing
`grading_training_sample` table (via an upsert writer).

This data feeds two downstream consumers:
1. **Training corpus** for T-GR-CORNERS / T-GR-EDGES / T-GR-SURFACE — image
   URLs + grade labels needed to train the per-grade classifiers.
2. **Graded-card pricing intelligence** — sold prices for PSA/BGS/CGC slabs
   let the app surface "PSA 10 copies sold for $X on average" on the card
   detail page.

---

## Reading list (resolved at elaboration time)

- `PROJECT.md` § 12 (Grading Pipeline)
- `rules/07-grading.md`
- `packages/db/src/schema/grading.ts` — existing `grading_training_sample`
  table (this scraper writes to it with `source = 'ebay_sold'`)
- `data-pipeline/src/adapters/pricing-ebay-browse/` — TypeScript eBay client
  for reference conventions (OAuth, RateLimitedClient, types)
- `apps/api-python/grading/centering/` — Python style + test patterns

---

## API contract

### Primary: eBay Finding API `findCompletedItems`

Endpoint: `https://svcs.ebay.com/services/search/FindingService/v1`

Auth: App ID passed as `SECURITY-APPNAME` query parameter. No OAuth required
for the Finding API (unlike the Browse API). In test mode the `app_id` is a
static fixture string `"TEST-APP-ID"`. Live mode reads `EBAY_APP_ID` from env.

Key parameters:
```
OPERATION-NAME=findCompletedItems
SERVICE-VERSION=1.13.0
SECURITY-APPNAME={app_id}
RESPONSE-DATA-FORMAT=JSON
keywords={query}          -- e.g. "PSA 10 Pokemon Charizard"
categoryId=183454         -- Pokémon Individual Cards (Trading Card Games)
itemFilter(0).name=SoldItemsOnly
itemFilter(0).value=true
paginationInput.entriesPerPage=100
paginationInput.pageNumber={page}
```

### Query strategy

The scraper loops over a matrix of:
- **Grade companies**: PSA, BGS, CGC, SGC
- **Grade tiers**: 10, 9.5, 9 (high-grade slabs; lower grades added as data
  needs grow)
- **Subject keywords**: empty (company + tier alone is sufficient to find
  graded Pokémon cards in category 183454)

This yields queries like:
- `"PSA 10"`
- `"PSA 9"`
- `"BGS 9.5"`
- `"BGS 9"`
- `"CGC 10"`
- `"SGC 9"`

All queries target category 183454 with `SoldItemsOnly=true`. The scraper
paginates up to `MAX_PAGES` (default 10, meaning up to 1 000 sold items per
query).

**Time-window posture**: The Finding API returns up to 90 days of completed
listings by default. Re-runs are idempotent via `UNIQUE(listing_id)` on the
observation table — duplicate rows are silently skipped (`ON CONFLICT DO
NOTHING`).

### Category constant

```python
EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID = "183454"
```

### Response fields consumed

From each `item` in `findCompletedItemsResponse[0].searchResult[0].item[]`:
- `itemId[0]` → `listing_id`
- `title[0]` → `title`
- `galleryURL[0]` → `thumbnail_url`
- `sellingStatus[0].currentPrice[0].__value__` → price
- `sellingStatus[0].currentPrice[0].@currencyId` → `currency_code`
- `listingInfo[0].endTime[0]` → `sold_at`
- Full item dict → `raw_blob_json`

---

## Data shape

### Table: `ebay_graded_listing_observation`

New Drizzle table (migration `0021_ebay_graded_listing_observation.sql`):

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `listing_id` | TEXT UNIQUE NOT NULL | eBay item ID |
| `title` | TEXT NOT NULL | raw eBay title |
| `parsed_grading_company` | TEXT | PSA / BGS / CGC / SGC / OTHER — CHECK constrained |
| `parsed_overall_grade` | NUMERIC(3,1) | 1.0–10.0 or NULL if parse failed |
| `parsed_sub_grades` | JSONB | BGS sub-grades if regex matched |
| `final_price_cents` | INTEGER NOT NULL | price × 100, integer |
| `currency_code` | TEXT NOT NULL | ISO 4217 (USD, GBP, EUR, JPY) |
| `sold_at` | TIMESTAMPTZ | listing end time |
| `printing_id` | UUID → printing(id) | nullable FK; matched in a later pass |
| `thumbnail_url` | TEXT | eBay hosted listing image — not proxied |
| `raw_blob_json` | JSONB NOT NULL | full eBay item dict for re-parsing |
| `parser_version` | TEXT NOT NULL | semver string e.g. `"1"` |
| `fetched_at` | TIMESTAMPTZ NOT NULL | `now()` at ingest time |

### Secondary write: `grading_training_sample`

For each `ebay_graded_listing_observation` row the scraper also upserts into
`grading_training_sample` with:
- `source = 'ebay_sold'`
- `source_id = listing_id`
- `source_url = 'https://www.ebay.com/itm/{listing_id}'`
- `grade_company = parsed_grading_company` (or `'OTHER'`)
- `grade = parsed_overall_grade`
- `subgrades = parsed_sub_grades`
- `images = {"thumbnail": thumbnail_url}` (jsonb)
- `parse_confidence = parse_confidence` (0.0–1.0)
- `raw_metadata` = `{"title": title, "final_price_cents": ..., "currency_code": ..., "sold_at": ..., "parser_version": ...}`

Dedup: `UNIQUE(source, source_id)` already on `grading_training_sample`.

---

## Parsing strategy

### Grade company detection

Checked in priority order (first match wins):
1. `\bPSA\b` → PSA
2. `\bBGS\b` or `\bBeckett\b` → BGS
3. `\bCGC\b` → CGC
4. `\bSGC\b` → SGC
5. No match → OTHER

Confidence 1.0 if matched by company keyword; 0.5 if OTHER.

### Overall grade extraction

After company match, scan for one of:
`10 | 9\.5 | 9 | 8\.5 | 8 | 7\.5 | 7 | 6\.5 | 6 | 5\.5 | 5 | 4\.5 | 4 | 3\.5 | 3 | 2\.5 | 2 | 1\.5 | 1 | AUTH(?:ENTIC)?`

The first token immediately following the company name that matches this
pattern is taken as the overall grade. `AUTH` → stored as `NULL` grade with
`grade_str = "Auth"` in `raw_blob_json`. Confidence degrades by 0.1 when the
grade is not immediately adjacent to the company abbreviation (e.g. "PSA Pop
Report 10").

### BGS sub-grade extraction

If company is BGS, also scan for the pattern:
`(\d+\.?\d*)/(\d+\.?\d*)/(\d+\.?\d*)/(\d+\.?\d*)` (four slash-separated
sub-scores). When found, parse into
`{"centering": float, "corners": float, "edges": float, "surface": float}`.

### Parser version

`PARSER_VERSION = "1"` (increment when regex logic changes so stale DB rows
can be re-parsed without re-fetching).

---

## Mock / live mode

`EBAY_GRADING_LIVE=1` enables live HTTP calls. Default (unset) uses fixture
JSON files from `grading/scrapers/ebay/fixtures/`. The mock client returns
fixtures round-robin so pagination can be tested without real API traffic.

Token mock: when not live, `app_id = "TEST-APP-ID"` is set automatically.

---

## File layout

```
apps/api-python/grading/scrapers/
├── __init__.py
└── ebay/
    ├── __init__.py
    ├── types.py          # Pydantic models: EbayGradedListingObservation
    ├── parser.py         # title regex: company + grade extraction
    ├── oauth.py          # Finding API needs only App ID; thin env wrapper
    ├── client.py         # httpx Finding API client (mock-by-default)
    ├── scraper.py        # main: build queries → fetch → parse → yield obs
    ├── writer.py         # stdout JSONL or Supabase PostgREST upsert
    ├── fixtures/
    │   ├── __init__.py
    │   ├── psa_10_charizard.json        # PSA 10 — USD — base fixture
    │   ├── bgs_9_5_venusaur.json        # BGS 9.5 — USD — sub-grades
    │   ├── cgc_8_blastoise.json         # CGC 8 — USD
    │   ├── sgc_9_pikachu.json           # SGC 9 — USD
    │   ├── unknown_grader.json          # No company → OTHER
    │   ├── misgraded_title.json         # "PSA" in title but no grade token
    │   └── gbp_currency.json            # BGS 9.5 — GBP currency
    └── tests/
        ├── __init__.py
        ├── test_parser.py    # unit: parse_title edge cases
        ├── test_client.py    # mock HTTP responses
        └── test_scraper.py   # end-to-end with fixture files
```

---

## Acceptance criteria

1. `pytest -q apps/api-python/grading/scrapers/ebay/tests/` passes with ≥ 20
   assertions.
2. `test_parser.py` covers: PSA 10, PSA Auth, BGS 9.5, BGS 9.5 sub-grades,
   CGC 8, SGC 9, OTHER (no company), grade-not-adjacent confidence penalty.
3. `test_client.py` covers: fixture-mode round-trip, `EBAY_GRADING_LIVE`
   guard (not set → no real HTTP call), pagination (page 2 returns next
   fixture).
4. `test_scraper.py` covers: multi-query run, dedup (same listing_id in two
   pages → emitted once), currency-conversion case (GBP fixture), missing
   grade → `parsed_overall_grade = None`.
5. Each fixture file is valid JSON matching the Finding API schema and covers
   a distinct test vector (PSA/BGS/CGC/SGC/OTHER/misgraded/GBP).
6. `pnpm build` passes (no TypeScript-land changes except the new migration
   and schema addition).
7. `pnpm lint typecheck` passes across all touched files.

---

## Constraints

- **No browser-driver deps.** Pure `httpx` + `pydantic`.
- **httpx** already in `pyproject.toml` (add to `[project.dependencies]` if
  not already there).
- **No live calls in tests.** `EBAY_GRADING_LIVE` must be unset for CI.
- **Conventional Commits.** PR title: `feat(grading): T-GR-DATA-EBAY — eBay
  sold-listings scraper for graded slabs`.

---

## Follow-ups (registered at implementation time)

- **#FU-37** — Add image download + storage step: fetch `thumbnail_url` into
  Supabase Storage and fill `grading_training_sample.images.front` so the
  corner/edge/surface trainers can consume it. (Out of scope for this task —
  T-GR-DATA-EBAY explicitly defers image proxying.)
- **#FU-38** — Add printing-id fuzzy-match pass: run title parsing against
  the `printing` catalog (set + number heuristics) to backfill nullable
  `printing_id` on existing `ebay_graded_listing_observation` rows.

---

## Branch & PR

- Branch: `agent/T-GR-DATA-EBAY`
- PR title: `feat(grading): T-GR-DATA-EBAY — eBay sold-listings scraper for graded slabs`

## Notes from execution

_(filled in by sub-agent)_
