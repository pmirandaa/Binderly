# Binderly — Product Specification

This is the north-star spec. Every task file is a faithful execution of some
slice of this document. If a task and this document disagree, this document
wins and the task file should be corrected.

---

## 1. Overview

Binderly is a Pokémon TCG collection tracker for serious collectors. The two
flagship features are **fast stack scanning** (point a phone, flip cards, the
app auto-adds them) and **smart custom collections** (rule-based collections
like "every Charizard in Sword & Shield").

The product is mobile + web. Mobile is for capture and on-the-go management.
Web is for browsing, organizing, public shareable collection pages, and SEO.

### Goals

- **Collection-first, not portfolio-first.** Portfolio value exists, but is
  never the primary surface. A user opening the app sees their collection,
  not their net worth.
- **Comprehensive coverage.** English and Japanese as first-class. All sets
  back to Base Set / Japanese Base Set. All variants: holos, reverse holos,
  alt arts, full arts, secret rares, gold cards, promos (movie, prerelease,
  staff, brand, league), background variants (Poké Ball / Master Ball
  patterns), 1st edition, shadowless, stamped variants.
- **Master set tracking that matches how collectors actually think.** See § 9.
- **Fast, free, on-device card recognition.** Sub-1.5s scan-to-add. No
  per-scan cost.
- **BGS-style grading prediction with sub-grades.** Centering, corners, edges,
  surface. Calibrated against PSA outcomes.
- **Shareable public collection pages** with proper social previews.
- **Freemium**, with the free tier genuinely useful and the paid tier
  unlocking power-user features.

### Non-goals

- Marketplace functionality (no buy/sell flow). Price *display* only, when
  pricing is wired up.
- Trading mechanics in v1.
- Any TCG other than Pokémon in v1. The data model permits future expansion;
  scope discipline now means we don't ship a half-baked Magic mode.
- Social feed, comments, follows. Maybe v2; explicitly out of scope here.
- Deck building. This is a collection app, not a deck app.

---

## 2. Brand & Legal

**Name:** Binderly. Trademark-clean against the Pokémon ecosystem (no "Poké"
or "Pokémon" prefix, no Pokédex implication). A USPTO + EUIPO + domain check
is part of the foundation phase before we go public — the orchestrator must
escalate if a conflict surfaces.

**IP posture.** We are an unaffiliated third-party tool. We:

- **Never** use Pokémon Company branding (logos, fonts, mascots) in our own
  marketing, app icon, splash screens, store listings, or marketing site.
- **Do** describe the product factually as "for Pokémon TCG collectors" —
  nominative fair use, the same way a stats app references MLB.
- **Do** include an attribution + disclaimer in the app footer, About page,
  and store listings: *"Binderly is not affiliated with, endorsed by, or
  sponsored by Nintendo, Game Freak, Creatures Inc., or The Pokémon Company
  International. All card names, set names, and images are property of their
  respective owners."*
- **Re-host card images** (R2) rather than hotlinking, with a per-card
  `image_source_url` retained for fallback and provenance.
- Implement a **"report card / image issue"** flow on every card detail page
  and a server-side kill switch to swap or hide a card's image quickly if a
  legitimate complaint arrives.
- **Never** sell merchandise, never imply affiliation, never redistribute
  card images as standalone assets outside the app.

See `context/legal-and-brand.md` for what this means at the code level.

---

## 3. Tech Stack

Turborepo monorepo with pnpm workspaces.

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 15 App Router (TypeScript) | SSR for shareable pages w/ proper OG previews, SEO, mature ecosystem |
| Mobile | Expo SDK (React Native, TypeScript) | Native camera + on-device ML via vision-camera + fast-tflite, EAS for builds |
| Shared UI tokens | Tamagui | Cross-platform design tokens; web and native share the system without forcing one component tree |
| Backend (managed) | Supabase (Postgres, Auth, RLS, Storage, Edge Functions) | Auth + db + RLS in one box; cheap to start; Postgres is portable later |
| Heavy services | Python (FastAPI) on Fly.io | Image embedding pipeline, ANN index builder, grading model serving, scrapers |
| Object storage | Cloudflare R2 | No egress fees; image-heavy app makes egress matter |
| Deploys (web) | Vercel | Free tier for dev, native Next.js host |
| Deploys (mobile) | EAS Build + EAS Submit | Standard for Expo |
| Auth providers | Google, Apple, Discord, magic link (email) | Apple required for iOS; Discord huge in TCG community |
| Payments | RevenueCat (mobile IAP) + Paddle (web), unified by RevenueCat entitlements | Pablo is in Chile where Stripe doesn't onboard sellers. Paddle is a Merchant of Record (handles global tax compliance) with an official RevenueCat integration. |
| Analytics | PostHog (self-hosted later if needed) | Generous free tier, product analytics + feature flags |
| Errors | Sentry | Standard |
| CI | GitHub Actions | We're on GitHub already |
| Local dev | Docker Compose | Postgres + MinIO + supabase-cli; everything runs offline |

See `context/tech-stack.md` for versions, exact package choices, and the
rationale for each.

### Repo layout

```
apps/
  web/                      # Next.js
  mobile/                   # Expo
  api-python/               # FastAPI: embeddings, ANN, grading, scrapers
packages/
  db/                       # Drizzle schema + migrations + types
  shared-types/             # Cross-runtime types (cards, collections, etc.)
  api-client/               # Typed client used by web + mobile
  set-completion/           # Master set math, percentage formulas
  smart-collection-dsl/     # Rule schema + evaluator
  ui/                       # Tamagui components shared web ↔ mobile
  config/                   # tsconfig/eslint/prettier shared configs
infra/
  docker-compose.yml
  supabase/                 # supabase-cli project
  fly/                      # fly.toml per service
data-pipeline/              # Source adapters + standardization layer (TS)
```

---

## 4. Infrastructure & Deployment

**Local-first development.** Everything in `docker-compose.yml` so a fresh
clone runs end-to-end with `pnpm i && pnpm dev`. No cloud account required to
start contributing.

**Production:**

- Web → Vercel (Next.js)
- Python services → Fly.io (1 small VM per service; combine where reasonable)
- DB + Auth + Storage → Supabase (start hobby, scale to Pro at $25/mo)
- Card images + user uploads → Cloudflare R2 (zero-egress)
- Mobile → App Store + Google Play via EAS

**Cost ceiling during dev:** $0–25/mo. Supabase free tier, Vercel hobby, R2
under 10GB free, Fly.io free allowances. We hit ~$25–40/mo around the time we
have real users and that's expected.

---

## 5. Auth & Accounts

Providers (all routed through Supabase Auth):

- Google OAuth
- Apple OAuth (required for iOS submission)
- Discord OAuth
- Email magic link (fallback, no password)

No password-based accounts. No GitHub login (per Pablo).

User record links 1:1 to a `profiles` row (Supabase pattern). RLS policies key
all data to `auth.uid()`.

---

## 6. Data Model (high-level)

The full schema lives in `context/data-model.md`. High-level entities:

- **set** — a TCG set (Sword & Shield, Brilliant Stars, Japanese Vstar
  Universe, etc.). Has `release_date`, `language`, `series`, `code`,
  `printed_total`, `total`, `logo_url`, `symbol_url`.
- **card** — a logical card (e.g. "Charizard #4 of Base Set"). One per
  number-in-set per language.
- **printing** — a specific physical printing of a card. This is the unit
  collectors actually own and check off. Variants live here: holo, non-holo,
  reverse holo, 1st edition, shadowless, gold star, alt art, full art, secret
  rare, Master Ball pattern, Poké Ball pattern, staff promo, prerelease
  stamp, league stamp, etc.
- **collection_item** — user's instance of a printing. Quantity, condition,
  optional grade (raw/PSA/BGS/CGC + numeric), acquisition date/price, notes,
  photos.
- **custom_collection** — user-defined grouping. Manual (free, 3 max) or
  smart-rule-based (paid).
- **smart_collection_rule** — a rule expression in our DSL.
- **shareable** — a public-link configuration over a collection.
- **grading_submission** — multi-shot capture + predicted scores +
  (optionally) actual graded outcome for the training flywheel.
- **profile** — user-facing account data. Display name, avatar, links.
- **subscription** — entitlement state (free/pro), source (rc/paddle).

Identifiers:

- `card.id` is a stable internal UUID.
- `card.canonical_key` is a deterministic string of the form
  `{language}-{set_code}-{number}` for joins across data sources.
- `printing.id` is UUID; `printing.variant_key` is a deterministic string of
  the form `{card.canonical_key}-{variant_code}`. Variant codes are
  enumerated and standardized in `context/tcg-domain.md`.

---

## 7. Data Sources & Standardization

Per language, we use a tiered model:

```
Per language:
  primary  — best coverage and quality, the authoritative source
  validation[] — sources we cross-check against
  filler[] — sources used for specific fields where they are stronger
```

### English

- **Primary:** TCGdex (broader variant coverage than pokemontcg.io)
- **Validation:** pokemontcg.io, Bulbapedia
- **Filler:** Pokellector (release dates, set ordering), Serebii (promo
  details)

### Japanese

- **Primary:** TCGdex (Japanese coverage), with Pokemon-Card.com (official)
  scraped where API access is missing
- **Validation:** TCGcollector, Bulbapedia (Japanese set pages)
- **Filler:** Yuyutei archive (variant detection), Cardrush listings (real
  Japanese variant terminology)

### Other languages

Best-effort via TCGdex; deferred to a later phase. Not in MVP.

### Pricing sources (separate pipeline)

Pricing has its own ingestion pipeline (see § 13). Catalog ingestion
(this section) is independent of pricing ingestion. The two share the
`printing` table as the join target but otherwise run independently.

### The standardization layer

All sources go through adapters that emit our canonical schema. The resolver:

1. Pulls from primary.
2. For each field, if validation source(s) disagree beyond a threshold,
   surface a conflict for human review (a `data_conflicts` table).
3. Filler sources only contribute fields the primary lacks.
4. Rarity, type, and variant taxonomies are normalized to our enums (defined
   in `context/tcg-domain.md`). Adapters own their per-source mappings.

This layer is implemented in `data-pipeline/` as runnable jobs, with results
materialized into the `card`, `printing`, and `set` tables.

---

## 8. Master Set Definition

Pablo's definition: **(b) every card including reverse holos + (c) every card
including secret rares and promos tied to the set, plus background variants
(Poké Ball pattern, Master Ball pattern, etc.).**

Concretely, a user has "mastered" a set when they own at least one copy of
**every printing** that the set's master-set rules include. The rules engine
(see `context/tcg-domain.md` and `packages/set-completion/`) evaluates per
set:

```
master_set_printings = printings(set) filtered by include_in_master_set = true
```

`include_in_master_set` is a boolean on `printing` set during ingestion using
per-set logic (e.g., Hidden Fates secret rares: yes; staff prereleases of a
modern set: typically no, but configurable). Edge cases live in
`context/tcg-domain.md` § Master Set Edge Cases.

### Completion percentages shown in the app

For each set the user sees:

- **Set %** — owns ≥1 printing of each numbered card. Variant-agnostic; a
  reverse holo Charizard alone counts as having Charizard.
- **Master Set %** — owns every printing where `include_in_master_set =
  true`.

Globally:

- **All Pokémon %** — counts unique numbered cards across all sets the user
  has ≥1 printing of, divided by total numbered cards in the database.
  (Pablo's spec: "if I have only the normal one of a card in one set, count
  like ok, you have that card.")
- **Master %** — sum of all master-set-included printings owned divided by
  total master-set-included printings.

All four metrics are pre-computed per user in a materialized view, refreshed
on collection change.

---

## 9. Custom & Smart Collections

### Manual custom collections

User explicitly adds/removes printings. Free tier: 3 max. Paid: unlimited.

### Smart collections (rule-based)

A smart collection is a saved query against the printing catalog. Rule
language is a typed JSON DSL; see `packages/smart-collection-dsl/` and the
dedicated task. Examples expressible:

- "All Charizards in any Sword & Shield-era set"
- "All Venusaurs printed in Japanese, holo only"
- "Every full-art trainer in Brilliant Stars"
- "All gold cards I don't own yet"

The DSL fields cover: `pokemon_name`, `card_type`, `rarity`, `set_series`,
`set_code`, `language`, `variant_class` (holo/RH/full-art/etc.), `is_owned`.

### Free vs paid gating

| Capability | Free | Pro |
|---|---|---|
| Browse smart-collection-style search results | ✅ ("All Charizards in SWSH" search works) | ✅ |
| **Save** a smart collection | ❌ (button visible but disabled with upgrade prompt) | ✅ |
| Manual custom collections | 3 | Unlimited |
| Smart collections | 0 | Unlimited |

The disabled "Save as smart collection" button is a key conversion surface;
spec it carefully (see `tasks/04-web/T-W-SMART-COLLECTIONS.md`).

---

## 10. Core App Features

These are the always-visible surfaces. Every screen in mobile and web maps to
one of them.

### Browse & search

- Sets ordered by **release date descending by default** (Pablo's #1
  complaint about Collectr). The newest set is first.
- Filter chips: language, series, set, rarity, type, variant, owned/missing.
- Full-text search over card names, set names, set codes.
- Advanced filters: number range, illustrator, format legality (deferred to
  v2).

### Card detail

- Hero image (R2-hosted), language toggle if multi-lang.
- All printings of that card (variant chips: holo, RH, alt art…). User can
  tap a printing to add/edit their copy.
- Per-printing condition, grade, quantity, acquisition fields.
- Price section (scaffolded, hidden until pricing is enabled).
- Report-issue link.

### Set page

- Header with logo, release date, total counts.
- Progress bars: Set % and Master Set %.
- Grid of cards; tap to detail. Toggle "show only missing".

### Collection home

- Top stats: total cards, unique printings, sets started, sets mastered, All
  Pokémon %, Master %.
- Recent additions, recent scans.
- Quick links to custom and smart collections.

### Custom collections

- List view, create new (with paid gating on smart).
- Per-collection page with progress, missing list, share button.

### Settings

- Account, subscription, sync state, language preferences (UI + which card
  languages to surface), export (CSV/JSON, paid).

### Mobile-only: Scanner

- See § 11.

---

## 11. Scanner Pipeline

### UX

User taps "Scan" → camera opens in continuous mode → user holds card in
frame, holds the next one when ready → app auto-detects "new card", runs
recognition, and:

- **High confidence (≥ threshold):** card flashes a confirmation
  outline + adds to collection silently. Toast at bottom: "Added Charizard
  #4". Each toast has an "Undo" affordance for ~5s.
- **Low confidence (< threshold):** scanner pauses, shows top 3 candidates,
  user taps the right one (or "none of these → manual search").

A persistent footer shows session count: "12 cards added — Done".

Stack mode is just continuous single-card mode with the auto-detect heuristic
that resets on "card removed from frame for >300ms" or "different card
geometry detected". No user toggle needed.

### Pipeline (on-device, free per scan)

```
camera frame
  → rectangle/quadrilateral detection (OpenCV via vision-camera frame processor)
  → perspective-correct crop to a normalized 245×342 RGB tensor
  → feature embedding (small TFLite model, ~5–15MB, run via fast-tflite)
  → ANN match against on-device index (HNSW or scaNN-equivalent)
  → top-K candidates with cosine sim scores
  → confidence calibration → auto-add or prompt
```

### Embedding model

Candidates (selection task in stage 06):

- A small image-similarity model (e.g., MobileViT-XS or EfficientNet-Lite0)
  fine-tuned via metric learning on the card image catalog.
- Alternative: an off-the-shelf CLIP variant (OpenCLIP ViT-B/32) used as-is —
  larger, slower on-device, but no training required for v1.

Decision criteria: ≤ 25MB on-device, ≤ 100ms per inference on a mid-range
phone, top-1 accuracy ≥ 95% on a held-out scan-quality test set.

### ANN index

Built server-side (Python) by embedding every printing image, packaged as a
binary file shipped with app updates and updatable out-of-band. Per-language
indices can be loaded on demand based on user preference.

### Confidence calibration

Calibration set = labeled real-phone scans (we'll bootstrap with a few
hundred). Threshold for auto-add chosen so false-positive auto-add rate <
0.5%. Below threshold → disambiguation UI.

### Cloud fallback (deferred)

Architecture supports a cloud fallback: a `recognize_low_confidence` server
endpoint that takes the cropped image and returns a re-ranked list using a
larger model (or vision LLM). **Not built in MVP.** The pipeline emits a
quality metric per scan; if real-world data shows <90% top-1, we revisit.

---

## 12. Grading Pipeline

### UX (multi-shot capture)

1. Front of card — guided framing, app waits for sharp + centered.
2. Back of card — same.
3. Four corner close-ups — guided one at a time.
4. Surface raking-light shot (front, angled) — captures whitening/scratches.

App rejects blurry frames automatically. User can re-take any step.

### Subgrades

Output: BGS-style four subgrades on a 0.0–10.0 scale, plus an aggregate.

- **Centering** — measured geometrically from front + back captures.
  Deterministic, not learned. 50/50 → 10.0; standard PSA tolerances.
- **Corners** — ML model on 4 corner crops.
- **Edges** — ML model on perimeter strips extracted from front + back.
- **Surface** — ML model on the raking-light shot + flat front shot.

Aggregate = BGS rule (lowest subgrade dominates with caveats; specifics in
the grading task spec).

### Calibration target

Goal: app prediction → actual PSA grade within ±1 of PSA outcome ≥ 80% of
the time on a held-out test set. Reported alongside every prediction as a
confidence band, not a single number ("This card looks like a PSA 8.5–9
candidate, ~72% confidence").

### Training data acquisition

Three ingestion pipelines, each its own task:

1. **PSA cert lookup** (`https://www.psacard.com/cert/{cert}`) — public
   pages with images + grade. Scrape rate-limited, respect robots.txt,
   surface ToS risk in the legal task.
2. **eBay sold listings** filtered by graded slabs — noisy but high volume.
3. **Auction archives** (PWCC, Goldin) — small but high quality.

Dataset curation is a real subproject. The training pipeline standardizes
images to the multi-shot schema (we'll reconstruct what we can from
listing photos; many listings only have one shot — those are usable for
centering and partial corner training but not full grading).

Plus a **community submission flywheel** post-launch: paid users who submit a
card and later upload their actual PSA/BGS slab photo earn credit.

### Models

Likely: a small CNN per subgrade (separate models keep iteration cheap),
exported via TFLite or ONNX. Centering is geometric, not learned. Models live
in `apps/api-python/grading/`, train via a Makefile, export to a versioned
artifact in R2, mobile fetches at install + on update.

---

## 13. Pricing & Affiliate Strategy

We ship pricing in MVP. The strategy is hybrid build-and-buy: a paid
aggregator for eBay sold + Cardmarket data on day one, eBay Browse API
for our own independently-collected active-listing time series, and our
own observation/aggregate schema so we own the historical record from
launch onwards.

### Why this strategy (the access reality)

Each of the obvious "do it ourselves" paths is gated:

- **TCGplayer API** — closed to new developers since late 2024. Scraping
  prohibited by ToS. Off the table.
- **eBay sold listings** — `findCompletedItems` decommissioned 2025.
  Marketplace Insights API is gated behind business-level approval that
  may or may not come. Apply over time as a non-blocking background task.
- **Cardmarket API** — Cardmarket's own help center: "Currently, we are
  not accepting applications for access to the Cardmarket API." Closed.
- **eBay Browse API** — open, free, no approval required. Returns
  *active* listings (asking prices, not sold). We use this directly.

### Markets: eBay primary, Cardmarket secondary

Pricing data is **market-segmented**. We never average across markets
because they reflect different buyer pools — a Charizard PSA 9 sells
for one number in the US (eBay USD) and a different number in Europe
(Cardmarket EUR). Combining them would lie.

- **Primary market: eBay US** (USD). Most volume, deepest grade-tier
  coverage, broadest card coverage. Headline price on every card
  detail comes from here unless the user changes their default market
  preference.
- **Secondary market: Cardmarket** (EUR). Surfaced when the user toggles
  "all markets" on a card, or when the user has set their default to
  Cardmarket (relevant for European collectors).
- **Future markets:** eBay UK, eBay JP — schema supports them, ingestion
  is post-launch.

The `market` catalog table seeds these and a `tier` flag (`primary` |
`secondary`) controls UI default behavior.

> **Note on Cardmarket access:** Cardmarket's official API is closed
> to new applications and explicitly forbids "constantly only
> requesting public marketplace resources" even when access is granted.
> Our Cardmarket coverage therefore comes through Layer 1 (the paid
> aggregator, which sources Cardmarket data legitimately) — not a
> direct integration. If we later need richer Cardmarket coverage and
> the API remains closed, options are (a) deeper aggregator tier, (b)
> a managed scraper service like Apify's Cardmarket Trend Scraper. We
> do not run our own Cardmarket scraper.

### Currency model: store native, convert at display time

We store every price in its **source currency** (USD for eBay US, EUR
for Cardmarket, etc.). Conversion happens at display time using the
exchange rate of the observation's date.

- `price_observation.observed_currency` — always set, never null.
- `price_aggregate` keyed by `(printing, grade_tier, market, currency, date)`
  — currency is part of the key, never lost.
- `fx_rate` — daily exchange rates table, populated by
  `T-DL-FX-RATES` from a free source (Frankfurter / European Central
  Bank). Backfilled for historical dates, refreshed daily.
- Display layer (`packages/pricing-display`) accepts `(amount, currency,
  observed_date)` and the user's display currency, looks up the rate,
  and formats. For a 90-day graph, each daily aggregate is converted
  using *its own day's rate*, so historical points reflect what they
  would have cost the user that day, not today.
- Missing rate for a date → fall back to most recent prior date and
  flag the display "approx."

User's display currency comes from `profile.preferences.display_currency`,
defaulting to USD. (Pablo's spec: convert at display time using the
exchange rate of *that day*.)

### Layer 1 — Aggregator (primary source, ships day one)

Subscribe to a Pokémon-focused pricing aggregator (e.g. PokeTrace,
pokemon-api.com — final selection in `T-DL-PRICING-AGGREGATOR`). They
have already done the work to ingest eBay sold listings, Cardmarket
data, and TCGplayer prices, parse listing titles, detect slab brand
and grade, and expose normalized data per (printing × grade tier ×
market). **This is also our only source of Cardmarket data**, since
Cardmarket's own API is closed.

Our pipeline pulls daily and writes every quote into our own
`price_observation` table tagged with `market` (`EBAY_US`,
`CARDMARKET_EU`, etc.) and source currency. We never read-through to
their API at request time. The aggregator is an input source, not the
data store.

Cost: free tier for development (~250 req/day), $20–50/mo at low scale,
$100+ at high traffic. Acceptable for a freemium product where pricing
is a paid feature.

### Layer 2 — eBay Browse API (independent, ships day one)

eBay's Browse API is open. We pull active listings for popular cards
on a daily cron, parse titles ourselves (slab + grade + condition
detection — see `T-DL-EBAY-LISTING-PARSER`), and write to the same
`price_observation` table with `observation_kind = 'active_listing'`.

This is asking-price data. Less reliable than sold prices, but it's
*ours*: independently collected, growing in coverage and history every
day from launch. After 12 months we have a year of data the aggregator
can't take from us.

### Layer 3 — Marketplace Insights (optional, post-launch)

Apply for eBay's Marketplace Insights API as a non-blocking business
task once Binderly has real users. Approval is more credible with
traction. If granted, it becomes a third source feeding the same
schema. Not on the v1 critical path; the spec is structured so it's a
drop-in addition.

### Grade tier coverage

Pricing is segmented by grade tier (see
`context/data-model.md` § Grade tiers). Top tiers tracked:

- Raw: NM, LP, MP, HP, DMG, plus "raw unknown condition"
- PSA: 10, 9, 8, 7, ≤6
- BGS: Black Label 10 (Pristine), 10, 9.5, 9, ≤8.5
- CGC: Pristine 10, 10, 9.5, 9, ≤8.5
- Other graded (SGC, AGS, ACE) bucketed into one tier

Most cards have observations in only 4–6 tiers in practice.

### Historical data from launch

`price_observation` is append-only. Every observation we ever ingest is
preserved. `price_aggregate` rolls up daily medians/means per (printing,
grade tier, day) for fast graph queries. After year one we have:

- ~365 daily aggregates per (printing, grade tier) covered
- Full raw observation log for auditability and re-aggregation
- Independent eBay active-listing trail growing in parallel

This is the moat. No competitor selling Pokémon collection tracking has a
purpose-built, normalized, multi-source, grade-segmented price time
series for *every* printing.

### Affiliate display (revenue, ships in MVP)

TCGplayer's affiliate program (via Impact) is open. We build "Buy on
TCGplayer" CTAs into card detail. The CTA is visually distinct from the
price display and the price display always discloses its source:

> **Estimated price (PSA 10):** $1,240
> *from eBay sold listings, last 30 days, 12 sales*
>
> **[Buy on TCGplayer →]**  (affiliate link)

The source line is non-removable, non-toggleable. We do not claim our
estimates reflect TCGplayer prices. TCGplayer is the *purchase* path;
eBay/Cardmarket are the *valuation* signal.

### Free vs paid

- **Free:** current estimated price (single tier picked from user's
  collection condition; e.g. show PSA 10 price if their copy is graded
  PSA 10, raw NM otherwise).
- **Paid:** all grade tiers shown side-by-side, 30/90/all-time price
  graphs, alerts on price moves, CSV export of price history.

---

## 14. Shareables

- Each user can create one or more shareable configurations: pick which
  collection (full / a custom one), pick a theme, pick what to show
  (counts, values, missing, photos).
- Generates a URL like `binderly.app/c/{handle}/{slug}`.
- SSR Next.js page with proper Open Graph / Twitter card meta.
- OG images dynamically generated (Vercel OG / Satori) showing some hero
  cards + key stats.
- Free tier: 1 shareable. Paid: unlimited and themable.

---

## 15. Offline Mode

Mobile must work at card shows with bad signal.

- All collection data cached locally in SQLite (Expo SQLite).
- The ANN index is on-device by design.
- Reads: always from local first, with a background refresh.
- Writes: queued locally, replayed on reconnect. Last-write-wins per
  `collection_item.updated_at`. Conflicts logged.
- Sync engine in `apps/mobile/src/sync/` — see scanner stage rules and the
  offline stage rules.

Web does **not** get full offline mode (out of scope; uses standard SWR
caching).

---

## 16. Freemium Plan

| Capability | Free | Pro |
|---|---|---|
| Unlimited collection size | ✅ | ✅ |
| Manual card entry | ✅ | ✅ |
| Single-card scanner | ✅ | ✅ |
| Stack scanner (continuous) | ❌ | ✅ |
| Grading prediction | ❌ | ✅ |
| Set completion tracking | ✅ | ✅ |
| Manual custom collections | 3 max | Unlimited |
| Smart collections (saved) | ❌ (search yes; save no) | Unlimited |
| Smart-collection search results in browse | ✅ | ✅ |
| Public shareable | 1 | Unlimited + themed |
| Pricing graphs / history | ❌ | ✅ |
| Export (CSV/JSON) | ❌ | ✅ |
| Cloud-AI scan fallback (when added) | ❌ | ✅ |

Pricing tiers TBD (target ~$5–7/mo or ~$50/yr). Annual default to anchor
value.

---

## 17. Build Phases

The dependency graph in `dependencies.yaml` is the source of truth. Phases
are loose groupings:

| Phase | Stage | Scope |
|---|---|---|
| 0 | Foundation | Monorepo, tooling, Docker, GitHub, CI, orchestrator scripts |
| 1 | Data Layer | DB schema, source adapters, standardization, image pipeline |
| 2 | Backend | Supabase RLS, auth, API contracts, pricing scaffold |
| 3 | Shared Packages | Set completion math, smart collection DSL, UI tokens |
| 4 | Web | Next.js app: browse, sets, collection, custom, public pages |
| 5 | Mobile | Expo app: same surfaces, mobile-native nav |
| 6 | Scanner | Detection → embed → ANN → match → UX |
| 7 | Grading | Multi-shot capture → models → calibration |
| 8 | Shareables | Public pages, OG, themes |
| 9 | Offline / Sync | Local DB, queue, conflict resolution |
| 10 | Paywall / Billing | RevenueCat + Paddle, entitlements, gating |
| 11 | Deployment | Production deploys, monitoring, analytics |

Within phases, tasks parallelize as far as the dep graph allows.

---

## 18. Open Questions & Risks

These are flagged for the orchestrator to surface to Pablo when they become
blocking. They live as TODOs throughout the spec; consolidated in
`open-questions.md` as the orchestrator hits them.

- **TCGplayer API access** — closed to new developers as of late 2024.
  Pricing strategy now defers the data feed decision; affiliate links
  (Impact program) are the immediate revenue channel.
- **Japanese set source completeness** — TCGdex JP coverage of older sets
  may force a custom scraper of Pokemon-Card.com. Validate during data layer
  stage.
- **Embedding model accuracy on real-world phone scans** — unknown until
  we have a calibration set. If <95% top-1, we revisit the cloud fallback
  decision.
- **PSA training data ToS** — scraping cert pages is grey-zone. The legal
  context file specifies guardrails; if we get a takedown we pivot to
  community submissions only.
- **iOS App Store review for an "unaffiliated" Pokémon-related app** —
  Apple has historically allowed these but reviewer roulette exists.
- **Tamagui maturity for our exact mix** — if it bites us, fall back to
  separate web (Tailwind) and native (NativeWind) UI with shared tokens
  only.

---

## 19. Out-of-scope reminders for agents

If a task asks for any of the following, STOP and escalate:

- Scraping or redistributing card images from Pokémon Company sources.
- Adding any TCG other than Pokémon to data ingestion.
- Implementing trade or marketplace features.
- Decoupling auth from Supabase.
- Building anything for Android-only or iOS-only without parity.
