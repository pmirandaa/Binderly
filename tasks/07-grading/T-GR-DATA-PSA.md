# T-GR-DATA-PSA — PSA cert lookup scraper (rate-limited, ToS-aware)

**Stage:** 07-grading
**Agent role:** data
**Effort:** L
**Status:** in_progress

## Hard dependencies

- T-DL-SCHEMA-GRADING (provides `grading_training_sample` table; `source='psa_cert'` is
  already in the CHECK constraint — no new migration needed)

## Soft dependencies

- T-GR-CENTERING (provides centering measurement — scraper is independent but
  downstream training tasks need both)

## Required reading

- PROJECT.md § 12 (Grading Pipeline — PSA cert lookup is training data source #1)
- rules/07-grading.md (rate-limit rules, ToS guardrails)
- context/legal-and-brand.md (§ "PSA cert pages" — public / grey-zone posture)
- context/data-model.md (§ grading_submission, § grading_training_sample)
- packages/db/src/schema/grading.ts (the actual Drizzle schema we write to)
- apps/api-python/grading/centering/ (reference for Python conventions: types,
  tests, pyproject shape)

## Goal

Implement a rate-limited, ToS-aware scraper that fetches graded-card outcomes
from PSA's public cert-lookup pages (`https://www.psacard.com/cert/{cert_number}`),
parses the HTML into structured `psa_cert_observation` records, and upserts each
record into the existing `grading_training_sample` table (source = `'psa_cert'`).
The records become the labelled training data that T-GR-CORNERS / T-GR-EDGES /
T-GR-SURFACE need to train their subgrade models against.

**Mock-by-default** — the module ships with checked-in synthetic HTML fixtures
representing a representative cross-section of PSA cert page variants. All tests
run against fixtures. Live PSA fetching is gated behind `PSA_LIVE=1`.

## Data shape

Each scraped cert yields one row in `grading_training_sample`:

| Column | Value |
|---|---|
| `source` | `'psa_cert'` (literal; matches CHECK constraint) |
| `source_id` | PSA cert number string (e.g. `'12345678'`) |
| `source_url` | `https://www.psacard.com/cert/{cert_number}` |
| `printing_id` | `NULL` (fuzzy matching to catalog is a separate task) |
| `grade_company` | `'PSA'` |
| `grade` | Numeric 1.0–10.0, or `NULL` for Authentic / Authentic-Altered |
| `subgrades` | `{centering?, corners?, edges?, surface?}` — `null` for old slabs |
| `images` | `{front?: url}` — front-of-slab image URL from cert page if present |
| `parse_confidence` | `1.0` (PSA data is authoritative; confidence is N/A) |
| `raw_metadata` | See below |

`raw_metadata` jsonb stores all provenance and auxiliary fields:

```json
{
  "cert_number": "12345678",
  "cert_url": "https://www.psacard.com/cert/12345678",
  "card_name": "Charizard",
  "set_name": "Base Set",
  "year": "1999",
  "card_number": "4/102",
  "qualifiers": ["OC"],
  "raw_html_sha256": "abc123...",
  "fetched_at": "2026-05-20T18:00:00Z",
  "source_version": "psa_scraper_v1"
}
```

**Non-numeric grades** (`"Authentic"`, `"Authentic Altered"`) land as `grade = NULL`
with `raw_metadata.grade_label` recording the original string.

**Qualifiers** (OC = Off-Center, PD = Print Defect, ST = Stain, MC = Miscut, etc.)
are a string array in `raw_metadata.qualifiers`.

## Scraping strategy

- **Single-cert-page parser.** Scraper fetches one cert page at a time via
  `GET https://www.psacard.com/cert/{cert_number}`. No cert-range crawler
  in v1 — batches are driven by an external cert-number list passed to the job.
- **Re-fetch policy.** An existing row with the same `(source, source_id)` is
  upserted if `raw_html_sha256` differs (content changed) or the row is older
  than a configurable `max_age_days` (default 90). Same hash → skip.
- **Rate limit.** Default ≤ 1 req/s (`PSA_DELAY_SECS=2` default between requests;
  rule from rules/07-grading.md says ≤ 1 req/sec, default 2s adds headroom).
- **User-Agent.** `Binderly-GradingDataPipeline/1.0 (+https://binderly.app; data@binderly.app)`.
- **Backoff.** Exponential backoff on 429 / 5xx, up to 3 retries.
- **ToS block detection.** If response body contains Cloudflare challenge markers
  or `403` with "scraping" in body → raise `TosBlockError`, halt batch, log.
- **JS rendering.** PSA's cert pages serve meaningful data in the initial HTML
  (no JS hydration needed for the grade table). If a future page update requires
  JS, the `fetch_html` hook is the seam to swap in a browser backend.

## Deliverables

- `apps/api-python/grading/scrapers/__init__.py` — empty module init
- `apps/api-python/grading/scrapers/psa/__init__.py` — re-exports public API
- `apps/api-python/grading/scrapers/psa/types.py` — `PsaCertRecord` dataclass + enums
- `apps/api-python/grading/scrapers/psa/parser.py` — HTML → `PsaCertRecord` (BeautifulSoup4)
- `apps/api-python/grading/scrapers/psa/client.py` — rate-limited httpx client
- `apps/api-python/grading/scrapers/psa/job.py` — job runner (cert list → DB upserts)
- `apps/api-python/grading/scrapers/psa/tests/__init__.py`
- `apps/api-python/grading/scrapers/psa/tests/conftest.py` — fixtures
- `apps/api-python/grading/scrapers/psa/tests/fixtures/` — synthetic HTML cert pages
- `apps/api-python/grading/scrapers/psa/tests/test_parser.py`
- `apps/api-python/grading/scrapers/psa/tests/test_client.py`
- `apps/api-python/grading/scrapers/psa/tests/test_job.py`

Updated root files (within `owns_paths` via pyproject.toml + pytest config update):
- `apps/api-python/pyproject.toml` — add `beautifulsoup4`, `lxml`, `httpx` deps; add
  scraper testpath; add `grading.scrapers.psa` to setuptools packages

## Acceptance criteria

- [ ] `pytest -q apps/api-python/grading/scrapers/psa/tests/` — all green, no live network calls
- [ ] Parser correctly extracts `cert_number`, `card_name`, `set_name`, `year`,
      `card_number`, `overall_grade`, `centering_subgrade`, `corners_subgrade`,
      `edges_subgrade`, `surface_subgrade`, `qualifiers` from each fixture file
- [ ] PSA 10 fixture (with full subgrades) parses correctly
- [ ] PSA 9 fixture (with subgrades) parses correctly
- [ ] PSA 8 fixture (no subgrades — older slab) parses with null subgrades
- [ ] PSA 1 (lowest grade) fixture parses correctly
- [ ] Authentic grade fixture parses with `grade = None`, `grade_label = "Authentic"`
- [ ] OC-qualified fixture parses with `qualifiers = ["OC"]`
- [ ] Rate-limit logic: clock mock confirms ≥ 2s delay between consecutive fetches
- [ ] `PSA_LIVE` env flag defaults to `"0"` / falsy; tests never call real network
- [ ] `raw_html_sha256` is a hex SHA-256 of the raw HTML bytes
- [ ] Job runner deduplicates by `(source, source_id)` — same hash → skip; new hash → upsert
- [ ] `TosBlockError` raised on Cloudflare challenge HTML or `403` with scraping body
- [ ] No changes outside `owns_paths` except `apps/api-python/pyproject.toml` (justified:
      required to register the new package and its deps)

## Out of scope

- Fuzzy matching of cert page card names → `printing_id` (separate task)
- Cert-range auto-discovery / crawling (cert list is provided externally)
- BGS / CGC cert page scraping (separate scraper tasks if needed)
- Playwright / browser-driven fetching (seam exists in `client.py`; post-merge follow-up)
- Image downloading / re-hosting to R2 (slab image URL stored in `images.front`,
  not downloaded — download / transcode is a separate pipeline step)
- Live CI network calls (GH Actions quota concern; `PSA_LIVE=1` is post-merge manual run)

## Branch & PR

- Branch: `agent/T-GR-DATA-PSA`
- PR title: `feat(grading): T-GR-DATA-PSA — PSA cert lookup scraper`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:
- PSA cert page HTML structure differs radically from what fixture reverse-engineering
  suggests (escalate with Q-### in open-questions.md).
- A required dependency turns out to be wrong or missing.
- A change is needed outside `owns_paths` beyond pyproject.toml.
- A product decision is required (e.g. cert number range to prioritize).

## Notes from execution

- `grading_training_sample` already has `source='psa_cert'` in its CHECK constraint —
  no new DB migration required (the brief said "check first; if no table, add migration").
  The table handles all needed fields via `subgrades` (jsonb) and `raw_metadata` (jsonb).
- The `pyproject.toml` edit is the only file touched outside `apps/api-python/grading/scrapers/psa/`
  and is justified: new Python package + new deps must be declared there.
- Synthetic fixture HTML was fabricated to match the known PSA cert page structure
  (table-based layout, grade highlighted in bold, subgrades in a secondary table row).
  Real PSA HTML may differ in selector details — the `PSA_LIVE=1` smoke run (post-merge)
  is the intended validation gate.
- Next available follow-up number at time of implementation: **#FU-37**.
- Follow-ups raised: #FU-37 (browser-driven live fetch seam validation),
  #FU-38 (printing_id fuzzy-match pass after catalog stabilizes).
