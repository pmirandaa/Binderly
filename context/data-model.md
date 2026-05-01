# Data Model

The full schema. Drizzle ORM definitions live in `packages/db/src/schema/`
and must match this file exactly. If you need to deviate, update this file
in the same PR.

Conventions:

- All tables use snake_case names.
- Primary keys are UUIDs (Postgres `gen_random_uuid()`) unless otherwise
  noted.
- Every user-data table has `created_at` and `updated_at` timestamptz with
  defaults.
- Every user-data table has a `user_id uuid not null references
  auth.users(id) on delete cascade` and an RLS policy keyed to it.
- Catalog tables (sets, cards, printings) are read-only to all clients;
  ingestion writes via service role.

---

## Catalog tables (read-only to clients)

### `set`

```
id                uuid pk
canonical_key     text unique not null   -- e.g. 'en-swsh9'
code              text not null          -- 'swsh9'
language          text not null          -- 'en' | 'jp'
name              text not null          -- 'Brilliant Stars'
series            text                   -- 'Sword & Shield'
release_date      date not null
printed_total     int                    -- 'X/Y' Y
total             int                    -- includes secret rares
logo_url          text                   -- R2
symbol_url        text                   -- R2
master_set_rules  jsonb not null default '{}'  -- per-set overrides
source_metadata   jsonb not null default '{}'  -- adapter provenance
created_at        timestamptz
updated_at        timestamptz
```

Index: `(release_date desc, language, code)` for the default ordering.

### `card`

```
id                uuid pk
canonical_key     text unique not null   -- '{lang}-{set_code}-{number}'
set_id            uuid fk -> set.id
language          text not null
number            text not null          -- preserve formatting incl. 'TG01'
name              text not null          -- localized
name_localized    jsonb                  -- {en: '...', jp: '...'} where known
type              text                   -- GRASS, FIRE, ...
subtype           text                   -- POKEMON, TRAINER_ITEM, ...
hp                int
illustrator       text
flavor_text       text
attacks           jsonb                  -- normalized
weakness          jsonb
resistance        jsonb
retreat_cost      int
rarity            text                   -- normalized enum
source_metadata   jsonb not null default '{}'
created_at        timestamptz
updated_at        timestamptz
```

Index: `(set_id, number)`, `(name)` (gin trigram for search),
`(canonical_key)`.

### `printing`

```
id                       uuid pk
variant_key              text unique not null   -- '{card.canonical_key}-{variant_code}'
card_id                  uuid fk -> card.id
variant_class            text not null          -- HOLO | NON_HOLO | ...
variant_flags            text[] not null default '{}'
variant_code             text not null
include_in_master_set    boolean not null
image_small_url          text                   -- R2
image_large_url          text                   -- R2
image_source_url         text                   -- original source for fallback/provenance
source_metadata          jsonb not null default '{}'
created_at               timestamptz
updated_at               timestamptz
```

Index: `(card_id)`, `(variant_key)`, partial index where
`include_in_master_set = true`.

---

## User tables

### `profile`

```
user_id          uuid pk references auth.users(id) on delete cascade
handle           citext unique not null   -- public, used in /c/{handle}/{slug}
display_name     text
avatar_url       text
bio              text
preferences      jsonb not null default '{}'
created_at       timestamptz
updated_at       timestamptz
```

#### `profile.preferences` shape

The column is `jsonb` for forward flexibility, but the shape is
contractual and validated by zod schema in
`packages/shared-types/src/profile-preferences.ts`. All keys are
optional; missing keys fall back to documented defaults at read time.

```ts
{
  // Display currency for all monetary values in the UI. The pricing
  // pipeline always stores native currency; this preference controls
  // what the user sees. Conversion happens at display time using the
  // FX rate of the observation's date (per §13 of PROJECT.md).
  display_currency?: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CLP'
                   // ...add as needed; must exist as a quote_currency in fx_rate
                   // default: 'USD'

  // Default market for price display. The "primary" market in the
  // catalog (EBAY_US) is the global default; users can override
  // (e.g., European collectors might pick CARDMARKET_EU).
  default_market?: 'EBAY_US' | 'CARDMARKET_EU' | 'EBAY_UK' | 'EBAY_JP'
                 // default: 'EBAY_US'

  // Languages the user wants surfaced when browsing. Empty array
  // means "all languages". UI filters and search results respect this.
  card_languages?: ('en' | 'jp')[]
                 // default: ['en']

  // UI theme.
  theme?: 'system' | 'light' | 'dark'
        // default: 'system'

  // Locale for number/date formatting. Independent of card_languages.
  locale?: string                    // BCP-47, e.g., 'en-US', 'es-CL', 'de-DE'
         // default: derived from accept-language header at signup,
         // falling back to 'en-US'

  // Whether to receive marketing emails. Auth/billing emails always
  // sent regardless.
  email_marketing_opt_in?: boolean   // default: false

  // Pricing display preference: tier shown by default on free users
  // (single-tier display). Pro users see all tiers regardless.
  default_grade_tier_view?:
    | 'auto'                // pick from user's collection condition
    | 'raw_nm'
    | 'psa_10' | 'psa_9'
    | 'bgs_10' | 'bgs_9_5'
    // default: 'auto'

  // Opt-in to the grading training-data flywheel (Pro feature; users
  // who upload actual slab photos earn credit). See PROJECT.md §12.
  grading_flywheel_opt_in?: boolean  // default: false
}
```

**Validation rules:**
- `display_currency` must be a currency we have at least one
  `fx_rate` row for. Server validates on update.
- `default_market` must exist in the `market` catalog table.
- Unknown keys are stripped on write (zod `.strict()`).
- Schema version is implicit — any additions are backward-compatible
  optional fields. If we ever need a breaking change, add a
  `_schema_version: 2` discriminator.

This contract is enforced in three places:
1. The zod schema in `packages/shared-types`.
2. The Edge Function that handles `profile.update` calls validates
   inbound JSON against the schema before writing.
3. Read paths use the same zod schema with `.parse()` and the
   documented defaults for missing keys, so old rows without certain
   keys always behave correctly.

### `subscription`

```
user_id              uuid pk references auth.users(id) on delete cascade
tier                 text not null default 'free'   -- 'free' | 'pro'
source               text                            -- 'revenuecat' | 'paddle' | null
external_customer_id text
expires_at           timestamptz
last_event_at        timestamptz
raw                  jsonb
```

### `collection_item`

```
id                 uuid pk
user_id            uuid not null fk -> auth.users(id)
printing_id        uuid not null fk -> printing.id
quantity           int not null default 1 check (quantity >= 1)
condition          text not null default 'NEAR_MINT'
grade_company      text                       -- 'PSA' | 'BGS' | 'CGC' | null
grade              numeric(3,1)               -- 1.0..10.0; null if raw
acquired_at        date
acquired_price     numeric(10,2)
acquired_currency  text                       -- 'USD' | 'EUR' | ...
notes              text
photo_urls         text[] default '{}'        -- R2; user uploads
source             text not null default 'manual' -- 'manual' | 'scan' | 'import'
created_at         timestamptz
updated_at         timestamptz
```

Unique constraint: `(user_id, printing_id, condition, grade_company, grade)`
to allow a user to own multiple "instances" of the same printing in
different conditions/grades but coalesce duplicates with identical specs.
The unique constraint is intentionally narrow — re-evaluate during T-DL
review.

Index: `(user_id, printing_id)`, `(user_id, created_at desc)`.

### `custom_collection`

```
id            uuid pk
user_id       uuid not null fk
name          text not null
slug          text not null
kind          text not null              -- 'manual' | 'smart'
description   text
cover_url     text
created_at    timestamptz
updated_at    timestamptz
```

Unique: `(user_id, slug)`.

### `custom_collection_item` (manual collections only)

```
custom_collection_id  uuid fk
printing_id           uuid fk -> printing.id
added_at              timestamptz
primary key (custom_collection_id, printing_id)
```

### `smart_collection_rule`

```
custom_collection_id  uuid pk fk
expression            jsonb not null   -- DSL AST
last_evaluated_at     timestamptz
```

The DSL schema is defined in `packages/smart-collection-dsl/src/schema.ts`
and validated via zod. Smart collections never persist their members; the
result set is computed from `expression` against the catalog at read time
(with caching).

### `shareable`

```
id              uuid pk
user_id         uuid not null fk
slug            text not null
target          jsonb not null  -- {kind: 'full' | 'custom', custom_collection_id?}
theme           text not null default 'default'
show_values     boolean not null default false
show_missing    boolean not null default true
show_photos     boolean not null default false
created_at      timestamptz
updated_at      timestamptz
```

Unique: `(user_id, slug)`. The public URL is `/c/{profile.handle}/{slug}`.

### `grading_submission`

```
id                  uuid pk
user_id             uuid not null fk
printing_id         uuid fk
front_url           text not null
back_url            text not null
corner_urls         text[] not null   -- 4 entries
surface_url         text not null
predicted           jsonb not null    -- {centering, corners, edges, surface, aggregate, confidence}
actual              jsonb              -- {company, grade, subgrades?, slab_url?} when user uploads slab photo later
status              text not null default 'predicted' -- 'predicted' | 'submitted_for_grading' | 'graded'
created_at          timestamptz
updated_at          timestamptz
```

### `data_conflict` (admin-only)

```
id                uuid pk
entity            text not null    -- 'set' | 'card' | 'printing'
entity_key        text not null    -- canonical_key or variant_key
field             text not null
sources           jsonb not null   -- {tcgdex: 'X', ptcgio: 'Y', ...}
resolution        text             -- chosen value or null while pending
resolved_by       uuid             -- user id (admin) or null
created_at        timestamptz
```

### Pricing tables (populated when `PRICING_ENABLED=true`, default true post-MVP)

The pricing schema is built around two tables: `price_observation`
(append-only raw signal) and `price_aggregate` (rolled-up summaries for
fast UI queries). All pricing UI reads from `mv_current_price` (a
materialized view over `price_aggregate`).

### Grade tiers

A normalized enum used everywhere pricing references a card-condition
combination:

```
RAW_NM, RAW_LP, RAW_MP, RAW_HP, RAW_DMG, RAW_UNKNOWN
PSA_10, PSA_9, PSA_8, PSA_7, PSA_LOWER
BGS_10_BLACK, BGS_10, BGS_9_5, BGS_9, BGS_LOWER
CGC_10_PRISTINE, CGC_10, CGC_9_5, CGC_9, CGC_LOWER
OTHER_GRADED          -- SGC, AGS, ACE, etc., bucketed
```

Lower tiers (`*_LOWER`) intentionally bucket sparse data points to keep
sample sizes meaningful. Re-evaluate the bucket boundaries after a year
of data.

### Markets

A normalized enum identifying the source-market a price came from.
Different markets reflect different buyer pools and price levels —
they are *not* convertible to each other via FX, so we never average
across markets.

```
EBAY_US           -- primary
EBAY_DE           -- some Cardmarket-equivalent volume
EBAY_UK
EBAY_JP
CARDMARKET_EU     -- secondary; secondary means "shown when present, not blocking", not lower priority
TCGPLAYER_DERIVED -- via aggregator only; never direct
OTHER             -- fallback bucket
```

Each market has a `tier` of `primary` or `secondary` declared in the
`market` table (see below). UI shows a single primary price by default
and offers an "all markets" toggle that surfaces secondaries.

### `market` (catalog)

```
code            text pk                    -- 'EBAY_US', 'CARDMARKET_EU', ...
display_name    text not null              -- 'eBay US'
tier            text not null              -- 'primary' | 'secondary'
default_currency text not null             -- 'USD', 'EUR', 'JPY', 'GBP'
region          text                       -- 'US' | 'EU' | 'UK' | 'JP' | 'GLOBAL'
notes           text
```

Seed data inserted in the schema migration. `EBAY_US` is the default
market everywhere unless the user has explicitly chosen otherwise.

### `price_observation` (append-only, raw)

Each observation is stored in its **source currency**. We do not
convert at ingest time — currency conversion happens at display time
using the exchange rate of the observation's day (per Pablo's spec).

```
id                       uuid pk
printing_id              uuid not null fk -> printing.id
grade_tier               text not null              -- enum above
market                   text not null fk -> market.code
source                   text not null              -- 'aggregator_<name>' | 'ebay_browse' | 'ebay_marketplace_insights' | ...
source_listing_id        text                       -- for dedup
observation_kind         text not null              -- 'sold' | 'active_listing' | 'aggregator_quote'
observed_price            numeric(12,2) not null    -- in observed_currency
observed_currency         text not null             -- 'USD' | 'EUR' | 'JPY' | 'GBP' | ...
shipping                  numeric(12,2)             -- in observed_currency
parse_confidence          numeric(3,2)              -- 0..1; aggregates exclude < 0.7
observed_at               timestamptz not null      -- when the price was real
observed_date             date not null             -- date(observed_at), used for FX lookup
ingested_at               timestamptz not null default now()
raw_metadata              jsonb                     -- title, seller, source_url for debug
```

Index: `(printing_id, grade_tier, market, observed_at desc)`,
`(observed_date)` for FX joins and cron windows, unique
`(source, source_listing_id)` to dedup repeated ingestion.

This table grows monotonically. Partition by `observed_at` month after
12 months of data; not in MVP.

### `fx_rate` (daily exchange rates)

Currency conversion happens at display time using the rate of the
observation's day. For historical points we look up the rate for
`observed_date`. For "current" prices we use today's rate.

```
rate_date          date not null
base_currency      text not null              -- always 'USD' for our base; documented for future
quote_currency     text not null
rate               numeric(14,6) not null     -- 1 USD = N quote_currency
fetched_at         timestamptz not null
source             text not null              -- 'ecb' | 'openexchangerates' | 'frankfurter' | ...
primary key (rate_date, base_currency, quote_currency)
```

Populated daily by a cron job (`T-DL-FX-RATES`). For dates before the
job started running we backfill via the source's historical API. If a
date is missing we use the most recent prior date's rate and flag the
display as "approx."

Indexes: `(rate_date desc, quote_currency)` for the common forward
lookup.

### `price_aggregate` (rolled up daily, currency-aware)

Aggregates are stored *per currency of the underlying observations* so
no information is lost. Display layer converts to the user's chosen
display currency at read time using `fx_rate` for `period_start`.

```
printing_id              uuid not null fk -> printing.id
grade_tier               text not null
market                   text not null fk -> market.code
currency                 text not null              -- 'USD', 'EUR', 'JPY', 'GBP'; group key
period_start             date not null              -- inclusive
period_end               date not null              -- inclusive (= period_start for daily)
median_price             numeric(12,2)              -- in `currency`
mean_price               numeric(12,2)
low_price                numeric(12,2)
high_price               numeric(12,2)
sample_count             int not null
source_breakdown         jsonb not null             -- {ebay_browse: 12, aggregator_x: 1}
observation_kind_breakdown jsonb not null           -- {sold: 8, active_listing: 4, aggregator_quote: 1}
computed_at              timestamptz not null
primary key (printing_id, grade_tier, market, currency, period_start)
```

In practice each `(market, currency)` combo collapses cleanly because
each market has a dominant currency (eBay US → USD, Cardmarket → EUR).
The currency dimension exists for the rare cross-market listing.

Computed nightly by a job that scans `price_observation` rows for the
day, applies outlier filtering (drop top/bottom 5% if sample_count ≥ 20;
exclude `parse_confidence < 0.7`), and upserts the aggregate. Idempotent
— safe to re-run a day's aggregation.

### `mv_current_price` (materialized view)

Pre-computes the **primary-market** current price per (printing,
grade_tier) for fast lookups. Stored in source currency; UI converts
at render time. Secondary markets read directly from `price_aggregate`
when the user opts in.

```
printing_id              uuid
grade_tier               text
market                   text                       -- always a 'primary' tier market
currency                 text                       -- source currency
current_price            numeric(12,2)              -- median of last 30 days of aggregates, in `currency`
trend_30d_pct            numeric(5,2)
trend_90d_pct            numeric(5,2)
trend_all_time_pct       numeric(5,2)
sample_count_30d         int
last_observation_at      timestamptz
freshness                text                       -- 'fresh' | 'stale' | 'no_data'
primary key (printing_id, grade_tier, market)
```

Refreshed daily after `price_aggregate` runs. The card detail UI reads
exclusively from this view for the headline price. Graphs and "all
markets" reads go directly to `price_aggregate`.

---

## Materialized views

### `mv_user_set_completion`

```
user_id           uuid
set_id            uuid
set_pct           numeric(5,2)            -- 0..100
master_pct        numeric(5,2)            -- 0..100
owned_numbered    int
total_numbered    int
owned_master      int
total_master      int
last_updated      timestamptz
```

Refreshed on `collection_item` insert/update/delete via Postgres trigger or
Edge Function (decision in T-BE-EDGE-FUNCTIONS).

### `mv_user_global_completion`

```
user_id              uuid pk
all_pokemon_pct      numeric(5,2)
master_pct           numeric(5,2)
unique_cards_owned   int
unique_cards_total   int
master_owned         int
master_total         int
last_updated         timestamptz
```

---

## RLS policies (summary)

- `profile` — owner read/write own; public read of `(handle, display_name,
  avatar_url, bio)` for shareables.
- `subscription` — owner read; service role write only.
- `collection_item`, `custom_collection`, `custom_collection_item`,
  `smart_collection_rule` — owner read/write; nothing public.
- `shareable` — owner read/write; public read of *active* shareables for
  rendering public pages.
- `grading_submission` — owner read/write; service role read for the
  training flywheel (with the user's explicit opt-in flag in
  `profile.preferences`).
- `data_conflict` — admin role only.

Catalog tables (`set`, `card`, `printing`, `price`, `price_snapshot`) are
public-read, service-role-write.

---

## Image URLs

All `*_url` fields point to R2. The data-pipeline image task downloads from
the source, optimizes (WebP, multiple resolutions for `printing` images),
uploads to R2, and stores `https://images.binderly.app/{path}` URLs.

`image_source_url` is preserved for provenance and fallback.

Sizes for printings:

- `image_small_url` — 245×342 max, ~30KB target (used in grids and the
  scanner ANN preview)
- `image_large_url` — 734×1024 max, ~120KB target (card detail page)
