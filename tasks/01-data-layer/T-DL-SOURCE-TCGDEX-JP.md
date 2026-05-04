# T-DL-SOURCE-TCGDEX-JP — TCGdex JP adapter + Pokemon-Card.com fallback (Japanese primary)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** L
**Status:** in_progress

---

## Hard dependencies

- T-DL-SOURCE-INTERFACES (merged @ 51b3727 — provides `SourceAdapter`,
  `RateLimitedClient`, `Raw*` / `Canonical*` types, canonical-key
  helpers, the variant classifier, and the per-source rarity registry).
- T-DL-SOURCE-TCGDEX-EN (merged @ 1a741ab — provides the canonical
  adapter playbook **and** the reusable `isTcgdexPromoSet(setId)`
  helper this task imports verbatim from
  `data-pipeline/src/adapters/tcgdex-en/promo-sets.ts`).

## Soft dependencies

- None. Sibling adapter tasks (T-DL-SOURCE-PTCGIO,
  T-DL-SOURCE-BULBAPEDIA) integrate after merge; they should mirror
  this adapter's structure and registry pattern just like the EN
  adapter does.

## Required reading

- `PROJECT.md` § 6 (Data Model), § 7 (Sources & Standardization —
  esp. § 7 "Japanese": TCGdex JP **primary**, Pokemon-Card.com
  **filler** for missing-coverage gaps), § 8 (Master Set Definition),
  § 18 (Open Questions: "Japanese set source completeness — TCGdex JP
  coverage of older sets may force a custom scraper of
  Pokemon-Card.com").
- `rules/01-data-layer.md` — stage rules, esp. the "no raw fetch",
  "central variant classifier", "idempotent ingestion", and
  "Standardize on TCGdex's codes" hard rules.
- `context/tcg-domain.md` § 1 (variant taxonomy), § 5 (canonical
  keys; `card.canonical_key = "{language}-{set_code}-{number_padded}"`
  with `language='jp'` for Japanese cards), § 6 (rarity normalization),
  § 7 (type normalization), § 8 (variant decision tree).
- `context/legal-and-brand.md` § "Data source ToS" — TCGdex same
  posture as EN (open API, attribution requested). Pokemon-Card.com
  is not in the per-source list because PROJECT.md § 7 ratifies it
  inline as the **official Japanese fallback**; we follow the strict
  scraping etiquette: ≤1 req/s sustained, mandatory contactable
  User-Agent, parse only the public card DB, never download images.
- `context/conventions.md` — TS / eslint / commit conventions.
- `data-pipeline/README.md` § "How to add a new adapter" + § "Where
  rate limits live".
- `data-pipeline/src/types.ts` — `RawSet` / `RawCard` / `RawPrinting`
  zod schemas.
- `data-pipeline/src/interfaces/adapter.ts` — `SourceAdapter`
  interface, `AdapterError` discriminated union.
- `data-pipeline/src/http/rate-limited-client.ts` — required for ALL
  HTTP. Note the client returns parsed JSON via `json()`; for
  Pokemon-Card.com we use `request().text()` and parse HTML
  in-adapter.
- `data-pipeline/src/canonical-keys.ts` — never hand-compute keys.
- `data-pipeline/src/normalize/rarity.ts` — `tcgdex-jp` table is
  pre-seeded (see T-DL-SOURCE-INTERFACES); we extend it and add a
  fresh `pokemoncard-jp` table.
- `data-pipeline/src/variant-classify.ts` — consumes raw printing
  signals; both adapters MUST emit only signals (no
  `variant_class`).
- `data-pipeline/src/adapters/tcgdex-en/` — **the canonical adapter
  playbook**. The execution-notes appendix on
  `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-EN.md` is the design
  reference for siblings.
- `data-pipeline/src/adapters/tcgdex-en/promo-sets.ts` — the
  `isTcgdexPromoSet(setId)` helper is **reused verbatim** by the
  TCGdex JP adapter (the EN task notes pre-authorized this import).

## Goal

Ship the **Japanese-side** of the catalog: two sibling adapters that
together give us comprehensive Japanese coverage. **TCGdex JP**
(`primary`) reuses the same battle-tested REST shape we already
consume in EN — only the language slug changes (`/v2/jp/*`). Where
TCGdex JP has gaps (older Japanese sets, niche promos) the **official
Pokemon-Card.com** site (`filler`) fills them via polite HTML
scraping. Both ship in the same PR because the dependencies graph
declares them as a single deliverable (`provides:
[adapter:tcgdex-jp, adapter:pokemoncard-jp]`) and because the filler's
`pokemoncardJpToTcgdexJp` matcher only makes sense once the primary
exists.

The work also closes a known risk in PROJECT.md § 18 ("Japanese set
source completeness") by validating, via captured fixtures, that the
two sources together cover the spectrum from vintage WotC-era Japanese
sets through modern Scarlet & Violet to Pokémon Center-exclusive
promos.

---

## TCGdex JP — API research notes

### Endpoints we hit (all GET, JSON, no auth)

The TCGdex API is symmetric across languages: the only difference is
the second path segment. Per
[the docs](https://www.tcgdex.dev/rest), `/v2/{lang}/...` covers
`en`, `fr`, `de`, `es`, `it`, `pt`, `pt-br`, **`jp`**, `id`, `th`,
`zh-tw`. The Japanese subset returns the same JSON shape as EN, with
Japanese strings on `name`, `description`, `effect`, `attacks[*].name`,
`attacks[*].effect`, `abilities[*].name`, `abilities[*].effect`, and
the rarity vocabulary uses TCGdex's own English-tier labels
(`"Common"`, `"Uncommon"`, `"Double Rare"`, `"Art Rare"`, `"Special
Art Rare"`, etc.).

| Purpose                           | Path                                | Example                                          |
| --------------------------------- | ----------------------------------- | ------------------------------------------------ |
| List all JP sets (briefs)         | `/v2/jp/sets`                       | `https://api.tcgdex.net/v2/jp/sets`              |
| Single set with full card list    | `/v2/jp/sets/{setId}`               | `https://api.tcgdex.net/v2/jp/sets/sv1s`         |
| Single card with full detail      | `/v2/jp/cards/{setId}-{localId}`    | `https://api.tcgdex.net/v2/jp/cards/sv1s-001`    |

The brief response on `/v2/jp/sets` lacks `releaseDate` and `serie`,
so we always re-fetch each `/v2/jp/sets/{id}` for the full shape (same
behaviour as the EN adapter). The `cards` array embedded in
`/v2/jp/sets/{id}` is the `CardBrief` shape (id / localId / name /
image only), so we still iterate per-card via `/v2/jp/cards/{id}`.

### Response shape deltas vs EN

The shape itself is identical to EN; we just carry the Japanese
strings through unchanged. Specific fields that differ in content
(not shape):

- `name` — Japanese characters (mostly katakana with kanji on flavor
  strings). Adapters preserve verbatim. **Do not transliterate**.
  The downstream localization layer (T-W-CARD-DETAIL etc.) renders
  Japanese / English side-by-side.
- `set.serie.name` — Japanese series names (e.g. "スカーレット&バイオレット",
  "ソード&シールド").
- `attacks[*].name` / `attacks[*].effect` / `abilities[*].name` /
  `abilities[*].effect` — Japanese rules text. Carried verbatim.
- `description` — Pokémon Pokédex flavor in Japanese.
- `rarity` — TCGdex emits English-tier labels in JP responses
  (observed: `"Common"`, `"Uncommon"`, `"Rare"`, `"Double Rare"`,
  `"Art Rare"`, `"Super Rare"`, `"Special Art Rare"`, `"Hyper Rare"`,
  `"Shiny Rare"`, `"Shiny Super Rare"`, `"Character Rare"`,
  `"Character Super Rare"`, `"Ultra Rare"`, `"Promo"`, `"None"`).
  These are mostly the same words as EN with two JP-specific tiers
  (`Art Rare`, `Special Art Rare` — see § "Rarity normalization
  registry" below).
- `regulationMark` — same letters as EN; Japanese sets use the same
  regulation marks (D / E / F / G / H).

Set IDs follow TCGdex's own convention for Japanese sets:

- Modern (Scarlet & Violet era): `sv1s`, `sv1v`, `sv2a`, `sv2d`,
  `sv2p`, `sv3`, `sv4a`, `sv4k`, `sv4m`, `sv5a`, `sv5k`, `sv5m`,
  `svGd`, …
- Sword & Shield era: `s1a`, `s1h`, `s1w`, `s2a`, `s3`, `s4`, `s5a`,
  `s5i`, `s6a`, `s6h`, `s6k`, `s7d`, `s7r`, `s8`, `s8a`, `s8b`,
  `s9`, `s9a`, `s10a`, `s10b`, `s10d`, `s10p`, `s11`, `s11a`,
  `s12`, `s12a`, `swsh10pt5`, …
- Sun & Moon era: `sm1+`, `sm1m`, `sm1s`, `sm2k`, `sm2l`, …
- XY era: `xy1`, `xy2`, …
- BW era: `bw1`, `bw2`, …
- Vintage Japanese (pre-WotC reorganization, deep history): often
  exposed as `pokemonjapanese`, `intro-pack-iv`, `wp` (Wizards
  Promo), `pmcg-p` (PMCG Promo), etc.
- Promo sets: end in lowercase `p` (e.g. `xyp`, `swshp`, `svp`,
  `smp`) — **identical convention to EN**, which is why we reuse
  `isTcgdexPromoSet` without modification.

### Rate limit and User-Agent

TCGdex publishes no per-IP rate limit (their site advertises ~10M
requests/month aggregate, shared across all language slugs). The JP
adapter mirrors the EN adapter's conservative orchestrator-stated
floor: **5 req/s sustained, burst 10**, with `RateLimitedClient`
defaults (4 retries, 500ms base × 2^n backoff, 15s timeout, honor
`Retry-After`). EN and JP share the same host (`api.tcgdex.net`) but
each adapter constructs its own `RateLimitedClient` instance — they
do not share token-bucket state. In practice the seed-ingest task
serializes adapters, so this is observation-only.

`User-Agent`: same contract as EN — every external call carries a
contactable identifier. Default UA from `RateLimitedClient`'s built-in
default / `BINDERLY_DATA_PIPELINE_UA` env var.

### Idempotency posture

Identical to EN. Every Raw* derives its `code` / `setCode` /
`number` (and therefore canonical key downstream) from immutable
TCGdex identifiers (`set.id`, `card.localId`). Same theoretical drift
risk if TCGdex re-keys a set; same mitigation (warn-log, document).

---

## Pokemon-Card.com — Source research notes

### What it is

`https://www.pokemon-card.com/` is **the Pokémon Company Japan's
official card database**. PROJECT.md § 7 names it as the canonical
fallback for Japanese coverage gaps. § 18 lists "TCGdex JP coverage
of older sets may force a custom scraper of Pokemon-Card.com" as a
known data-layer risk; this task closes that risk by shipping a
working filler adapter.

There is **no documented public API**. Every read of the card DB is
HTML scraping. We are extremely conservative about it:

- **Rate limit.** ≤1 req/s sustained, burst 1. No exceptions.
- **User-Agent.** `binderly-data-pipeline/1.0
  (+https://github.com/pmirandaa/Binderly)` (the task brief
  mandates this exact form). Operator contact via the GitHub issue
  tracker at the URL.
- **No image hotlinking / mirroring.** The adapter records
  `imageSourceUrl` only; the image pipeline (T-DL-IMAGE-PIPELINE)
  re-hosts.
- **No spamming search endpoints.** We hit the per-card and
  per-expansion pages (deterministic shape, cacheable) and never
  the search-form auto-completion endpoint.
- **Cache aggressively.** Captured HTML fixtures are committed
  for tests; production caches via the seed-ingest task's existing
  on-disk JSON cache (handed off to seed-ingest in
  T-DL-SEED-INGEST).
- **Compliance with PROJECT.md § 19.** § 19 forbids "scraping or
  redistributing card images from Pokémon Company sources"; we do
  neither — we extract metadata fields only and persist the
  source URL. PROJECT.md § 7 explicitly authorizes Pokemon-Card.com
  scraping, so this isn't an § 19 violation. Documented for the
  reviewer's audit trail.

### URL shape (documented; subject to verification at seed-ingest time)

| Purpose                              | Path                                                          | Notes                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Single expansion (set) detail page   | `/card-search/index.php?keyword=&se_ta=&regulation_sidebar_form={SET_PCJP_ID}&pg=&illust=` | Lists every card in the expansion (paginated). `SET_PCJP_ID` is the official site's set identifier.    |
| Single card detail page              | `/card-search/details.php?id={CARD_PCJP_ID}`                  | Renders the card's full metadata: name (kanji+kana), HP, type, weakness, retreat, set, illustrator, rarity glyph. |
| Expansion list (sitemap-ish)         | `/card-search/`                                               | Static page, used to enumerate the per-set IDs for the matcher.                                          |

`SET_PCJP_ID` and `CARD_PCJP_ID` are decimal integers (e.g.
`3186` for the SV1S "Triplet Beat" expansion in current rotation;
`46892` for a representative card on that set's listing page). They
are **not** the TCGdex JP set/card IDs.

### Parsing strategy: regex-based extractor

The user-facing trade-off was Cheerio (~750KB unpacked, dependency
adds to `data-pipeline/package.json`) vs hand-rolled regex (no
deps, brittle). We chose **regex** for two reasons:

1. **No package.json edit.** The pre-authorized out-of-scope edits
   in this task are limited to `adapters/index.ts` and
   `normalize/rarity.ts`. Adding `cheerio` to
   `data-pipeline/package.json` would expand owns_paths beyond what
   the task brief authorizes. Regex stays inside the lines.
2. **Filler-tier parser surface is narrow.** This adapter only
   extracts ~12 fields per card and ~6 fields per set (set name +
   release date + symbol url + per-card listing). Each field is
   produced by a single regex against a short HTML chunk — well
   within what regex can do reliably. The brittleness risk
   (HTML structure changes) is manageable because: (a) the parser
   is fully fixture-tested, (b) Pokemon-Card.com has been stable
   for years (per archive.org diff samples), and (c) the failure
   mode is "filler returns nothing" not "primary breaks", which
   is the exactly the resolver tier semantics we want.

If a future task discovers regex is genuinely insufficient, the
upgrade path to Cheerio is mechanical (replace `extract*` helpers
with Cheerio selectors, add the dep, single-PR change).

### Encoding

Pokemon-Card.com serves UTF-8 with `<meta charset="UTF-8">` and
`Content-Type: text/html; charset=UTF-8` (verified via captured
fixture headers). Native `Response.text()` handles this correctly.
We do **not** anticipate Shift_JIS responses; if encountered, the
adapter would log a `pokemoncard-jp.encoding.unexpected` warning
and the workaround would be to call `Response.arrayBuffer()` +
manual `TextDecoder('shift_jis')`. Documented for the future case;
not implemented (YAGNI).

### "Card not found" detection

Pokemon-Card.com's missing-card behaviour: requests for an unknown
`id` parameter on `/card-search/details.php` return **HTTP 200** with
a body that lacks the `<dl class="cardDataDetail">` block. Our
parser detects this absence and surfaces `NotFoundError`. Captured
in fixture `card.notfound.html`.

### Rate limit and User-Agent

- **Sustained:** 1 req/s.
- **Burst:** 1 (no headroom; we never need to spike for a filler
  source).
- **Retry budget:** 2 retries with 1s base backoff (the operator is
  ourselves; if the polite limit isn't enough, we slow down further
  rather than burst).
- **User-Agent:** `binderly-data-pipeline/1.0
  (+https://github.com/pmirandaa/Binderly)` — passed explicitly to
  `RateLimitedClient` (the constructor honors an explicit
  `userAgent` over the env-var default).

### Resolver-tier rationale

This adapter is `tier: 'filler'`. The resolver's contract for
filler sources (per `data-pipeline/src/resolver/resolver.ts` and
PROJECT.md § 7): **filler sources only contribute fields the
primary leaves null/undefined**. They never override the primary
even on disagreement. They never cause a `DataConflict`.

The implication for Pokemon-Card.com: when TCGdex JP carries a card,
the filler is a no-op for that card's fields. Filler value-add is
exclusively (a) cards TCGdex JP doesn't carry at all (i.e. the
filler creates a brand-new canonical card record) and (b) fields
the primary returns `null` for. The latter case is rare for cards
both sources carry — TCGdex JP is comprehensive on the modern
catalog; the filler payoff is dominated by older / vintage Japanese
sets.

**Open behaviour question (resolved here, ratified at AC):** the
default resolver in T-DL-SOURCE-INTERFACES allows a filler source
to materialize a canonical record for a card the primary lacks
(`primary[] ∪ filler[]` keyed by canonical key). We rely on that
behaviour. If a future resolver change tightens the rule to "filler
can only fill fields, never create records", this adapter loses
most of its value and we re-open the question in `open-questions.md`.

### Pokemon-Card.com → TCGdex JP matcher

Pokemon-Card.com has its own integer ID system; TCGdex JP keys cards
by `{setId}-{localId}` where `setId` is TCGdex's set string and
`localId` is the on-card numbering. We need a deterministic matcher
that returns the canonical TCGdex JP key for each Pokemon-Card.com
card so the resolver can join them.

**Strategy:** match by `(setCode, number)` after normalizing both:

1. **Set code mapping.** Maintain a per-source alias table in
   `pokemoncard-jp/set-aliases.ts`: `Map<pcjpSetCode, tcgdexJpSetCode>`.
   The Pokemon-Card.com expansion page exposes a short code
   (`SVL`, `SV1S`, `S9`, `S10`, `S12a`, …) on its sidebar; we
   lower-case + strip and look it up in the alias table to get the
   TCGdex JP set id. The table is hand-curated for the sets we
   capture in fixtures; downstream tasks (T-DL-SEED-INGEST)
   extend it as new sets appear. Unknown source codes return
   `null` from `pokemoncardJpToTcgdexJp` → resolver treats as a
   filler-only canonical record.
2. **Card number normalization.** Pokemon-Card.com uses the same
   on-card numbering as TCGdex (`001`, `108`, `SV001`,
   `SVE` for energy-only inserts). We pass through
   `normalizeCardNumberForKey` (the existing helper in
   `canonical-keys.ts`) so `4` → `004`, `TG01` stays `TG01`.
3. **Compose.** `tcgdexJpKey =
   '${tcgdexJpSetCode}-${paddedNumber}'` (e.g.
   `s9-001`, `sv1s-198`).

`pokemoncardJpToTcgdexJp(card: PokemonCardJpCard) → string | null`
is unit-tested with hand-curated cases (modern S9, modern SV1S,
vintage set with no TCGdex JP coverage, mismatched numbering).

**Reliability bound.** AC requires the matcher to succeed on ≥90%
of fixtures and on 100% of the modern-set fixtures (S9 / SV1S).
If the matcher is unreliable on >10% of test cases, the task
escalates per the brief (the resolver may need a "filler creates
unmatched canonical printings" mode).

---

## Field mapping tables

### TCGdex JP Set → `RawSet`

Same shape as EN; the only deltas are the `language` constant and
the Japanese strings flowing through `name` and `series`.

| `RawSet` field        | TCGdex JP source                            | Notes                                                                |
| --------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `source`              | constant `'tcgdex-jp'`                      | provenance                                                           |
| `sourceKey`           | `set.id`                                    | adapter's stable per-set key                                         |
| `code`                | `set.id`                                    | TCGdex IDs are already lowercase                                     |
| `language`            | constant `'jp'`                             | adapter is per-language                                              |
| `name`                | `set.name`                                  | Japanese name verbatim                                               |
| `series`              | `set.serie?.name ?? null`                   | Japanese series name verbatim                                        |
| `releaseDate`         | `set.releaseDate`                           | TCGdex emits ISO yyyy-mm-dd                                          |
| `printedTotal`        | `set.cardCount?.official ?? null`           | numbered, on-card                                                    |
| `total`               | `set.cardCount?.total ?? null`              | includes secret rares + alt prints                                   |
| `logoUrl`             | `set.logo + '.png'` when present, else null | TCGdex serves logo without extension; suffix `.png`                  |
| `symbolUrl`           | `set.symbol + '.png'` when present, else null | same convention                                                    |
| `extra.tcgOnline`     | `set.tcgOnline ?? undefined`                |                                                                      |
| `extra.abbreviation`  | `set.abbreviation?.official ?? undefined`   |                                                                      |
| `extra.legal`         | `set.legal ?? undefined`                    |                                                                      |
| `extra.cardCounts`    | `set.cardCount` (full object)               |                                                                      |
| `extra.serieId`       | `set.serie?.id ?? undefined`                | preserved for cross-source joins                                     |

### TCGdex JP Card → `RawCard`

The single material difference vs EN: `nameLocalized` carries the
Japanese name (since this adapter is the JP authority — when the
seed-ingest task joins en/jp on a shared dexId or on the per-source
`cardId` cross-walk, the JP name is what `nameLocalized.jp` becomes
on the EN canonical record). The JP record's own `name` is also the
Japanese name (the resolver doesn't double-write `nameLocalized.jp`
on a `language='jp'` record — the seed-ingest task does the cross-
language join).

| `RawCard` field          | TCGdex JP source                                                                       | Notes                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `source`                 | constant `'tcgdex-jp'`                                                                 |                                                                         |
| `sourceKey`              | `card.id`                                                                              | e.g. `s9-001`                                                           |
| `setCode`                | `card.set.id`                                                                          | parent set's TCGdex ID                                                  |
| `language`               | constant `'jp'`                                                                        |                                                                         |
| `number`                 | `card.localId`                                                                         | preserved verbatim                                                      |
| `name`                   | `card.name`                                                                            | Japanese name                                                           |
| `nameLocalized`          | `null`                                                                                 | this adapter is the JP authority; cross-language join lives downstream  |
| `typeRaw`                | `card.types?.[0] ?? null`                                                              |                                                                         |
| `subtypeRaw`             | derived (Pokemon / `trainerType` / Energy basic-or-special)                            | same algorithm as EN                                                    |
| `hp`                     | `card.hp ?? null`                                                                      |                                                                         |
| `illustrator`            | `card.illustrator ?? null`                                                             |                                                                         |
| `flavorText`             | `card.description ?? null`                                                             | Japanese flavor                                                         |
| `attacks`                | `card.attacks ?? null`                                                                 | Japanese attack names + effects, preserved                              |
| `weakness`               | `card.weaknesses ?? null`                                                              |                                                                         |
| `resistance`             | `card.resistances ?? null`                                                             |                                                                         |
| `retreatCost`            | `card.retreat ?? null`                                                                 |                                                                         |
| `rarityRaw`              | `card.rarity ?? null` (mapped to `null` when string is `'None'`)                       | normalized via `normalizeRarity('tcgdex-jp', …)` in seed-ingest         |
| `extra.dexId`            | `card.dexId ?? undefined`                                                              |                                                                         |
| `extra.stage`            | `card.stage ?? undefined`                                                              |                                                                         |
| `extra.evolveFrom`       | `card.evolveFrom ?? undefined`                                                         | Japanese name of pre-evolution                                          |
| `extra.regulationMark`   | `card.regulationMark ?? undefined`                                                     |                                                                         |
| `extra.suffix`           | `card.suffix ?? undefined`                                                             | V / VMAX / VSTAR / ex                                                   |
| `extra.legal`            | `card.legal ?? undefined`                                                              |                                                                         |
| `extra.effect`           | `card.effect ?? undefined`                                                             | trainer / energy effect (Japanese)                                      |
| `extra.trainerType`      | `card.trainerType ?? undefined`                                                        |                                                                         |
| `extra.energyType`       | `card.energyType ?? undefined`                                                         |                                                                         |
| `extra.abilities`        | `card.abilities ?? undefined`                                                          | Japanese ability names + effects                                        |
| `extra.imageUrl`         | `card.image + '/high.png'` when present                                                | full-quality URL                                                        |
| `extra.updated`          | `card.updated ?? undefined`                                                            |                                                                         |
| `extra.category`         | `card.category ?? undefined`                                                           |                                                                         |

### TCGdex JP Card → `RawPrinting[]`

**Identical** to EN's `tcgdexCardToPrintings` algorithm — it is
imported and re-exported as `tcgdexJpCardToPrintings` (well, a
parallel `tcgdex-jp` implementation that calls into the same logic;
see "Code reuse" below). The rules are unchanged because TCGdex JP
returns the same `variants` / `variants_detailed` / `rarity`
shape as EN.

Source signal precedence (per EN, restated):
1. `variants_detailed[]` → 1 printing per entry.
2. `variants` flags → 1 printing per `true` flag.
3. Rarity-string fallback (SV-era special rares) → 1 printing.
4. Promo-set fallback (`isTcgdexPromoSet(setId) === true`) → 1
   printing with `isPromo: true`.

Per-printing raw signals are unchanged:

- `source` → `'tcgdex-jp'`
- `sourceKey` → `${card.id}-${variantTag}` (e.g. `s9-001-normal`,
  `s9-001-reverse`, `sv1s-198-illustration`).
- `cardKey` → `card.id`
- `sourcePrintingLabel` → human-readable variant label
  (`'Holo'` / `'Reverse Holo'` / `'Illustration Rare'` etc. in
  English — the label is internal ops debugging, not user-facing)
- `rarityRaw` → `card.rarity` (post-`normalizeRarityRaw` to coerce
  `'None'` → `null`)
- `isHolo` / `isReverseHolo` / `isFirstEdition` / `isShadowless` —
  same derivation as EN.
- `isFullArt` → rarity is `'Illustration Rare'` / `'Art Rare'` (the
  JP-tier alias; see § "Rarity normalization registry" below).
- `isAltArt` → rarity is `'Special Illustration Rare'` / `'Special
  Art Rare'`.
- `isGoldRare` → rarity is `'Hyper Rare'`.
- `isRainbowRare` → rarity is `'Rainbow Rare'` / `'Rare Rainbow'`
  (rare on JP-side; observed on a few sets).
- `isTextured` → `false` (TCGdex doesn't surface texture in either
  language).
- `isTrainerGallery` → matches `^(TG|GG)\d+$` on `localId` (rare on
  JP — the Trainer Gallery / Galarian Gallery sub-sets primarily
  shipped in English; some JP sets carry adjacent inserts).
- `isPromo` → `isTcgdexPromoSet(card.set.id) === true || card.variants?.wPromo === true`.
- `pattern` / `stamp` → `null` (TCGdex doesn't surface these in
  either language; the resolver picks them up from filler /
  validation tiers).
- `imageSourceUrl` → `card.image + '/high.png'` when present.
- `extra.tcgdexVariantId` / `extra.size` / `extra.subtypeTag` —
  same as EN.

### Pokemon-Card.com Set → `RawSet`

Pokemon-Card.com pages don't expose a structured "set object"; we
extract the fields below by scraping the expansion page header.

| `RawSet` field    | Pokemon-Card.com source                                                | Notes                                                                                  |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `source`          | constant `'pokemoncard-jp'`                                            |                                                                                        |
| `sourceKey`       | `pcjpSetId` (the integer ID from the URL, as a string)                  | adapter's stable per-set key                                                           |
| `code`            | matched TCGdex JP set code via `pokemoncardJpSetToTcgdexJp(setHeader)` (else: lowercased on-page short-code) | the matcher returns the TCGdex JP code when known so canonical-key joins line up      |
| `language`        | constant `'jp'`                                                        |                                                                                        |
| `name`            | extracted from `<h2 class="expansionName">` or page `<title>`          | Japanese; trimmed                                                                      |
| `series`          | derived from the on-page series label when present, else `null`        | optional; many older sets don't surface a series                                       |
| `releaseDate`     | extracted from `<dt>発売日</dt><dd>YYYY年M月D日</dd>` formatted ISO    | ISO conversion done in transform                                                       |
| `printedTotal`    | `null`                                                                 | Pokemon-Card.com does not render a "printed total" headline on expansion pages         |
| `total`           | `null`                                                                 | same                                                                                   |
| `logoUrl`         | extracted from `<img class="expansion-logo" src="...">` when present   | absolute URL (rewritten to `https://www.pokemon-card.com/...` if relative)             |
| `symbolUrl`       | extracted from `<img class="expansion-symbol" src="...">` when present | same                                                                                   |
| `extra.pcjpSetId` | the integer set ID from the URL                                         | preserved for re-fetch + matcher                                                       |
| `extra.shortCode` | the on-page short code (e.g. `SV1S`)                                   | preserved for the matcher                                                              |

### Pokemon-Card.com Card → `RawCard`

| `RawCard` field          | Pokemon-Card.com source                                                                  | Notes                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `source`                 | constant `'pokemoncard-jp'`                                                              |                                                                        |
| `sourceKey`              | `pcjpCardId` (the integer card ID from the URL, as a string)                             | adapter's stable per-card key                                          |
| `setCode`                | matched TCGdex JP set code (else: lowercased on-page short-code)                         | matcher output                                                          |
| `language`               | constant `'jp'`                                                                          |                                                                        |
| `number`                 | extracted from `<dl class="cardDataDetail"><dt>カード番号</dt><dd>{NUMBER}/{TOTAL}</dd>` | the slash-prefix (the on-card "X/Y") — only the X part                  |
| `name`                   | extracted from `<h1 class="pageHeader cardDetail">`                                       | Japanese name; trimmed                                                 |
| `nameLocalized`          | `null`                                                                                   | filler doesn't carry English; primary owns                              |
| `typeRaw`                | extracted from the type-icon `alt` attr (`草` / `炎` / `水` / `雷` / `超` / `闘` / `悪` / `鋼` / `フェアリー` / `ドラゴン` / `無色`); mapped to TCGdex's English type words via a small lookup table | `null` for non-Pokémon                                                  |
| `subtypeRaw`             | derived: `'Pokemon'` if HP present, `'Item'` / `'Supporter'` / `'Stadium'` / `'Tool'` from the trainer-subtype label, else `'Basic Energy'` / `'Special Energy'` from the energy label | same coarse mapping as EN                                              |
| `hp`                     | extracted from `<span class="hp-num">`; integer parse                                     | absent on Trainer / Energy → `null`                                    |
| `illustrator`            | extracted from `<dt>イラストレーター</dt><dd>{NAME}</dd>`                                  |                                                                        |
| `flavorText`             | extracted from the Pokédex flavor block when present                                       |                                                                        |
| `attacks`                | `null`                                                                                   | filler does not parse attack mechanics; primary owns                   |
| `weakness`               | extracted from `<dt>弱点</dt><dd>{TYPE}{×N}</dd>` as `[{type, value}]`                   |                                                                        |
| `resistance`             | extracted from `<dt>抵抗力</dt><dd>{TYPE}{-N}</dd>` when present                          |                                                                        |
| `retreatCost`            | extracted from `<dt>にげる</dt><dd>{N}</dd>` (count of energy icons)                      |                                                                        |
| `rarityRaw`              | extracted from `<span class="rarity">{GLYPH}</span>` and mapped to a TCGdex-style label (e.g. `◆` → `'Common'`, `◆◆` → `'Uncommon'`, `◆◆◆` → `'Rare'`, `K` → `'Hyper Rare'`, `AR` → `'Art Rare'`, `SAR` → `'Special Art Rare'`, `SR` → `'Super Rare'`, `UR` → `'Ultra Rare'`, `CHR` → `'Character Rare'`, `CSR` → `'Character Super Rare'`, `S` → `'Shiny Rare'`, `SSR` → `'Shiny Super Rare'`) | mapped via a small const table; unknown glyphs surface as `null` so the resolver doesn't force a guess |
| `extra.pcjpCardId`       | the integer card ID from the URL                                                          | preserved for re-fetch + matcher                                       |
| `extra.imageUrl`         | extracted from `<img class="card-image" src="...">` (rewritten to absolute URL)            | preserved as `imageSourceUrl` on the printing too                       |

### Pokemon-Card.com Card → `RawPrinting[]`

Pokemon-Card.com renders ONE detail page per printing — distinct
prints (e.g. "Master Ball pattern" reverse holo, Pokemon Center
Stamped) get their own `pcjpCardId`. Therefore the adapter emits
exactly **one printing per detail page**:

| `RawPrinting` field    | Source                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`               | `'pokemoncard-jp'`                                                                                                                              |
| `sourceKey`            | `${pcjpCardId}-${variantTag}` where `variantTag` is the rarity-glyph code (`ar`, `sar`, `sr`, …) lowercased, defaulting to `'main'` on `null`.   |
| `cardKey`              | `pcjpCardId` — the adapter's own card key. Resolver uses `pokemoncardJpToTcgdexJp` to map this to the TCGdex JP cardKey for cross-source merge. |
| `sourcePrintingLabel`  | human-readable rarity label (e.g. `'Art Rare'`, `'Special Art Rare'`, `'Hyper Rare'`).                                                          |
| `rarityRaw`            | parent card's `rarityRaw`.                                                                                                                      |
| `isHolo`               | `true` when rarity glyph is in `{R, RR, AR, SAR, SR, SSR, HR, UR, CHR, CSR}`. The non-holo/reverse-holo distinction is not surfaced by Pokemon-Card.com directly; we record `isHolo` conservatively and let the variant classifier fall back via rarity-string signals. |
| `isReverseHolo`        | `false` (Pokemon-Card.com does not render reverse-holo metadata as a distinct page).                                                            |
| `isFirstEdition`       | `false` (Japanese sets don't carry a 1st-Edition stamp; the Japanese print-run convention uses A/B/C edition stamps that the adapter does NOT yet parse). |
| `isShadowless`         | `false`                                                                                                                                         |
| `isFullArt`            | rarity is `'Art Rare'` / `'Illustration Rare'`.                                                                                                  |
| `isAltArt`             | rarity is `'Special Art Rare'` / `'Special Illustration Rare'`.                                                                                  |
| `isGoldRare`           | rarity is `'Hyper Rare'` (`HR`/`UR` glyphs).                                                                                                     |
| `isRainbowRare`        | `false` (Pokemon-Card.com tags these as `HR`/`UR`; the rainbow visual is a sub-axis we don't surface).                                          |
| `isTextured`           | `false`                                                                                                                                         |
| `isTrainerGallery`     | `localId` matches `^(TG\|GG)\d+$/i` (rare on JP).                                                                                               |
| `isPromo`              | `true` when the matched set's TCGdex code resolves to a promo set (`isTcgdexPromoSet(matchedSetCode)`), or when the on-page set short-code matches `SVP`/`SMP`/`SWSHP`/`XYP`/`PR-SV`/`SP` (Special) etc. |
| `isError`              | `false`                                                                                                                                         |
| `pattern`              | `null` (filler does not surface pattern; downstream filler/validation tiers handle).                                                            |
| `stamp`                | `null` (Pokemon Center stamps and similar are surfaced via separate `pcjpCardId`s; we don't classify them here).                                |
| `imageSourceUrl`       | the parent `RawCard.extra.imageUrl` (i.e. the per-printing image).                                                                              |
| `extra.pcjpCardId`     | the integer card ID                                                                                                                              |
| `extra.rarityGlyph`    | the raw glyph string from the page                                                                                                              |
| `extra.shortCode`      | the on-page set short-code (preserved for the matcher)                                                                                          |

---

## Rarity normalization registry

### TCGdex JP table (extensions only — table seeded in T-DL-SOURCE-INTERFACES)

The pre-seeded table covers `Common`, `Uncommon`, `Rare`,
`Rare Holo`, `Double Rare`, `Ultra Rare`, `Special Art Rare`,
`Special Illustration Rare`, `Illustration Rare`, `Art Rare`,
`Hyper Rare`, `Shiny Rare`, `Shiny Super Rare`, `Character Rare`,
`Character Super Rare`, `Promo`. **Confirmed sufficient by
fixture review** — no additions required.

For test coverage we add the lowercase-`rare` SV-era variants
(observed on some fixtures, mirrors EN's pattern):

| TCGdex JP string             | Canonical                       | Reason                                                                          |
| ---------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `Hyper rare`                 | `HYPER_RARE`                    | covered by case-insensitive fallback; explicit add for hot-path                 |
| `Illustration rare`          | `ILLUSTRATION_RARE`             | same                                                                            |
| `Special illustration rare`  | `SPECIAL_ILLUSTRATION_RARE`     | same                                                                            |
| `Rare Rainbow`               | `RAINBOW_RARE`                  | observed on a few JP-side prints (rainbow rares were briefly tagged this way)  |
| `Rainbow Rare`               | `RAINBOW_RARE`                  | same                                                                            |

`'None'` rarities are coerced to `null` upstream (same as EN), so
we don't register a mapping for it.

### Pokemon-Card.com table (new)

Initial table — all glyph forms map through the **TCGdex-style
label** the parser emits, not the raw glyph (see "rarity glyph →
label" lookup in the parser):

| Pokemon-Card.com label     | Canonical                        | Reason                                                                                 |
| -------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `Common`                   | `COMMON`                         | `◆` glyph                                                                              |
| `Uncommon`                 | `UNCOMMON`                       | `◆◆`                                                                                   |
| `Rare`                     | `RARE`                           | `◆◆◆`                                                                                  |
| `Double Rare`              | `DOUBLE_RARE`                    | SV-era `RR` (lowercase ex tier)                                                        |
| `Super Rare`               | `ULTRA_RARE`                     | SR — VMAX/VSTAR/ex. JP "Super Rare" maps to our `ULTRA_RARE` per § 6                   |
| `Ultra Rare`               | `ULTRA_RARE`                     | UR (rare on Pokemon-Card.com but observed on older fixtures)                           |
| `Hyper Rare`               | `HYPER_RARE`                     | HR — gold cards                                                                         |
| `Illustration Rare`        | `ILLUSTRATION_RARE`              | A / AR — JP equivalent of EN's "Illustration Rare"                                     |
| `Art Rare`                 | `ILLUSTRATION_RARE`              | alias used on some pages                                                               |
| `Special Illustration Rare` | `SPECIAL_ILLUSTRATION_RARE`     | SAR                                                                                     |
| `Special Art Rare`         | `SPECIAL_ILLUSTRATION_RARE`     | alias                                                                                   |
| `Shiny Rare`               | `ULTRA_RARE`                     | S — shiny pull (modern Pokémon GO-set style)                                           |
| `Shiny Super Rare`         | `ULTRA_RARE`                     | SSR                                                                                     |
| `Character Rare`           | `ULTRA_RARE`                     | CHR                                                                                     |
| `Character Super Rare`     | `ULTRA_RARE`                     | CSR                                                                                     |
| `Promo`                    | `PROMO`                          | promo prints (Sun-and-Moon era P, Sword-and-Shield era SP, SVP, …)                     |

---

## Code reuse: TCGdex JP imports from TCGDEX-EN

Per the TCGDEX-EN execution-notes appendix, the following imports
from `../tcgdex-en/` are pre-authorized:

- `isTcgdexPromoSet(setId)` from `../tcgdex-en/promo-sets.ts` —
  the promo-detection rule is shared (TCGdex's `setId.endsWith('p')`
  convention is identical for EN and JP).

The TCGdex JP `transform.ts` is structurally a clone of EN's, with
language constants and `'tcgdex-jp'` source name swapped. Where EN's
helper functions (`buildPrinting`, `buildPrintingFromDetailed`,
`buildVariantTag`, `buildLabel`, `rarityToVariantSignals`,
`normalizeRarityRaw`, `deriveSubtypeRaw`, `assetUrl`) are stable and
shared logic, we **copy** rather than import them — adapter
internals stay decoupled so a future EN-only change (e.g. EN-specific
rarity alias) doesn't ripple into JP. The shared `isTcgdexPromoSet`
is a deliberate exception because the rule is genuinely
language-agnostic.

The `api-types.ts` TCGdex shape is identical EN→JP; we **copy**
rather than import to keep adapter type surfaces independent (a
future JP-only field addition shouldn't churn EN consumers).

This isolation is the same posture taken for the EN `transform.ts`
itself: pure functions per-adapter.

---

## Deliverables

### TCGdex JP adapter (mirrors `tcgdex-en/`)

- `data-pipeline/src/adapters/tcgdex-jp/index.ts` — public barrel:
  exports `createTCGdexJpAdapter`, `TCGdexJpAdapter`, the
  transform fns (`tcgdexJpSetToRaw`, `tcgdexJpCardToRaw`,
  `tcgdexJpCardToPrintings`), and the `TCGdexJp*` API types.
- `data-pipeline/src/adapters/tcgdex-jp/adapter.ts` — class
  implementing `SourceAdapter`. Constructor accepts `AdapterContext`
  + `{ http: RateLimitedClient, basePath?: string }`. Default base
  path `/v2/jp`. Methods: `listSets()`, `listCardsForSet(setKey)`,
  `listPrintingsForCard(cardKey)`. Maps `NotFoundError` to "no
  data" semantics (returns `[]` for list-shaped methods).
- `data-pipeline/src/adapters/tcgdex-jp/transform.ts` — pure
  transform functions. Imports `isTcgdexPromoSet` from
  `../tcgdex-en/promo-sets.ts`. Zero side effects, no HTTP.
- `data-pipeline/src/adapters/tcgdex-jp/api-types.ts` — TS types
  for the TCGdex JP response shapes (lenient, optionals tolerated;
  copy of EN `api-types.ts` with `tcgdex-jp` doc-comment header).
- `data-pipeline/src/adapters/tcgdex-jp/fixtures/` — captured JSON:
  - `set.s9.json` — Sword & Shield "Star Birth" (modern S&S-era,
    holo and reverse-holo variants).
  - `set.sv1s.json` — Scarlet & Violet "Triplet Beat" (SV-era,
    Illustration Rare / Special Illustration Rare / Hyper Rare).
  - `set.svp.json` — SV Promo Card Pack (promo set).
  - `card.s9-001.json` — Common w/ normal+reverse.
  - `card.s9-018.json` — Holo Rare V/VSTAR Pokémon (Japanese name).
  - `card.sv1s-198.json` — Special Art Rare (the JP-tier alias of
    Special Illustration Rare).
  - `card.sv1s-073.json` — Art Rare (JP-tier alias of Illustration
    Rare).
  - `card.sv1s-108.json` — Hyper Rare basic energy.
  - `card.svp-001.json` — Promo, rarity `'Promo'`.
- `data-pipeline/src/adapters/tcgdex-jp/transform.test.ts` — unit
  tests over every fixture; assert produced `Raw{Set,Card,Printing}`
  shapes and round-trip through the zod schemas.
- `data-pipeline/src/adapters/tcgdex-jp/adapter.test.ts` —
  integration tests using a `FetchShim` shim — happy / 404 / 429
  retry / malformed JSON / User-Agent header.
- `data-pipeline/src/adapters/tcgdex-jp/resolver-integration.test.ts`
  — wires the adapter (with shim) into `resolveCanonicalSets` /
  `resolveCanonicalCards`; asserts `jp-s9` canonical key,
  `tcgdex-jp` provenance, no conflicts.

### Pokemon-Card.com adapter

- `data-pipeline/src/adapters/pokemoncard-jp/index.ts` — public
  barrel.
- `data-pipeline/src/adapters/pokemoncard-jp/adapter.ts` — class
  implementing `SourceAdapter`. Constructor pinned to
  `www.pokemon-card.com`, default base path `''` (root).
- `data-pipeline/src/adapters/pokemoncard-jp/transform.ts` — pure
  HTML-string → `Raw{Set,Card,Printing}` transforms. Regex-based;
  fully fixture-tested.
- `data-pipeline/src/adapters/pokemoncard-jp/parsers.ts` — small
  helper module: `extractByDtDd`, `extractAttr`,
  `extractTextContent`, `decodeHtmlEntities`,
  `convertJaDateToISO`, `parseRarityGlyph`. Pure utilities.
- `data-pipeline/src/adapters/pokemoncard-jp/api-types.ts` —
  internal TS types for the parsed records (`PokemonCardJpSet`,
  `PokemonCardJpCard`).
- `data-pipeline/src/adapters/pokemoncard-jp/set-aliases.ts` — the
  `pcjpToTcgdexSetCode` lookup + `pokemoncardJpSetToTcgdexJp(header)`
  helper.
- `data-pipeline/src/adapters/pokemoncard-jp/matcher.ts` — the
  `pokemoncardJpToTcgdexJp(card)` matcher; pure, takes a parsed
  `PokemonCardJpCard` and returns the TCGdex JP `cardKey` or
  `null`.
- `data-pipeline/src/adapters/pokemoncard-jp/fixtures/` — captured
  HTML (trimmed of nav/footer chrome to keep size reasonable):
  - `set.sv1s.html` — Triplet Beat expansion landing page.
  - `set.s9.html` — Star Birth expansion landing page.
  - `card.sv1s-198-sar.html` — Special Art Rare card detail.
  - `card.s9-018-sr.html` — Super Rare card detail.
  - `card.s9-001-c.html` — Common card detail.
  - `card.notfound.html` — body returned for an unknown card id.
- `data-pipeline/src/adapters/pokemoncard-jp/transform.test.ts`
  — unit tests over every fixture; round-trip through the zod
  schemas.
- `data-pipeline/src/adapters/pokemoncard-jp/adapter.test.ts` —
  integration tests with `FetchShim` — happy / 404 / 429 / parse
  failure on a body without `<dl class="cardDataDetail">`.
- `data-pipeline/src/adapters/pokemoncard-jp/matcher.test.ts` —
  matcher unit tests including the AC-mandated hand-curated cases.

### Cross-cutting (pre-authorized out-of-scope edits)

- `data-pipeline/src/adapters/index.ts` — uncomment the two
  `// ============================================================
  // === T-DL-SOURCE-TCGDEX-JP === (primary Japanese)
  // ============================================================` exports.
  No other edits to this file.
- `data-pipeline/src/normalize/rarity.ts` — extend the `tcgdex-jp`
  table with the lowercase-`rare` SV-era forms; add a fresh
  `pokemoncard-jp` table with the rows in § "Rarity normalization
  registry" above. The `SourceName` union already lists both source
  names (added in T-DL-SOURCE-INTERFACES).

---

## Acceptance criteria

### TCGdex JP

- [ ] Adapter implements `SourceAdapter`; declares
      `name: 'tcgdex-jp'`, `language: 'jp'`, `tier: 'primary'`.
      (typecheck + an explicit test asserts the values).
- [ ] `createTCGdexJpAdapter` accepts a `RateLimitedClient` (host
      enforced to `api.tcgdex.net`); refuses other hosts via the
      existing host check.
- [ ] `tcgdexJpSetToRaw` covers every documented field in the JP
      Set mapping table; round-trip through `rawSetSchema` for
      every fixture.
- [ ] `tcgdexJpCardToRaw` covers every documented field; round-trip
      through `rawCardSchema` for every fixture.
- [ ] `tcgdexJpCardToPrintings` produces the same per-fixture
      counts as EN's analogue:
  - 2 printings for `s9-001` (Common: NON_HOLO + REVERSE_HOLO).
  - 1 printing classified `HOLO` for `s9-018`.
  - 1 printing classified `FULL_ART` for `sv1s-073` (Art Rare —
    JP-tier alias of Illustration Rare).
  - 1 printing classified `ALT_ART` for `sv1s-198` (Special Art
    Rare).
  - 1 printing classified `GOLD` for `sv1s-108` (Hyper Rare).
  - 1 printing classified `PROMO` for `svp-001`.
- [ ] Adapter integration tests cover happy path, 404, 429 retry,
      malformed JSON, User-Agent header; all pass without live
      network.
- [ ] Resolver-integration test feeds the adapter (via shim) plus
      a fake validation source into `resolveCanonicalSets` /
      `resolveCanonicalCards`; asserts a canonical set with
      `jp-s9` canonical key, `tcgdex-jp` provenance, zero conflicts.
- [ ] Rarity registry has the new TCGdex JP entries + the
      lowercase-`rare` aliases; covered by tests.
- [ ] Variant raw signals (is_holo, is_reverse_holo, is_full_art,
      is_alt_art, is_gold_rare, is_first_edition, is_shadowless,
      is_trainer_gallery, is_promo) populated correctly so
      `classifyVariant` produces the expected `variant_class` for
      every named fixture above.

### Pokemon-Card.com

- [ ] Adapter implements `SourceAdapter`; declares
      `name: 'pokemoncard-jp'`, `language: 'jp'`, `tier: 'filler'`.
- [ ] `createPokemonCardJpAdapter` accepts a `RateLimitedClient`
      (host enforced to `www.pokemon-card.com`); refuses other
      hosts.
- [ ] HTTP rate limit is configured to 1 rps / burst 1 by default
      (covered by a unit test asserting the constants).
- [ ] User-Agent test asserts `binderly-data-pipeline/1.0
      (+https://github.com/pmirandaa/Binderly)` is sent on every
      request when the adapter constructs its own client (i.e.
      via `createPokemonCardJpAdapter` without a pre-built client
      and without `BINDERLY_DATA_PIPELINE_UA` env var).
- [ ] `pokemonCardJpHtmlToSetRaw` parses the `set.sv1s.html` and
      `set.s9.html` fixtures; round-trips through `rawSetSchema`.
- [ ] `pokemonCardJpHtmlToCardRaw` parses every card fixture;
      round-trips through `rawCardSchema`.
- [ ] `pokemonCardJpHtmlToPrintings` emits exactly 1 printing per
      detail page; round-trips through `rawPrintingSchema`.
- [ ] Adapter integration tests cover happy / 404 (Pokemon-Card.com
      "card not found" body returned with HTTP 200) / 429 retry /
      malformed body. All pass without live network.
- [ ] `pokemoncardJpToTcgdexJp` matcher is tested with hand-curated
      cases covering: a modern S9 card (matches), a modern SV1S
      card (matches), a card with a set short-code that has no
      alias entry (returns `null`), a card with mismatched padded
      vs unpadded numbering (matches via `normalizeCardNumberForKey`).
      ≥90% match rate across fixtures (3/3 for the curated cases).
- [ ] Variant raw signals feed `classifyVariant` correctly: AR →
      `FULL_ART`, SAR → `ALT_ART`, HR → `GOLD`, promo → `PROMO`.
- [ ] Rarity registry has the new `pokemoncard-jp` table; covered
      by tests in `data-pipeline/src/adapters/pokemoncard-jp/transform.test.ts`.

### Cross-cutting

- [ ] `pnpm --filter @binderly/data-pipeline build typecheck lint
      format:check test` clean.
- [ ] No file modified outside `data-pipeline/src/adapters/tcgdex-jp/`,
      `data-pipeline/src/adapters/pokemoncard-jp/`,
      `data-pipeline/src/adapters/index.ts` (2-line uncomment), and
      `data-pipeline/src/normalize/rarity.ts` (registry extension +
      new table). All such edits documented in the PR body.

---

## Out of scope

- **Pricing.** TCGdex returns Cardmarket / TCGplayer pricing
  inline; we strip it from card fixtures and ignore in the
  adapter (pricing pipeline owns price observations).
  Pokemon-Card.com does not expose pricing.
- **Image downloads / R2 uploads.** Both adapters store
  `imageSourceUrl` only.
- **Per-set master-set rules.** `master_set_rules` left empty (`{}`)
  on the canonical set; T-DL-MASTER-SET-RULES populates later.
- **Pattern variants on JP-side.** TCGdex JP doesn't surface
  patterns; Pokemon-Card.com surfaces some via separate
  `pcjpCardId`s but we don't classify the variants beyond rarity-
  glyph.
- **Stamps on JP-side.** Pokemon Center / staff / league stamps
  on JP-side are surfaced by Pokemon-Card.com as separate
  `pcjpCardId`s; we record them as separate printings via
  `sourceKey` but we don't decode the stamp axis (filler /
  validation tasks downstream cover this).
- **Texture / textured rares.** Neither source surfaces texture.
- **English localizations.** The JP adapter does not populate
  `nameLocalized.en`; the seed-ingest task joins JP and EN at
  the canonical-card level.
- **EN-only secret-rare numbering on JP fixtures.** SV-era JP
  sets do publish numbers above `printedTotal`, but every observed
  case has an explicit class signal (Special Art Rare / Art Rare /
  Hyper Rare / Super Rare); the rarity-string fallback path
  handles them. We don't ship a JP-fixture exercising the
  "pure-numeric secret rare" branch — it's covered by the EN
  test suite for the shared classifier.

---

## Branch & PR

- Branch: `agent/T-DL-SOURCE-TCGDEX-JP`
- PR title: `T-DL-SOURCE-TCGDEX-JP: TCGdex JP + Pokemon-Card.com adapters`
- Commit format: Conventional Commits.
  - `docs(tasks): elaborate T-DL-SOURCE-TCGDEX-JP`
  - `feat(data-pipeline): TCGdex JP + Pokemon-Card.com adapters (T-DL-SOURCE-TCGDEX-JP)`
    (or split into `feat(data-pipeline): TCGdex JP adapter` +
    `feat(data-pipeline): Pokemon-Card.com adapter`).

---

## Escalation triggers

Stop and append to `open-questions.md` if:

- TCGdex JP response shape **diverges** from EN in a way `RawCard`
  / `RawPrinting` cannot hold (e.g. JP-only Pokemon-Center stamp
  sub-axis surfaces structurally on the JSON). Propose a
  `data-pipeline/src/types.ts` patch first.
- Pokemon-Card.com → TCGdex JP matcher is unreliable on >10% of
  test cases. Flag — the resolver may need a "filler-can-create-
  printings-for-unmatched-cards" mode.
- HTML parsing surface for Pokemon-Card.com is materially larger
  than this elaboration assumes (e.g. JS-rendered content
  behind a `<script type="application/json">`). Propose a split:
  ship TCGdex JP first, defer Pokemon-Card.com to a follow-up.
- TCGdex JP coverage gaps require Pokemon-Card.com to be promoted
  to `tier: 'validation'` (not just `filler`) — propose for
  ratification.
- 5 rps for TCGdex JP turns out wrong (TCGdex publishes a
  different limit, or returns 429s in tests).
- 1 rps for Pokemon-Card.com turns out wrong (the site rate-
  limits more aggressively than we expect, or there are explicit
  ToS limits we missed).

## Notes from execution
_(filled in by the sub-agent at PR time)_
