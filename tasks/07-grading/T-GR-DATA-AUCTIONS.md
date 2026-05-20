# T-GR-DATA-AUCTIONS — PWCC + Goldin auction archive scrapers

**Stage:** 07-grading
**Agent role:** data
**Effort:** M (~half day)
**Status:** in_progress

## Hard dependencies
- T-DL-SCHEMA-GRADING (merged — `grading_training_sample` table + CHECK constraint for `auction_pwcc` / `auction_goldin` sources already in place)

## Soft dependencies
- T-GR-DATA-PSA (parallel-safe sibling — disjoint owns_paths)
- T-GR-DATA-EBAY (parallel-safe sibling — disjoint owns_paths)
- T-GR-CAPTURE-UX (parallel-safe sibling — disjoint owns_paths)

## Required reading
- PROJECT.md § 12 (Grading Pipeline)
- rules/07-grading.md
- packages/db/src/schema/grading.ts — `grading_training_sample` shape + source CHECK
- apps/api-python/grading/centering/ — reference subtree for Python conventions
- apps/api-python/pyproject.toml — existing deps + test config patterns

## Goal

Ship two auction-archive scrapers — PWCC Marketplace and Goldin Auctions —
that capture realised outcomes for graded Pokémon slabs from publicly
accessible closed-lot archives. Each observation records the hammer price,
buyer's premium, currency, lot title, lot images, and grading information
parsed from the title (company + overall grade + optional BGS sub-grades).
The data feeds downstream T-GR-CORNERS / EDGES / SURFACE model training
(via `grading_training_sample` in the write-path) and also provides a
high-end-graded pricing signal for future pricing intelligence.

Scrapers are **mock-by-default**: all tests run against checked-in HTML
fixtures; live network access is gated behind `AUCTIONS_LIVE=1`. A shared
rate-limited `httpx` client (≥ 2 s between requests, Binderly UA) is the
seam between mock and live mode.

## Deliverables

### New table — `auction_lot_observation`
- `packages/db/src/schema/auction_lot_observation.ts` — Drizzle table definition
- `packages/db/src/schema/index.ts` — add T-GR-DATA-AUCTIONS export section
- `packages/db/src/migrations/0021_auction_lot_observation.sql` — CREATE TABLE SQL
- `packages/db/src/migrations/meta/_journal.json` — add idx 21 entry
- `packages/db/src/migrations/meta/0021_snapshot.json` — drizzle-kit snapshot

### Python implementation
- `apps/api-python/grading/scrapers/__init__.py`
- `apps/api-python/grading/scrapers/auctions/__init__.py`
- `apps/api-python/grading/scrapers/auctions/job.py` — end-to-end job runner
- `apps/api-python/grading/scrapers/auctions/_shared/__init__.py`
- `apps/api-python/grading/scrapers/auctions/_shared/types.py` — `AuctionLotObservation` dataclass
- `apps/api-python/grading/scrapers/auctions/_shared/grade_parser.py` — title → grading company + grade regex
- `apps/api-python/grading/scrapers/auctions/_shared/currency.py` — price string → cents + currency code
- `apps/api-python/grading/scrapers/auctions/_shared/http_client.py` — rate-limited httpx client (mock gate)
- `apps/api-python/grading/scrapers/auctions/pwcc/__init__.py`
- `apps/api-python/grading/scrapers/auctions/pwcc/parser.py` — HTML → `AuctionLotObservation`
- `apps/api-python/grading/scrapers/auctions/pwcc/fetcher.py` — paginated archive fetch
- `apps/api-python/grading/scrapers/auctions/pwcc/fixtures/psa_lot.html` — PSA 10 lot fixture
- `apps/api-python/grading/scrapers/auctions/pwcc/fixtures/bgs_lot.html` — BGS 9.5 lot fixture
- `apps/api-python/grading/scrapers/auctions/pwcc/fixtures/cgc_lot.html` — CGC 9 lot fixture
- `apps/api-python/grading/scrapers/auctions/pwcc/fixtures/raw_card.html` — raw (ungraded) lot fixture
- `apps/api-python/grading/scrapers/auctions/pwcc/fixtures/multi_lot.html` — multi-card lot fixture
- `apps/api-python/grading/scrapers/auctions/pwcc/tests/__init__.py`
- `apps/api-python/grading/scrapers/auctions/pwcc/tests/test_parser.py`
- `apps/api-python/grading/scrapers/auctions/pwcc/tests/test_fetcher.py`
- `apps/api-python/grading/scrapers/auctions/goldin/__init__.py`
- `apps/api-python/grading/scrapers/auctions/goldin/parser.py` — HTML → `AuctionLotObservation`
- `apps/api-python/grading/scrapers/auctions/goldin/fetcher.py` — paginated archive fetch
- `apps/api-python/grading/scrapers/auctions/goldin/fixtures/psa_lot.html` — PSA 10 lot fixture
- `apps/api-python/grading/scrapers/auctions/goldin/fixtures/bgs_lot.html` — BGS 9.5 Black Label fixture
- `apps/api-python/grading/scrapers/auctions/goldin/fixtures/cgc_lot.html` — CGC 10 lot fixture
- `apps/api-python/grading/scrapers/auctions/goldin/fixtures/raw_card.html` — raw lot fixture
- `apps/api-python/grading/scrapers/auctions/goldin/fixtures/multi_lot.html` — multi-card lot fixture
- `apps/api-python/grading/scrapers/auctions/tests/__init__.py`
- `apps/api-python/grading/scrapers/auctions/tests/test_shared.py` — _shared/ unit tests

### Updated config
- `apps/api-python/pyproject.toml` — add `httpx`, `beautifulsoup4`, `lxml` to base deps; extend test paths

## Data shape

`auction_lot_observation` table columns (unique key: `(auction_house, lot_id)`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | gen_random_uuid() |
| `lot_id` | text NN | auction-house-scoped identifier |
| `auction_house` | text NN | `pwcc` \| `goldin`; CHECK constraint |
| `auction_id` | text | parent session ID (PWCC: auction number; Goldin: auction slug) |
| `auction_name` | text | human-readable auction title |
| `lot_title` | text NN | raw title from lot page |
| `parsed_grading_company` | text | `PSA` \| `BGS` \| `CGC` \| `SGC` \| `unknown` |
| `parsed_overall_grade` | numeric(3,1) | nullable; e.g. `10.0`, `9.5`, `8.0` |
| `parsed_sub_grades` | jsonb | nullable; BGS sub-grades etc. |
| `realised_price_cents` | bigint | hammer price in smallest currency unit |
| `currency_code` | text | ISO 4217 e.g. `USD`, `GBP` |
| `realised_premium_cents` | bigint | buyer's premium when shown; nullable |
| `closed_at` | timestamptz | auction close timestamp; nullable |
| `printing_id` | uuid FK→printing | nullable; filled by fuzzy-match pass |
| `lot_image_urls` | text[] | ordered list of image URLs from lot page |
| `raw_html_sha256` | text | SHA-256 of the lot page HTML |
| `parser_version` | text NN | semver string e.g. `1.0.0` |
| `fetched_at` | timestamptz NN | when the page was fetched |
| `created_at` | timestamptz NN | row creation time |
| `updated_at` | timestamptz NN | last upsert time |

### Write-path
Both adapters produce `AuctionLotObservation` dataclass instances. The job
runner flushes them via two paths:

1. **`auction_lot_observation` table** — full pricing + provenance record
   (upsert on `(auction_house, lot_id)`).
2. **`grading_training_sample` table** — per existing schema CHECK; source
   = `auction_pwcc` or `auction_goldin`; images go into `images` jsonb;
   grade company/grade/subgrades filled from parsed fields.

In mock mode (default), the write-path is stubbed and observations are
returned as plain Python objects for assertion in tests.

## Scraping strategy

### PWCC Marketplace
- **Archive URL:** `https://www.pwccmarketplace.com/auctions` — closed
  auctions listed by most-recent-first.
- **Auction lots URL:** `https://www.pwccmarketplace.com/auctions/<auction-slug>/lots?page=<N>`
  — paginated at ~96 lots/page; stop when page returns 0 lots.
- **Lot detail URL:** `https://www.pwccmarketplace.com/items/<lot-id>` —
  individual lot with realised price, images, title, close date.
- **Pagination dedup:** The fetcher stores `(auction_house, lot_id, raw_html_sha256)`.
  On re-run, if SHA-256 matches the stored record, the upsert is a no-op;
  if it changes (PWCC occasionally updates titles post-close), the row is
  updated and `updated_at` bumped.
- **robots.txt posture:** Not yet verified live (sandbox network may block).
  Known stance: PWCC allows crawling of closed-lot pages in `/auctions/`
  and `/items/` paths for archival research; live bidding pages
  (`/auctions/live-*`) are excluded. Scrape policy in `fetcher.py`
  docstring: archive paths only, never live auction endpoints, configurable
  per-request delay (default 3 s).

### Goldin Auctions
- **Archive URL:** `https://goldinauctions.com/past-auctions/` — list of
  past auctions.
- **Auction lots URL:** `https://goldinauctions.com/lot-list/?auctionid=<id>&page=<N>` —
  paginated; stop when next-page link absent.
- **Lot detail URL:** `https://goldinauctions.com/lot/<year>/<auction-slug>/<lot-id>/` —
  realised price, images, title, close date.
- **Pagination dedup:** Same `raw_html_sha256` upsert strategy as PWCC.
- **robots.txt posture:** Not yet verified live. Goldin's public archive
  pages are generally accessible; live lot bidding is behind authentication
  and excluded from this scraper. Scrape policy: archive paths only,
  default 3 s delay.

## Acceptance criteria
- [ ] `AuctionLotObservation` dataclass validates all required fields; raises on invalid `auction_house` value.
- [ ] `grade_parser.parse_lot_title()` correctly extracts `(company, grade, sub_grades)` for PSA, BGS, CGC, SGC titles; returns `("unknown", None, None)` for raw/ungraded titles.
- [ ] `currency.parse_price()` converts `"$1,234.56"` → `(123456, "USD")`, `"£500"` → `(50000, "GBP")`, `"$2,500.00"` → `(250000, "USD")`.
- [ ] PWCC parser extracts `lot_id`, `lot_title`, `realised_price_cents`, `currency_code`, `lot_image_urls`, `closed_at` from the PSA-10 fixture; `raw_html_sha256` is a 64-char hex string.
- [ ] PWCC parser returns `None` for the raw-card fixture (ungraded lots excluded).
- [ ] PWCC parser extracts BGS 9.5 grade from BGS fixture lot title.
- [ ] Goldin parser extracts equivalent fields from its PSA-10 fixture.
- [ ] Goldin parser returns `None` for raw-card fixture.
- [ ] `PwccFetcher.fetch_mock()` returns a list of `AuctionLotObservation` from all PWCC fixtures.
- [ ] `GoldinFetcher.fetch_mock()` returns a list of `AuctionLotObservation` from all Goldin fixtures.
- [ ] Job runner `run_job(mock=True)` returns a `JobResult` with both PWCC and Goldin observations.
- [ ] `pytest -q apps/api-python/grading/scrapers/` passes with no failures.
- [ ] `pnpm build` passes.
- [ ] `pnpm lint typecheck` passes.
- [ ] Migration `0021_auction_lot_observation.sql` creates `auction_lot_observation` table with correct columns, CHECK constraints, indexes, and `UNIQUE(auction_house, lot_id)`.

## Out of scope
- Live DB writes (mock-by-default architecture; live mode is a thin env-flag swap).
- Playwright/Selenium — if either site requires JS rendering, it's a follow-up; HTML-only path ships with the live-fetch hook as the swap seam.
- The fuzzy-match pass that fills `printing_id` (separate follow-up task).
- robots.txt live verification (sandbox blocks live network; document as follow-up).

## Branch & PR
- Branch: `agent/T-GR-DATA-AUCTIONS`
- PR title: `feat(grading): T-GR-DATA-AUCTIONS — PWCC + Goldin auction archive scrapers`
- Commit format: Conventional Commits

## Escalation triggers
Stop and surface to orchestrator if:
- A required dependency turns out wrong or missing.
- A change is needed outside `owns_paths` that isn't the justified schema deviation noted above.
- An acceptance criterion conflicts with PROJECT.md.

## Notes from execution

### Deviation: DB migration + schema file outside owns_paths
`packages/db/src/schema/auction_lot_observation.ts`,
`packages/db/src/migrations/0021_auction_lot_observation.sql`, and the
associated `_journal.json` / snapshot updates are outside the literal
`owns_paths` of this task (`apps/api-python/grading/scrapers/auctions/`).
This deviation is justified because:
1. The task description explicitly calls for the `auction_lot_observation`
   table and migration.
2. No other parallel-safe task (T-GR-DATA-PSA, T-GR-DATA-EBAY) is
   listed as touching this path.
3. The table is exclusively consumed by the auction scraper code in this
   task's owns_paths.
4. The `grading.ts` CHECK constraint already anticipated
   `auction_pwcc` / `auction_goldin` sources.

### Follow-ups raised
- #FU-37: Live robots.txt verification for PWCC + Goldin (sandbox blocks
  live network; run `curl https://www.pwccmarketplace.com/robots.txt` and
  `curl https://goldinauctions.com/robots.txt` in a live environment and
  compare against the Disallow rules documented in the fetcher docstrings).
- #FU-38: JS-rendering path for PWCC/Goldin if future site updates gate
  closed-lot pages behind JavaScript (currently HTML-accessible). Swap
  seam is `fetcher.py::_fetch_page` — replace the httpx call with a
  playwright-screenshot approach when needed.
- #FU-39: `printing_id` fuzzy-match pass — after the auction lot
  observations are collected, run a background job that joins lot titles
  against the card/printing catalog using ANN + trigram similarity to
  fill `printing_id` nullable FK.
