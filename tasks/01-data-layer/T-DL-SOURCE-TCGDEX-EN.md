# T-DL-SOURCE-TCGDEX-EN — TCGdex EN adapter (primary English source)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** M
**Status:** in_progress

---

## Hard dependencies

- T-DL-SOURCE-INTERFACES (merged @ 51b3727 — provides `SourceAdapter`,
  `RateLimitedClient`, `Raw*` / `Canonical*` types, canonical-key
  helpers, the variant classifier, and the per-source rarity registry).

## Soft dependencies

- None. Sibling adapter tasks (T-DL-SOURCE-PTCGIO,
  T-DL-SOURCE-BULBAPEDIA, T-DL-SOURCE-TCGDEX-JP) integrate after merge;
  they should mirror this adapter's structure and registry pattern.

## Required reading

- `PROJECT.md` § 6 (Data Model), § 7 (Sources & Standardization),
  § 8 (Master Set Definition).
- `rules/01-data-layer.md` — stage rules, esp. the "no raw fetch",
  "central variant classifier", and "idempotent ingestion" hard rules.
- `context/tcg-domain.md` § 1 (variant taxonomy), § 5 (canonical
  keys), § 6 (rarity normalization), § 7 (type normalization),
  § 8 (variant decision tree).
- `context/legal-and-brand.md` § "Data source ToS" — TCGdex requires
  attribution, no published rate limit.
- `context/conventions.md` — TS/eslint/commit conventions.
- `data-pipeline/README.md` § "How to add a new adapter" + § "Where
  rate limits live".
- `data-pipeline/src/types.ts` — `RawSet` / `RawCard` / `RawPrinting`
  zod schemas.
- `data-pipeline/src/interfaces/adapter.ts` — `SourceAdapter`
  interface, `AdapterError` discriminated union.
- `data-pipeline/src/http/rate-limited-client.ts` — required for ALL
  HTTP.
- `data-pipeline/src/canonical-keys.ts` — never hand-compute keys.
- `data-pipeline/src/normalize/rarity.ts` — registry to extend.
- `data-pipeline/src/variant-classify.ts` — consumes raw printing
  signals; the adapter must NOT assign `variant_class`.

## Goal

Ship the first concrete `SourceAdapter` implementation and prove the
@binderly/data-pipeline contract from the consumer side. TCGdex EN is
the **primary** English source per PROJECT.md § 7 (best variant
coverage, free and open API, multilingual, generous quotas). The
adapter pulls sets / cards / printings from
`https://api.tcgdex.net/v2/en/*`, transforms responses into the
shared `Raw*` shapes (no key computation, no variant classification —
those happen downstream), feeds raw printing signals into the
existing variant classifier and resolver, and registers a rarity
mapping table so primary cards normalize to our canonical rarity
enum. The work also surfaces any rough edges in the contract before
the three sibling adapter tasks fan out.

## TCGdex API research notes

### Endpoints we hit (all GET, JSON, no auth)

| Purpose                            | Path                                        | Example                                                                              |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| List all sets (briefs)             | `/v2/en/sets`                               | `https://api.tcgdex.net/v2/en/sets`                                                  |
| Single set with full card list     | `/v2/en/sets/{setId}`                       | `https://api.tcgdex.net/v2/en/sets/swsh9`                                            |
| Single card with full detail       | `/v2/en/cards/{setId}-{localId}`            | `https://api.tcgdex.net/v2/en/cards/swsh9-018`                                       |

The brief response on `/v2/en/sets` (per
`https://www.tcgdex.dev/rest/sets`) lacks `releaseDate` and `serie`,
so we always fetch each `/v2/en/sets/{id}` individually for the full
shape we need. For cards we fetch `/v2/en/cards/{id}` individually
because the card array embedded in `/v2/en/sets/{id}` is the
`CardBrief` shape (id / localId / name / image only).

### Response shapes we depend on

**Set** (`/v2/en/sets/{id}`):

```jsonc
{
  "id": "swsh9",
  "name": "Brilliant Stars",
  "logo": "https://assets.tcgdex.net/en/swsh/swsh9/logo",
  "symbol": "https://assets.tcgdex.net/univ/swsh/swsh9/symbol",
  "cardCount": { "official": 172, "total": 216, "holo": 102, "reverse": 124, "normal": 115, "firstEd": 0 },
  "releaseDate": "2022-02-25",
  "serie": { "id": "swsh", "name": "Sword & Shield" },
  "tcgOnline": "BRS",
  "abbreviation": { "official": "BRS" },
  "legal": { "standard": false, "expanded": true },
  "cards": [ /* CardBrief[] */ ]
}
```

**Card** (`/v2/en/cards/{id}` — Pokémon example):

```jsonc
{
  "category": "Pokemon",
  "id": "swsh9-018",
  "localId": "018",
  "name": "Charizard VSTAR",
  "rarity": "Holo Rare VSTAR",
  "illustrator": "5ban Graphics",
  "image": "https://assets.tcgdex.net/en/swsh/swsh9/018",
  "set": { "id": "swsh9", "name": "Brilliant Stars", "cardCount": { "official": 172, "total": 216 }, "logo": "...", "symbol": "..." },
  "variants": { "firstEdition": false, "holo": true, "normal": false, "reverse": false, "wPromo": false },
  "variants_detailed": [ { "type": "holo", "size": "standard", "variantId": "generated" } ],
  "dexId": [6],
  "hp": 280,
  "types": ["Fire"],
  "evolveFrom": "Charizard V",
  "stage": "VSTAR",
  "suffix": "V",
  "attacks": [ /* … */ ],
  "weaknesses": [ { "type": "Water", "value": "×2" } ],
  "resistances": [ /* optional */ ],
  "retreat": 2,
  "regulationMark": "F",
  "legal": { "standard": false, "expanded": true },
  "updated": "2025-08-16T20:39:55Z",
  "pricing": { /* ignored — pricing pipeline owns this */ }
}
```

For vintage cards (`base1-4` Charizard) `variants_detailed` carries
richer data:

```jsonc
"variants_detailed": [
  { "type": "holo", "subtype": "unlimited", "size": "standard", "variantId": "..." },
  { "type": "holo", "subtype": "shadowless", "size": "standard", "stamp": ["1st-edition"], "variantId": "..." },
  { "type": "holo", "subtype": "shadowless", "size": "standard", "variantId": "..." },
  { "type": "holo", "subtype": "1999-2000-copyright", "size": "standard", "variantId": "..." }
]
```

**Trainer** cards add `effect: string` and `trainerType: string` (Item
/ Supporter / Stadium / Tool / Pokémon Tool). **Energy** cards add
`effect` and `energyType: string` (Basic / Special / Normal — TCGdex
emits `Normal` for the colorless/typed basic energies).

**Promo sets** (e.g. `swshp` "SWSH Black Star Promos") use lettered
`localId`s like `SWSH001`–`SWSH299`; rarity is often `"None"` and
`variants.holo: true`.

**404** body: `{ "type": "https://tcgdex.dev/errors/not-found",
"title": "...", "status": 404, "endpoint": "...", "method": "GET" }` —
the `RateLimitedClient` already maps this to `NotFoundError` based on
HTTP status, so the adapter only needs to special-case it for "set /
card not present in TCGdex EN".

### Rate limit and User-Agent

TCGdex publishes no per-IP rate limit (their site advertises ~10M
requests/month aggregate). Per orchestrator guidance for free TCG
APIs, the adapter is conservative: **5 req/s sustained, burst 10**,
with the existing `RateLimitedClient` defaults (4 retries, 500ms
base × 2^n backoff, 15s timeout, honor `Retry-After`). This is
slightly lower steady-state than the README's 10 req/s suggestion
but matches the orchestrator's task-level instruction; the README
will be aligned if/when other TCGdex-using adapters land.

`User-Agent` follows `data-pipeline/README.md` and the
`RateLimitedClient` contract: every external call must carry a
contactable identifier. The adapter constructs its client with the
default UA `binderly-data-pipeline/1.0
(+https://github.com/binderly/binderly)` (override via the
`BINDERLY_DATA_PIPELINE_UA` env var when one is set, per the existing
`RateLimitedClient` constructor). Per legal-and-brand.md TCGdex's
published policy is "open API, attribution requested" — we attribute
via the in-app About screen elsewhere; the adapter's job is to identify
itself.

### Idempotency posture

Every Raw* the adapter emits derives its `code` / `setCode` /
`number` (and therefore the canonical key downstream) from
**immutable TCGdex identifiers**: `set.id` and `card.localId`. These
two fields are TCGdex's stable IDs across re-fetches; if either ever
changes, downstream `seed-ingest` would silently re-key the row and
duplicate it. The risk is documented here and the adapter logs a
`tcgdex-en.set_id_changed` warning if a future cache layer ever
detects drift; the current implementation does not retain prior
state between runs, so the risk is theoretical and surfaces as a DB
duplicate rather than a silent corruption. Same applies to
`card.localId`.

## Field mapping tables

### TCGdex Set → `RawSet`

| `RawSet` field      | TCGdex source                                                 | Notes                                                              |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `source`            | constant `'tcgdex-en'`                                        | provenance                                                         |
| `sourceKey`         | `set.id`                                                      | adapter's stable per-set key (also used for `listCardsForSet`)     |
| `code`              | `set.id`                                                      | TCGdex IDs are already lowercase (`swsh9`); we standardize on them |
| `language`          | constant `'en'`                                               | adapter is per-language                                            |
| `name`              | `set.name`                                                    |                                                                    |
| `series`            | `set.serie?.name ?? null`                                     |                                                                    |
| `releaseDate`       | `set.releaseDate`                                             | TCGdex emits ISO `yyyy-mm-dd` already                              |
| `printedTotal`      | `set.cardCount?.official ?? null`                             | matches our "numbered, on-card" total                              |
| `total`             | `set.cardCount?.total ?? null`                                | includes secret rares + alt prints                                 |
| `logoUrl`           | `set.logo + '.png'` when present, else `null`                 | TCGdex serves logo without extension; we suffix `.png`             |
| `symbolUrl`         | `set.symbol + '.png'` when present, else `null`               | same convention                                                    |
| `extra.tcgOnline`   | `set.tcgOnline ?? undefined`                                  | preserved for cross-source joins later                             |
| `extra.abbreviation`| `set.abbreviation?.official ?? undefined`                     | preserved for cross-source joins later                             |
| `extra.legal`       | `set.legal ?? undefined`                                      | preserved (format legality)                                        |
| `extra.cardCounts`  | `set.cardCount` (full object)                                 | preserved (drives variant inference)                               |

### TCGdex Card → `RawCard`

| `RawCard` field     | TCGdex source                                                                         | Notes                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `source`            | constant `'tcgdex-en'`                                                                |                                                                        |
| `sourceKey`         | `card.id`                                                                             | e.g. `swsh9-018`                                                       |
| `setCode`           | `card.set.id`                                                                         | parent set's TCGdex ID                                                 |
| `language`          | constant `'en'`                                                                       |                                                                        |
| `number`            | `card.localId`                                                                        | preserved verbatim — `"018"`, `"TG01"`, `"SWSH001"`; canonical-keys.ts pads |
| `name`              | `card.name`                                                                           |                                                                        |
| `nameLocalized`     | `null`                                                                                | TCGdex EN does not return localizations here; the JP adapter fills `jp` |
| `typeRaw`           | `card.types?.[0] ?? null`                                                             | first type; `normalizePokemonType` aliases (`Lightning`, `Metal`, etc.) |
| `subtypeRaw`        | derived: see "subtype derivation" below                                               | normalized via `normalizeCardSubtype`                                  |
| `hp`                | `card.hp ?? null`                                                                     | absent on Trainer / Energy                                             |
| `illustrator`       | `card.illustrator ?? null`                                                            |                                                                        |
| `flavorText`        | `card.description ?? null`                                                            | Pokémon flavor only                                                    |
| `attacks`           | `card.attacks ?? null`                                                                | preserved as-is (resolver's `setEqualityStrategy` consumes)            |
| `weakness`          | `card.weaknesses ?? null`                                                             |                                                                        |
| `resistance`        | `card.resistances ?? null`                                                            | absent on most modern cards                                            |
| `retreatCost`       | `card.retreat ?? null`                                                                |                                                                        |
| `rarityRaw`         | `card.rarity ?? null` (mapped to `null` when string is `'None'`)                      | fed through `normalizeRarity('tcgdex-en', …)` in seed-ingest           |
| `extra.dexId`       | `card.dexId ?? undefined`                                                             |                                                                        |
| `extra.stage`       | `card.stage ?? undefined`                                                             |                                                                        |
| `extra.evolveFrom`  | `card.evolveFrom ?? undefined`                                                        |                                                                        |
| `extra.regulationMark` | `card.regulationMark ?? undefined`                                                 | informs format legality downstream                                     |
| `extra.suffix`      | `card.suffix ?? undefined`                                                            | V / VMAX / VSTAR mech                                                  |
| `extra.legal`       | `card.legal ?? undefined`                                                             |                                                                        |
| `extra.effect`      | `card.effect ?? undefined`                                                            | trainer / energy effect                                                |
| `extra.trainerType` | `card.trainerType ?? undefined`                                                       |                                                                        |
| `extra.energyType`  | `card.energyType ?? undefined`                                                        |                                                                        |
| `extra.imageUrl`    | `card.image + '/high.png'` when present                                               | full-quality URL (TCGdex serves multiple sizes)                        |
| `extra.updated`     | `card.updated ?? undefined`                                                           | ISO timestamp; ignored unless seed-ingest wants it                     |

**Subtype derivation** (single source-of-truth string we feed through
`normalizeCardSubtype`):

- `category === 'Pokemon'` → `'Pokemon'`.
- `category === 'Trainer'` and `trainerType` set → `trainerType`
  verbatim (`'Item'` / `'Supporter'` / `'Stadium'` / `'Tool'` /
  `'Pokémon Tool'`).
- `category === 'Energy'` and `energyType === 'Special'` →
  `'Special Energy'`.
- `category === 'Energy'` and `energyType` is anything else
  (typically `'Normal'` for the per-type basics, but observed
  `'Basic'` on older sets) → `'Basic Energy'`.

These map to our enum via the existing aliases in
`data-pipeline/src/normalize/type.ts` (Pokémon, Item, Supporter,
Stadium, Tool, Pokémon Tool, Basic Energy, Special Energy).

### TCGdex Card → `RawPrinting[]` (one or more per card)

The adapter never assigns `variant_class`. It emits one
`RawPrinting` per **distinct print run** known about the card. The
sources of truth, in order of precedence:

1. **`variants_detailed`** when present (vintage cards expose 1–4
   entries). Each entry yields a printing with raw signals derived
   from `type` / `subtype` / `stamp` (see "variants_detailed
   mapping" below).
2. **`variants` flags** otherwise. Each `true` flag yields a
   printing:
   - `variants.normal === true` → 1 non-holo printing.
   - `variants.reverse === true` → 1 reverse-holo printing.
   - `variants.holo === true` AND no `variants.normal/reverse` →
     1 holo printing.
   - When `variants.holo === true` AND `variants.normal/reverse`
     are also true (rare; an unusual Pokémon in a modern set), we
     emit non-holo + reverse-holo + holo as three printings.
3. **Rarity-string fallback.** SV-era special rares (Illustration
   Rare, Special Illustration Rare, Hyper Rare, Ultra Rare) and
   secret rares above `printed_total` arrive with all three
   `variants.*` booleans `false`. We then emit **one** printing
   with raw signals derived from the rarity string and the card's
   numbered position in the set (the variant classifier handles
   class assignment via `isFullArt`/`isAltArt`/`isGoldRare`/
   `isHolo` and the `number > printed_total` check).
4. **Promo set fallback.** When the parent set's id ends in `'p'`
   (`basep`, `swshp`, `xyp`, …) we mark every printing
   `isPromo: true`. The variant classifier then picks `PROMO`.

Per-printing raw signals:

| `RawPrinting` field     | Source                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `source`                | `'tcgdex-en'`                                                                                                            |
| `sourceKey`             | `card.id + '-' + variantTag` (e.g. `swsh9-018-holo`, `base1-4-holo-shadowless-1stedition`); deterministic, idempotent    |
| `cardKey`               | `card.id` (the adapter's card key — resolver / classifier consume this; canonical card key is built downstream)          |
| `sourcePrintingLabel`   | human-readable form of the variant for ops debugging (`'Holo'`, `'Reverse Holo'`, `'1st Edition Shadowless Holo'`, …)    |
| `rarityRaw`             | parent card's `rarity` (same string that lands on `RawCard.rarityRaw`; here for fast variant-key dedupe upstream)        |
| `isHolo`                | `true` when print run is the holo print (`variants.holo` true, or `variants_detailed[i].type === 'holo'`, or rarity is "Holo Rare"+) |
| `isReverseHolo`         | `true` when print run is reverse holo                                                                                    |
| `isFirstEdition`        | `true` when `variants_detailed[i].stamp` includes `'1st-edition'` OR (`variants.firstEdition === true` and run is a 1st Ed run) |
| `isShadowless`          | `true` when `variants_detailed[i].subtype === 'shadowless'`                                                              |
| `isFullArt`             | `true` when rarity is `'Illustration rare'` (any case)                                                                   |
| `isAltArt`              | `true` when rarity is `'Special illustration rare'` (any case)                                                           |
| `isGoldRare`            | `true` when rarity is `'Hyper rare'` / `'Hyper Rare'`                                                                    |
| `isRainbowRare`         | `true` when rarity is `'Rainbow Rare'` / `'Rare Rainbow'`                                                                |
| `isTextured`            | `false` (TCGdex EN does not surface texture)                                                                             |
| `isTrainerGallery`      | `true` when `card.localId` matches `/^(TG|GG)\d+$/i`                                                                     |
| `isPromo`               | `true` when parent set is a promo set (id ends in `p`); the classifier may also infer from `variants.wPromo`             |
| `isError`               | `false` (TCGdex EN does not flag known print errors)                                                                     |
| `pattern`               | `null` (TCGdex EN does not surface Cosmos / Galaxy / Poké Ball / Master Ball reverse-holo patterns; ptcgio supplements)  |
| `stamp`                 | `null` for non-1st-Ed stamps; 1st-Edition is a flag on the printing, not a stamp enum                                    |
| `imageSourceUrl`        | `card.image + '/high.png'` (the TCGdex hero image) when present, else `null`                                             |
| `extra.tcgdexVariantId` | the `variants_detailed[i].variantId` string when present (lets us re-key the same printing on re-fetch)                  |
| `extra.size`            | `variants_detailed[i].size` when present                                                                                 |
| `extra.subtypeTag`      | `variants_detailed[i].subtype` when present                                                                              |

#### `variants_detailed` mapping (vintage)

For each `entry` in `variants_detailed`:

- `entry.type === 'normal'` → non-holo printing.
- `entry.type === 'reverse'` → reverse-holo printing.
- `entry.type === 'holo'` → holo printing.
- `entry.subtype === 'shadowless'` → set `isShadowless: true`.
- `entry.subtype === 'unlimited'` → set `extra.isUnlimited: true`
  (variant-classify reads `extra.isUnlimited === true` for the
  `UNLIMITED` flag).
- `entry.subtype === '1999-2000-copyright'` → not a flag we track;
  preserved in `extra.subtypeTag`.
- `entry.stamp` includes `'1st-edition'` → set
  `isFirstEdition: true`.

The variant classifier (already implemented and tested in
T-DL-SOURCE-INTERFACES) consumes these signals and produces the
final `variant_class` / `variant_flags` / `variant_code`.

## Rarity normalization registry (additions)

The registry already ships with a TCGdex EN table seeded in
T-DL-SOURCE-INTERFACES. The cases below are observed in live TCGdex
data and need to be added (case-insensitive lookup is already
supported; only the new key forms / tiers are added):

| TCGdex string                | Canonical                           | Reason                                                                                              |
| ---------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Holo Rare V`                | `ULTRA_RARE`                        | TCGdex word order varies; existing registry has `Rare Holo V`. Mirror.                              |
| `Holo Rare VMAX`             | `ULTRA_RARE`                        |                                                                                                     |
| `Holo Rare VSTAR`            | `ULTRA_RARE`                        |                                                                                                     |
| `Holo Rare GX`               | `ULTRA_RARE`                        |                                                                                                     |
| `Holo Rare EX`               | `ULTRA_RARE`                        |                                                                                                     |
| `Holo Rare LV.X`             | `ULTRA_RARE`                        |                                                                                                     |
| `Hyper rare`                 | `HYPER_RARE`                        | TCGdex SV-era uses lowercase `'rare'`; existing `Hyper Rare` covers via case-insensitive fallback   |
| `Illustration rare`          | `ILLUSTRATION_RARE`                 | covered by case-insensitive fallback against existing `Illustration Rare`; explicit add for clarity |
| `Special illustration rare`  | `SPECIAL_ILLUSTRATION_RARE`         | same                                                                                                |
| `None`                       | _not registered_ — adapter coerces to `null` when emitting `RawCard.rarityRaw` | the lone "None" rarity appears on promo cards; we keep `rarityRaw=null` and let `isPromo` carry the signal |

Promo and rarity-less promo cards: when the parent set is a promo
set, the adapter sets `rarityRaw: null` whenever TCGdex emits
`'None'` and falls back to the `isPromo` printing flag for
classification.

## Deliverables

- `data-pipeline/src/adapters/tcgdex-en/index.ts` — public barrel:
  exports a `createTCGdexEnAdapter` factory and the `TCGdexEnAdapter`
  class.
- `data-pipeline/src/adapters/tcgdex-en/adapter.ts` — class that
  implements `SourceAdapter`. Constructor accepts an `AdapterContext`
  + `{ http: RateLimitedClient, baseUrl?: string }`. The default
  base URL is `https://api.tcgdex.net`. Methods: `listSets()`,
  `listCardsForSet(setKey)`, `listPrintingsForCard(cardKey)`. Maps
  TCGdex `NotFoundError` to "no data" semantics (returns `[]` for
  list-shaped methods rather than throwing) and surfaces other
  `AdapterError`s untouched.
- `data-pipeline/src/adapters/tcgdex-en/transform.ts` — pure
  transform functions: `tcgdexSetToRaw`, `tcgdexCardToRaw`,
  `tcgdexCardToPrintings`. Zero side effects, no HTTP, no globals
  beyond pure helpers; unit-tested with fixture JSON.
- `data-pipeline/src/adapters/tcgdex-en/api-types.ts` — TypeScript
  types describing the TCGdex response shapes the adapter consumes.
  Lenient (permissive optionals) — TCGdex evolves their schema and
  we tolerate extras.
- `data-pipeline/src/adapters/tcgdex-en/promo-sets.ts` — small const
  + helper `isTcgdexPromoSet(setId)`; the promo-detection rule lives
  here so the JP adapter can reuse it.
- `data-pipeline/src/adapters/tcgdex-en/fixtures/` — captured JSON
  responses:
  - `set.swsh9.json` — Brilliant Stars (modern, Trainer Gallery
    sub-set, secret rares).
  - `set.base1.json` — Base Set (vintage; Charizard 1st Edition /
    Shadowless / Unlimited).
  - `set.sv01.json` — Scarlet & Violet (SV-era; Illustration Rare,
    Special Illustration Rare, Hyper Rare, Ultra Rare).
  - `set.swshp.json` — SWSH Black Star Promos.
  - `card.swsh9-001.json` — Common w/ normal+reverse.
  - `card.swsh9-018.json` — Holo Rare VSTAR.
  - `card.swsh9-153.json` — Ultra Rare Charizard V (alt printing).
  - `card.swsh9-174.json` — Secret Rare (number > printed_total).
  - `card.swsh9-TG03.json` — Trainer Gallery.
  - `card.base1-4.json` — Charizard, 4 vintage variants.
  - `card.sv01-199.json` — Illustration Rare.
  - `card.sv01-245.json` — Special Illustration Rare.
  - `card.sv01-258.json` — Hyper Rare basic energy.
  - `card.swshp-SWSH001.json` — Promo, rarity "None".
- `data-pipeline/src/adapters/tcgdex-en/transform.test.ts` — unit
  tests over every fixture; assert produced `Raw{Set,Card,Printing}`
  shapes, including round-trip through the zod schemas.
- `data-pipeline/src/adapters/tcgdex-en/adapter.test.ts` —
  integration tests using a `fetchImpl` shim (same pattern as
  `rate-limited-client.test.ts`) — happy path, 404, 429 retry,
  malformed JSON.
- `data-pipeline/src/adapters/tcgdex-en/resolver-integration.test.ts`
  — wires the adapter (with shim) into `resolveCanonicalSets` /
  `resolveCanonicalCards` alongside a fake validation source; assert
  the canonical output matches expected (provenance-tagged, primary's
  values retained).
- `data-pipeline/src/adapters/index.ts` — top-level barrel that
  re-exports `tcgdex-en` (and will collect the sibling adapters as
  they land).
- `data-pipeline/src/normalize/rarity.ts` — extend the TCGdex EN
  table with the rows in "Rarity normalization registry (additions)"
  above.

## Acceptance criteria

- [ ] Adapter implements `SourceAdapter`; declares `name: 'tcgdex-en'`,
      `language: 'en'`, `tier: 'primary'`. (typecheck + an explicit
      test asserts the values).
- [ ] `createTCGdexEnAdapter` accepts a `RateLimitedClient` (host
      enforced to `api.tcgdex.net`); refuses other hosts via the
      existing `RateLimitedClient` host check.
- [ ] `tcgdexSetToRaw` covers every documented field in the Set
      mapping table; round-trip through `rawSetSchema` for every
      fixture set.
- [ ] `tcgdexCardToRaw` covers every documented field in the Card
      mapping table; round-trip through `rawCardSchema` for every
      fixture card.
- [ ] `tcgdexCardToPrintings` produces:
  - 2 printings for `swsh9-001` (Common: NON_HOLO + REVERSE_HOLO
    after classification).
  - 1 printing classified `HOLO` for `swsh9-018` (Charizard VSTAR,
    `Holo Rare VSTAR`, `holo: true`).
  - 1 printing classified `SECRET_RARE` for `swsh9-174` (number 174
    > printed_total 172, no other class signal).
  - 1 printing classified `TRAINER_GALLERY` for `swsh9-TG03` (TG
    prefix).
  - 4 printings for `base1-4` (Charizard) covering Holo Unlimited,
    Holo Shadowless 1st Edition, Holo Shadowless, and Holo Vintage
    Copyright; classified `HOLO` w/ flags including
    `FIRST_EDITION` + `SHADOWLESS` and `SHADOWLESS` alone.
  - 1 printing classified `FULL_ART` for `sv01-199` (Illustration
    Rare).
  - 1 printing classified `ALT_ART` for `sv01-245` (Special
    Illustration Rare).
  - 1 printing classified `GOLD` for `sv01-258` (Hyper Rare).
  - 1 printing classified `PROMO` for `swshp-SWSH001`.
- [ ] Adapter integration tests cover happy path, 404, 429 retry,
      malformed JSON; all pass without live network.
- [ ] Resolver-integration test feeds the adapter (via shim) plus a
      fake validation source into `resolveCanonicalSets` and
      `resolveCanonicalCards`; asserts a primary canonical set with
      `tcgdex-en` provenance and zero conflicts.
- [ ] Rarity registry has the new TCGdex EN entries from the table
      above; covered by tests in `data-pipeline/src/normalize/rarity.test.ts`
      OR a new test in the adapter folder (whichever is closest to
      the data).
- [ ] Variant raw signals (is_holo, is_reverse_holo, is_full_art,
      is_alt_art, is_gold_rare, is_first_edition, is_shadowless,
      is_trainer_gallery, is_promo) populated correctly so
      `classifyVariant` produces the expected variant_class for
      every named fixture above.
- [ ] `pnpm --filter @binderly/data-pipeline build typecheck lint
      format:check test` clean.
- [ ] No file modified outside `data-pipeline/src/adapters/tcgdex-en/`,
      `data-pipeline/src/adapters/index.ts`, and
      `data-pipeline/src/normalize/rarity.ts` (the registry
      extension is in scope per the task instructions).

## Out of scope

- Pricing ingestion: TCGdex returns Cardmarket / TCGplayer pricing
  inline on `/v2/en/cards/{id}`. The adapter ignores it. The
  pricing pipeline (`T-DL-PRICING-AGGREGATOR`, distinct phase)
  owns price observations.
- Image downloads / R2 uploads: the adapter only stores
  `imageSourceUrl`. The image pipeline (`T-DL-IMAGE-PIPELINE`)
  owns rehosting.
- Per-set master-set rules: `master_set_rules` is left empty (`{}`)
  on the canonical set; the master-set rules engine
  (`T-DL-MASTER-SET-RULES`) populates it later.
- Pattern variants (Cosmos / Galaxy / Poké Ball / Master Ball
  reverse-holos): TCGdex EN does not surface these. They will be
  recovered from ptcgio in `T-DL-SOURCE-PTCGIO` (validation tier),
  which has explicit `subtypes` like `Pokeball` / `Masterball`.
- Stamps (prerelease / staff / league / build-and-battle /
  championship): TCGdex EN does not surface these except for
  `'1st-edition'` (treated as a flag, not the `stamp` enum). Filler
  / validation tiers cover these.
- Texture variant detection: TCGdex EN does not surface this.
- Localizations on EN cards: out of scope for the EN adapter; the
  JP adapter populates `nameLocalized.jp` separately.

## Branch & PR

- Branch: `agent/T-DL-SOURCE-TCGDEX-EN`
- PR title: `T-DL-SOURCE-TCGDEX-EN: TCGdex EN adapter (primary English source)`
- Commit format: Conventional Commits.
  - `docs(tasks): elaborate T-DL-SOURCE-TCGDEX-EN`
  - `feat(data-pipeline): TCGdex EN adapter (T-DL-SOURCE-TCGDEX-EN)`
  - (split logically if a fixture or registry-only diff is large)

## Escalation triggers

Stop and append to `open-questions.md` if:

- TCGdex EN response shape differs significantly from the field
  mapping tables above and `RawSet` / `RawCard` / `RawPrinting` cannot
  hold the new shape — propose a `data-pipeline/src/types.ts` patch
  before implementing.
- A field needed by the canonical schema in
  `packages/db/src/schema/{sets,cards,printings}.ts` is missing from
  TCGdex EN and **no** filler/validation source plausibly carries it
  — flag for ratification.
- A § 3 variant edge case (Trainer Gallery, Pattern Variant, Vintage
  prerelease stamp, etc.) is unrepresentable from TCGdex EN raw
  signals — propose a `tcg-domain.md` § 8 patch.
- 5 req/s sustained turns out to be wrong (TCGdex publishes a higher
  or lower documented limit, or returns 429s in tests) — adjust with
  a one-line PR-body justification before implementation.

## Notes from execution

- **Idempotent variant tags.** `RawPrinting.sourceKey` is built as
  `card.id + '-' + variantTag`, where `variantTag` encodes the
  visible axis + flags (e.g. `swsh9-001-normal`,
  `swsh9-001-reverse`, `base1-4-holo-shadowless-1stedition`,
  `base1-4-holo-shadowless`, `base1-4-holo-unlimited`). This
  guarantees the same physical printing produces the same source
  key on every re-fetch, which the seed-ingest task relies on for
  upserts.
- **`variants_detailed` semantics.** TCGdex uses `subtype` to mean
  three things — vintage subset (`shadowless`, `unlimited`,
  `1999-2000-copyright`), pattern (none observed in our captures),
  and other. We special-case `shadowless` / `unlimited`; everything
  else falls through into `RawPrinting.extra.subtypeTag` for the
  filler / validation tier sources to refine.
- **SV-era special rares are derived from rarity.** TCGdex returns
  `variants.holo: false` (and no `variants_detailed`) for
  Illustration / Special Illustration / Hyper / Rare Rainbow. The
  adapter maps the rarity string to `isFullArt` /
  `isAltArt` / `isGoldRare` / `isRainbowRare` so the variant
  classifier still picks the right class. Documented as branch 3 of
  `tcgdexCardToPrintings`.
- **Promo set rule lives in `promo-sets.ts`.** Suffix-`p` regex
  matches every era's Black Star set we've observed (`basep`,
  `swshp`, `xyp`, `swp`, `wp`). The rule is exported so the JP
  adapter can reuse it.
- **Logo / symbol URLs need an explicit extension.** TCGdex serves
  assets without the `.png` suffix; the `RawSet.logoUrl` /
  `symbolUrl` zod schemas require fully-qualified URLs, so the
  transform appends `.png`. The image pipeline downstream is free
  to choose `.webp` instead — it owns rehosting and format
  selection.
- **Rate-limit floor 5 rps / burst 10.** Picked the more
  conservative orchestrator-stated floor over the README's 10 rps /
  burst 5 because TCGdex doesn't publish a per-IP limit and the
  orchestrator's task instructions take precedence. The README's
  general guidance line will be reconciled with the next
  data-pipeline-wide rate-limit pass.
- **Trainer cards in fixtures.** The `swsh9-150` Ultra Ball /
  `swsh9-147` Professor's Research / `swsh9-151` Double Turbo
  cards live inside the swsh9 set fixture but were not captured as
  individual card fixtures. The `Trainer card with trainerType`
  test synthesizes a Trainer payload from a Pokémon fixture so the
  test stays small and deterministic. The "Energy" path uses the
  real `sv01-258` Hyper-Rare basic energy fixture.
- **`pricing` stripped from card fixtures.** TCGdex returns daily-
  changing Cardmarket / TCGplayer figures inline. The adapter
  ignores them entirely (pricing pipeline owns price data); we
  trim `pricing` from the captured fixtures so re-captures don't
  drift the diff.
- **Touched files outside `owns_paths`.** Per the task brief and
  the registry-extension carve-out: `data-pipeline/src/normalize/rarity.ts`
  (added the `Holo Rare V[MAX|STAR|EX|GX|LV.X]`, lowercase-`rare`
  illustration / hyper variants), and `data-pipeline/src/index.ts`
  (re-exports the new `adapters/` barrel). Both are documented in
  the PR body.
- **Test counts.** 199 / 199 passing across 12 test files: 22
  transform tests, 19 adapter tests, 4 resolver-integration tests
  inside this task; 154 pre-existing tests untouched.
