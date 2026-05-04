# T-DL-SOURCE-PTCGIO — pokemontcg.io adapter (validation source for English)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** M
**Status:** in_progress

---

## Hard dependencies

- T-DL-SOURCE-INTERFACES (merged @ 51b3727 — provides `SourceAdapter`,
  `RateLimitedClient`, `Raw*` / `Canonical*` types, canonical-key
  helpers, the variant classifier, and the per-source rarity
  registry).
- T-DL-SOURCE-TCGDEX-EN (merged @ 1a741ab — established the canonical
  adapter playbook; `data-pipeline/src/adapters/index.ts` barrel is
  pre-staged with section headers we uncomment our line under).

## Soft dependencies

- None. Sibling adapter tasks (T-DL-SOURCE-BULBAPEDIA,
  T-DL-SOURCE-TCGDEX-JP) integrate after merge; they should mirror this
  adapter's structure plus the TCGDEX-EN reference layout.

## Required reading

- `PROJECT.md` § 6 (Data Model), § 7 (Sources & Standardization)
  — lists pokemontcg.io as the **validation** source for English.
- `rules/01-data-layer.md` — stage rules, esp. the "no raw fetch",
  "central variant classifier", and "idempotent ingestion" hard rules.
- `context/tcg-domain.md` § 1 (variant taxonomy), § 5 (canonical
  keys), § 6 (rarity normalization), § 7 (type normalization),
  § 8 (variant decision tree).
- `context/legal-and-brand.md` § "Data source ToS" — pokemontcg.io
  free tier requires API key; ToS permits commercial use; attribution
  recommended.
- `context/conventions.md` — TS/eslint/commit conventions.
- `data-pipeline/README.md` § "How to add a new adapter" + § "Where
  rate limits live".
- `data-pipeline/src/types.ts` — `RawSet` / `RawCard` / `RawPrinting`
  zod schemas (round-tripped by transform tests).
- `data-pipeline/src/interfaces/adapter.ts` — `SourceAdapter`
  interface, `AdapterError` discriminated union.
- `data-pipeline/src/http/rate-limited-client.ts` — required for ALL
  HTTP.
- `data-pipeline/src/canonical-keys.ts` — never hand-compute keys;
  the resolver applies these to align ptcgio records with tcgdex-en.
- `data-pipeline/src/normalize/rarity.ts` — `'ptcgio'` rarity table
  is already seeded by T-DL-SOURCE-INTERFACES; this task verifies it
  covers the observed PTCGIO vocabulary and extends if needed.
- `data-pipeline/src/variant-classify.ts` — consumes raw printing
  signals; the adapter must NOT assign `variant_class`.
- `data-pipeline/src/adapters/tcgdex-en/` — **canonical reference
  implementation** (PR #23, `1a741ab`). Mirror its folder layout,
  testing pattern (`FetchShim`), and the exposed `index.ts`/`adapter.ts`/
  `transform.ts`/`api-types.ts`/`fixtures/` split.

## Goal

Ship the **validation-tier** English source adapter for the resolver.
pokemontcg.io (PTCGIO) is the second source the resolver pulls for every
English set/card/printing; agreement with TCGdex-EN's primary tier
becomes provenance metadata, disagreement becomes a `DataConflict` for
ops review (with the primary's value retained as the working value per
`rules/01-data-layer.md`). PTCGIO has narrower variant coverage than
TCGdex (no Trainer Gallery sub-sets, no `variants_detailed`, vintage
prints collapsed under one card id) but supplies a
high-quality independent rarity / illustrator / HP / attacks / set
metadata signal. The adapter pulls sets / cards from
`https://api.pokemontcg.io/v2/*`, transforms responses into the shared
`Raw*` shapes (no key computation, no variant classification — those
happen downstream), feeds raw printing signals derived from
`tcgplayer.prices` keys + the rarity string into the variant
classifier, and exercises the registered ptcgio rarity table.

## PTCGIO API research notes

### Endpoints we hit (all GET, JSON)

| Purpose                         | Path                                             | Example                                                          |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| List all sets (paginated)       | `/v2/sets?page={n}&pageSize=250`                 | `https://api.pokemontcg.io/v2/sets?page=1&pageSize=250`          |
| Single set (full set object)    | `/v2/sets/{setId}`                               | `https://api.pokemontcg.io/v2/sets/swsh9`                        |
| Cards by set (paginated)        | `/v2/cards?q=set.id:{setId}&page={n}&pageSize=250` | `https://api.pokemontcg.io/v2/cards?q=set.id:swsh9&pageSize=250` |
| Single card with full detail   | `/v2/cards/{cardId}`                             | `https://api.pokemontcg.io/v2/cards/swsh9-18`                    |

All responses are wrapped in `{ "data": <payload>, "page": n,
"pageSize": n, "count": n, "totalCount": n }` for list endpoints and
`{ "data": {...} }` for single-resource endpoints. The adapter strips
the `data` envelope and returns the inner payload.

PTCGIO's `/v2/sets/{id}` does NOT embed cards (unlike TCGdex). To list
cards in a set we paginate `/v2/cards?q=set.id:{id}` (Lucene-like
`q=` syntax, max `pageSize=250` per the docs). The `count`/
`totalCount` fields drive pagination.

PTCGIO uses unpadded numbers in its IDs: `swsh9-18` (not `swsh9-018`).
TCGdex uses padded `swsh9-018`. Source IDs are NOT canonical; the
resolver realigns ptcgio + tcgdex-en records via
`canonical-keys.ts`'s `normalizeCardNumberForKey` (zero-pads numeric
numbers to 3, preserves lettered numbers verbatim) so both sides
converge on `en-swsh9-018`. The adapter therefore preserves PTCGIO's
unpadded `number` verbatim on `RawCard.number`.

### Response shapes we depend on

**Set** (`/v2/sets/{id}`):

```jsonc
{
  "data": {
    "id": "swsh9",
    "name": "Brilliant Stars",
    "series": "Sword & Shield",
    "printedTotal": 172,
    "total": 186,                                  // PTCGIO under-counts vs TCGdex (216) — no Trainer Gallery
    "legalities": { "unlimited": "Legal", "standard": "Legal", "expanded": "Legal" },
    "ptcgoCode": "BRS",
    "releaseDate": "2022/02/25",                   // yyyy/mm/dd — adapter normalizes to ISO yyyy-mm-dd
    "updatedAt": "2022/02/23 09:45:00",
    "images": {
      "symbol": "https://images.pokemontcg.io/swsh9/symbol.png",
      "logo":   "https://images.pokemontcg.io/swsh9/logo.png"
    }
  }
}
```

**Card** (`/v2/cards/{id}` — Pokémon example, swsh9-18 Charizard VSTAR):

```jsonc
{
  "data": {
    "id": "swsh9-18",
    "name": "Charizard VSTAR",
    "supertype": "Pokémon",
    "subtypes": ["VSTAR"],
    "hp": "280",                                   // string — adapter parses to number
    "types": ["Fire"],
    "evolvesFrom": "Charizard V",
    "rules": ["VSTAR rule: ..."],
    "attacks": [ /* ... */ ],
    "weaknesses": [ { "type": "Water", "value": "×2" } ],
    "resistances": [ /* optional */ ],
    "retreatCost": ["Colorless", "Colorless"],     // length is the converted retreat cost
    "convertedRetreatCost": 2,
    "set": { /* embedded set object */ },
    "number": "18",                                // unpadded
    "artist": "5ban Graphics",
    "rarity": "Rare Holo VSTAR",
    "nationalPokedexNumbers": [6],
    "regulationMark": "F",
    "images": {
      "small": "https://images.pokemontcg.io/swsh9/18.png",
      "large": "https://images.pokemontcg.io/swsh9/18_hires.png"
    },
    "tcgplayer": { /* see "Variant signals" below */ },
    "cardmarket": { /* volatile pricing — STRIPPED in fixtures */ }
  }
}
```

**Trainer** cards have `supertype: "Trainer"` and `subtypes` like
`["Item"]`, `["Supporter"]`, `["Stadium"]`, `["Pokémon Tool"]`. They
carry `rules` (the effect text). **Energy** cards have
`supertype: "Energy"` and `subtypes` like `["Basic"]` or `["Special"]`.

**Promo cards** (e.g. `swshp-SWSH001`): rarity is `"Promo"`, the
parent set's id ends in `p` (`swshp`, `xyp`, `dpp`), and the
`tcgplayer.prices` map carries a single `holofoil` entry.

**404** body: `{ "error": { "message": "...", "code": 404 } }`. The
`RateLimitedClient` already maps `status === 404` to `NotFoundError`
based on HTTP status, so the adapter only needs to special-case it
for "set / card not present in PTCGIO".

### Variant signals — `tcgplayer.prices` keys + rarity overlay

PTCGIO has no `variants` / `variants_detailed` field. The strongest
signal for which print runs exist is the **set of keys** under
`tcgplayer.prices`. Per the official docs
(https://docs.pokemontcg.io/api-reference/cards/card-object), the
five documented keys are:

| Key                      | Print run               | Adapter signal                              |
| ------------------------ | ----------------------- | ------------------------------------------- |
| `normal`                 | Non-holo                | `isHolo: false`, `isReverseHolo: false`     |
| `holofoil`               | Holo                    | `isHolo: true`                              |
| `reverseHolofoil`        | Reverse holo            | `isReverseHolo: true`                       |
| `1stEditionNormal`       | 1st-Edition non-holo    | `isHolo: false`, `isFirstEdition: true`     |
| `1stEditionHolofoil`     | 1st-Edition holo        | `isHolo: true`,  `isFirstEdition: true`     |

The adapter is tolerant of any additional keys PTCGIO may add later
(unknown keys fall through to the rarity-string fallback path with a
`ptcgio.unknown_price_key` warn-level log). The **values** under each
key (low / mid / high / market) are volatile pricing — STRIPPED from
fixtures so re-captures don't drift the diff. The adapter only reads
the **key set**, never the values. (Pricing ingestion is a separate
pipeline; see `T-DL-PRICING-AGGREGATOR`.)

**Rarity string overlay.** Whatever print runs Branch 1 produces, the
adapter then *overlays* class signals derived from the rarity string
on every emitted printing:

| PTCGIO `rarity`              | Overlay signal                  |
| ---------------------------- | ------------------------------- |
| `Illustration Rare`          | `isFullArt: true`               |
| `Special Illustration Rare`  | `isAltArt: true`                |
| `Hyper Rare`                 | `isGoldRare: true`              |
| `Rare Rainbow`               | `isRainbowRare: true`           |
| `Trainer Gallery Rare Holo`  | `isTrainerGallery: true`        |
| `Promo`                      | `isPromo: true`                 |
| (anything else)              | (no overlay — class falls       |
|                              |  through to base axis or to     |
|                              |  the secret-rare-by-numbering   |
|                              |  rule in the classifier)        |

Note that PTCGIO uses `Rare Holo VSTAR` etc. (similar to TCGdex's
`Holo Rare VSTAR` modulo word order) for ULTRA_RARE-tier cards. These
DO NOT need a class overlay — the variant classifier picks `HOLO` from
the `holofoil` price key, and the rarity normalization registry
handles `Rare Holo VSTAR → ULTRA_RARE` independently.

### Resolution order for `RawPrinting[]`

```
1. tcgplayer.prices keys present → emit one printing per key.
2. No tcgplayer.prices → rarity-string fallback:
     - Common / Uncommon / Rare / Rare Holo (anything ULTRA_RARE-tier
       or below) → emit ONE printing with isHolo derived from rarity
       (`Rare Holo*` / `Rare Ultra` / etc. → isHolo: true; else
       isHolo: false).
     - Special-class rarities (Illustration / Special Illustration /
       Hyper / Rainbow / Trainer Gallery / Promo) → emit ONE printing
       with the matching overlay signal AND isHolo: true (these are
       all visually holographic).
3. Promo-set fallback. When the parent set is a known promo set
   (id ends in `p`) and Branches 1+2 both produced nothing, emit one
   printing with `isPromo: true`.
```

The classifier (`data-pipeline/src/variant-classify.ts`) consumes the
emitted signals and produces the final `variant_class` /
`variant_flags` / `variant_code`. The adapter never assigns class.

### Rate limit and User-Agent

PTCGIO publishes (https://docs.pokemontcg.io/getting-started/rate-limits):

- **Without API key:** 1000 req/day, max 30 req/minute (≈ 0.5 rps).
- **With API key (`X-Api-Key` header):** 20,000 req/day; no
  per-minute cap published — practical observed limit ~hundreds rps.

The adapter uses the same conservative 5 rps sustained / burst 10 floor
as TCGDEX-EN (matches the orchestrator's free-API floor instruction).
This stays well below the with-key budget; in keyless dev mode we'll
hit the 30 rpm cap on long pulls (documented; the production seed-
ingest is expected to run with a key).

`X-Api-Key` is read from `BINDERLY_PTCGIO_API_KEY` (env var) at
adapter-construction time, OR passed explicitly via the constructor
override. When unset, the adapter omits the header (keyless mode for
local dev / CI smoke tests).

`User-Agent` follows the same contract as TCGDEX-EN: every external
call carries a contactable identifier. Default value
`binderly-data-pipeline/1.0
(+https://github.com/pmirandaa/Binderly)` (override via the
`BINDERLY_DATA_PIPELINE_UA` env var per the existing
`RateLimitedClient` constructor). Per legal-and-brand.md PTCGIO's
attribution is "recommended" — we attribute via the in-app About
screen elsewhere; the adapter's job is to identify itself.

### Idempotency posture

Every Raw* the adapter emits derives its `code` / `setCode` /
`number` (and therefore the canonical key downstream) from
**immutable PTCGIO identifiers**: `set.id` and `card.number`. Both
are stable across PTCGIO refreshes (the dataset is community-
maintained but IDs are append-only in practice). If either ever
changes, downstream `seed-ingest` would silently re-key the row and
duplicate it — same risk profile as TCGDEX-EN, mitigated the same way:
log a `ptcgio.set_id_changed` warn if a future cache layer detects
drift; the current implementation has no inter-run state so the risk
is theoretical and surfaces as a DB duplicate rather than silent
corruption.

`RawPrinting.sourceKey = card.id + '-' + variantTag` — same shape as
TCGDEX-EN, so the seed-ingest's upsert path treats both adapters
identically. `variantTag` encodes the visible axis + flags
(`swsh9-1-normal`, `swsh9-1-reverse`, `swsh9-18-holo`,
`base1-4-holo-1stedition`).

## Field mapping tables

### PTCGIO Set → `RawSet`

| `RawSet` field         | PTCGIO source                                                | Notes                                                                       |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `source`               | constant `'ptcgio'`                                          | provenance                                                                  |
| `sourceKey`            | `set.id`                                                     | adapter's stable per-set key                                                |
| `code`                 | `set.id`                                                     | PTCGIO IDs are already lowercase (`swsh9`, `base1`)                         |
| `language`             | constant `'en'`                                              | adapter is per-language                                                     |
| `name`                 | `set.name`                                                   |                                                                             |
| `series`               | `set.series ?? null`                                         | PTCGIO emits `Sword & Shield` / `Base` / `Scarlet & Violet` / etc.          |
| `releaseDate`          | `normalizePtcgioDate(set.releaseDate)`                       | converts `yyyy/mm/dd` → ISO `yyyy-mm-dd`                                    |
| `printedTotal`         | `set.printedTotal ?? null`                                   | matches our "numbered, on-card" total                                       |
| `total`                | `set.total ?? null`                                          | includes secret rares + alt prints (PTCGIO often under-counts vs TCGdex)    |
| `logoUrl`              | `set.images?.logo ?? null`                                   | PTCGIO serves with `.png` extension; pass through                           |
| `symbolUrl`            | `set.images?.symbol ?? null`                                 | same                                                                        |
| `extra.ptcgoCode`      | `set.ptcgoCode ?? undefined`                                 | preserved for cross-source joins (TCGdex emits `tcgOnline` for the same)    |
| `extra.legalities`     | `set.legalities ?? undefined`                                | preserved (format legality)                                                 |
| `extra.updatedAt`      | `set.updatedAt ?? undefined`                                 | preserved; ignored unless seed-ingest wants it                              |

### PTCGIO Card → `RawCard`

| `RawCard` field       | PTCGIO source                                                                                                  | Notes                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `source`              | constant `'ptcgio'`                                                                                            |                                                                              |
| `sourceKey`           | `card.id`                                                                                                      | e.g. `swsh9-18` (unpadded)                                                   |
| `setCode`             | `card.set.id`                                                                                                  | parent set's PTCGIO ID                                                       |
| `language`            | constant `'en'`                                                                                                |                                                                              |
| `number`              | `card.number`                                                                                                  | preserved verbatim — `"1"`, `"18"`, `"SWSH001"`; canonical-keys.ts pads      |
| `name`                | `card.name`                                                                                                    |                                                                              |
| `nameLocalized`       | `null`                                                                                                         | PTCGIO is EN only here                                                       |
| `typeRaw`             | `card.types?.[0] ?? null`                                                                                      | first type; downstream `normalizePokemonType` aliases                        |
| `subtypeRaw`          | derived: see "subtype derivation" below                                                                        | normalized via `normalizeCardSubtype` downstream                             |
| `hp`                  | `parseHp(card.hp)`                                                                                             | PTCGIO emits hp as string; we parse to number, null on Trainer / Energy     |
| `illustrator`         | `card.artist ?? null`                                                                                          | PTCGIO uses `artist`, TCGdex uses `illustrator`                              |
| `flavorText`          | `card.flavorText ?? null`                                                                                      | Pokémon flavor only                                                          |
| `attacks`             | `card.attacks ?? null`                                                                                         | preserved as-is                                                              |
| `weakness`            | `card.weaknesses ?? null`                                                                                      | PTCGIO key spelling                                                          |
| `resistance`          | `card.resistances ?? null`                                                                                     | PTCGIO key spelling                                                          |
| `retreatCost`         | `card.convertedRetreatCost ?? card.retreatCost?.length ?? null`                                                | prefer the integer; fall back to length of the energy-list                  |
| `rarityRaw`           | `normalizeRarityRaw(card.rarity ?? null)`                                                                      | empty string → `null`                                                        |
| `extra.dexId`         | `card.nationalPokedexNumbers ?? undefined`                                                                     |                                                                              |
| `extra.subtypes`      | `card.subtypes ?? undefined`                                                                                   | full subtypes array — preserved for resolver / debugging                    |
| `extra.evolvesFrom`   | `card.evolvesFrom ?? undefined`                                                                                |                                                                              |
| `extra.evolvesTo`     | `card.evolvesTo ?? undefined`                                                                                  |                                                                              |
| `extra.regulationMark`| `card.regulationMark ?? undefined`                                                                             |                                                                              |
| `extra.legalities`    | `card.legalities ?? undefined`                                                                                 |                                                                              |
| `extra.rules`         | `card.rules ?? undefined`                                                                                      | trainer effect / VSTAR rule / etc.                                           |
| `extra.abilities`     | `card.abilities ?? undefined`                                                                                  |                                                                              |
| `extra.ancientTrait`  | `card.ancientTrait ?? undefined`                                                                               | XY-era                                                                       |
| `extra.level`         | `card.level ?? undefined`                                                                                      | vintage / LV.X                                                               |
| `extra.imageSmall`    | `card.images?.small ?? undefined`                                                                              |                                                                              |
| `extra.imageLarge`    | `card.images?.large ?? undefined`                                                                              | full-quality URL                                                             |
| `extra.supertype`     | `card.supertype ?? undefined`                                                                                  | preserved (subtypeRaw is derived; supertype kept for cross-source debugging) |

**Subtype derivation** (single source-of-truth string we feed
through `normalizeCardSubtype` downstream — same canonical strings as
TCGDEX-EN):

- `supertype === 'Pokémon'` → `'Pokemon'`.
- `supertype === 'Trainer'`:
  - if `subtypes` includes `'Item'` → `'Item'`
  - else if includes `'Supporter'` → `'Supporter'`
  - else if includes `'Stadium'` → `'Stadium'`
  - else if includes `'Pokémon Tool'` → `'Pokémon Tool'`
  - else if includes `'Tool'` → `'Tool'`
  - else → `null` (lets the downstream normalizer fail loudly)
- `supertype === 'Energy'`:
  - if `subtypes` includes `'Special'` → `'Special Energy'`
  - else (typically `['Basic']`) → `'Basic Energy'`
- otherwise → `null`.

### PTCGIO Card → `RawPrinting[]` (one or more per card)

The adapter never assigns `variant_class`. It emits one `RawPrinting`
per **distinct print run** known about the card. The sources of truth,
in order of precedence:

1. **`tcgplayer.prices` keys** when present:
   - `normal` → 1 non-holo printing
   - `holofoil` → 1 holo printing
   - `reverseHolofoil` → 1 reverse-holo printing
   - `1stEditionNormal` → 1 non-holo printing with `isFirstEdition: true`
   - `1stEditionHolofoil` → 1 holo printing with `isFirstEdition: true`
2. **Rarity-string fallback** when the prices map is absent / empty:
   one printing whose visual axis is derived from the rarity string
   (`Rare Holo*` / `Rare Ultra` / `Rare Secret` / `Amazing Rare` /
   `Radiant Rare` / `Double Rare` / `Hyper Rare` / `Rare Rainbow` /
   `Illustration Rare` / `Special Illustration Rare` /
   `Trainer Gallery Rare Holo` → `isHolo: true`; everything else →
   `isHolo: false`).
3. **Promo-set fallback.** When 1+2 produced nothing AND the parent
   set's id ends in `p`, emit one printing with `isPromo: true`. The
   variant classifier maps this to `PROMO`.

After determining which printings exist, the adapter applies the
**rarity overlay** to every printing:

| Rarity                       | Overlay set on every emitted printing                |
| ---------------------------- | ---------------------------------------------------- |
| `Illustration Rare`          | `isFullArt: true`,  `isHolo: true` (visually holo)   |
| `Special Illustration Rare`  | `isAltArt: true`,   `isHolo: true`                   |
| `Hyper Rare`                 | `isGoldRare: true`, `isHolo: true`                   |
| `Rare Rainbow`               | `isRainbowRare: true`, `isHolo: true`                |
| `Trainer Gallery Rare Holo`  | `isTrainerGallery: true`, `isHolo: true`             |
| `Promo`                      | `isPromo: true`                                      |

Per-printing raw signals:

| `RawPrinting` field      | Source                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `source`                 | `'ptcgio'`                                                                                                                    |
| `sourceKey`              | `card.id + '-' + variantTag` (`swsh9-1-normal`, `swsh9-1-reverse`, `swsh9-18-holo`, `base1-4-holo-1stedition`)                 |
| `cardKey`                | `card.id`                                                                                                                     |
| `sourcePrintingLabel`    | human-readable form (`'Non-Holo'`, `'Reverse Holo'`, `'Holo'`, `'1st Edition Holo'`, `'Promo'`)                                |
| `rarityRaw`              | parent card's `rarity ?? null`                                                                                                |
| `isHolo`                 | true for `holofoil` / `1stEditionHolofoil` / rarity-overlay holo classes / rarity-fallback holo strings                       |
| `isReverseHolo`          | true for `reverseHolofoil`                                                                                                    |
| `isFirstEdition`         | true for `1stEditionNormal` / `1stEditionHolofoil`                                                                            |
| `isShadowless`           | `false` (PTCGIO has no shadowless signal — vintage prints collapsed under one card id)                                        |
| `isFullArt`              | true when rarity is `Illustration Rare`                                                                                       |
| `isAltArt`               | true when rarity is `Special Illustration Rare`                                                                               |
| `isGoldRare`             | true when rarity is `Hyper Rare`                                                                                              |
| `isRainbowRare`          | true when rarity is `Rare Rainbow`                                                                                            |
| `isTextured`             | `false` (PTCGIO has no texture signal)                                                                                        |
| `isTrainerGallery`       | true when rarity is `Trainer Gallery Rare Holo` OR `card.number` matches `/^(?:TG\|GG)\d+$/i` (defensive — PTCGIO largely doesn't carry these) |
| `isPromo`                | true when parent set is a promo set (suffix-`p` rule) OR rarity is `Promo`                                                    |
| `isError`                | `false` (PTCGIO does not surface known print errors)                                                                          |
| `pattern`                | `null` (PTCGIO does not surface Cosmos / Galaxy / Poké Ball / Master Ball reverse-holo patterns)                              |
| `stamp`                  | `null` (PTCGIO does not surface prerelease / staff / league / build-and-battle / championship stamps)                         |
| `imageSourceUrl`         | `card.images?.large ?? card.images?.small ?? null`                                                                            |
| `extra.ptcgoCode`        | `card.set?.ptcgoCode ?? undefined` (preserved for cross-source joins)                                                         |

## Rarity normalization registry (additions)

`'ptcgio'` is already seeded in
`data-pipeline/src/normalize/rarity.ts` from T-DL-SOURCE-INTERFACES.
The seeded table covers the values observed in our captured fixtures:

- `Common`, `Uncommon`, `Rare`, `Rare Holo`, `Rare Holo EX/GX/LV.X/Star/V/VMAX/VSTAR`,
  `Rare Ultra`, `Rare Secret`, `Rare Rainbow`, `Rare Shiny`,
  `Rare Shining`, `Rare Prime`, `Rare ACE`, `Rare BREAK`,
  `Rare Prism Star`, `Amazing Rare`, `Radiant Rare`, `Double Rare`,
  `Illustration Rare`, `Special Illustration Rare`, `Hyper Rare`,
  `Trainer Gallery Rare Holo`, `Promo`.

This task asserts via tests that every `card.rarity` value in our
captured fixtures resolves through `normalizeRarity('ptcgio', …)`
without throwing. If a fixture surfaces a rarity not yet in the
table, this task extends the table in the same PR (registry
extension is in scope per the dispatch brief).

## Deliverables

- `data-pipeline/src/adapters/ptcgio/index.ts` — public barrel:
  exports a `createPTCGIOAdapter` factory, the `PTCGIOAdapter` class,
  and the public type aliases.
- `data-pipeline/src/adapters/ptcgio/adapter.ts` — class that
  implements `SourceAdapter`. Constructor accepts an `AdapterContext`
  + `{ http: RateLimitedClient, basePath?: string, apiKey?: string }`.
  The default base URL is `https://api.pokemontcg.io`; default base
  path `/v2`. Methods: `listSets()`, `listCardsForSet(setKey)`,
  `listPrintingsForCard(cardKey)`, plus granular `getSet(id)` and
  `getCard(id)`. Maps `NotFoundError` to "no data" semantics (returns
  `[]` for list-shaped methods rather than throwing) and surfaces
  other `AdapterError`s untouched. Reads `BINDERLY_PTCGIO_API_KEY`
  from env at construction; sets `X-Api-Key` request header when
  present.
- `data-pipeline/src/adapters/ptcgio/transform.ts` — pure transform
  functions: `ptcgioSetToRaw`, `ptcgioCardToRaw`,
  `ptcgioCardToPrintings`. Zero side effects, no HTTP, no globals
  beyond pure helpers.
- `data-pipeline/src/adapters/ptcgio/api-types.ts` — TypeScript types
  describing the slice of the PTCGIO v2 API the adapter consumes.
  Lenient (permissive optionals) — PTCGIO's dataset is community-
  maintained and tolerant of additional fields.
- `data-pipeline/src/adapters/ptcgio/promo-sets.ts` — small const +
  helper `isPtcgioPromoSet(setId)`; the suffix-`p` rule mirrors the
  TCGdex helper because PTCGIO uses TCGdex-compatible set IDs.
- `data-pipeline/src/adapters/ptcgio/fixtures/` — captured JSON
  responses (with volatile `cardmarket.prices` values stripped and
  `tcgplayer.prices.<key>` inner values stripped to `{}` to preserve
  the variant-signal-bearing key set without committing daily-changing
  numbers to source control):
  - `set.swsh9.json` — Brilliant Stars (modern; no Trainer Gallery on
    PTCGIO).
  - `set.base1.json` — Base Set (vintage; only one card-id per
    Charizard, no separate 1st-Ed / Shadowless rows).
  - `set.sv1.json` — Scarlet & Violet (SV-era; Illustration Rare,
    Special Illustration Rare, Hyper Rare).
  - `set.swshp.json` — SWSH Black Star Promos.
  - `card.swsh9-1.json` — Common with `normal` + `reverseHolofoil`
    price keys.
  - `card.swsh9-18.json` — Holo VSTAR (Charizard) with `holofoil` only.
  - `card.swsh9-174.json` — Rare Rainbow (number > printed_total).
  - `card.swsh9-181.json` — Rare Secret (no special-class signal,
    number > printed_total).
  - `card.base1-4.json` — Vintage Charizard (single `holofoil` key —
    PTCGIO does not separate 1st-Ed / Shadowless / Unlimited; this
    is the documented validation-tier limitation that the resolver
    fills from TCGDEX-EN's `variants_detailed`).
  - `card.sv1-200.json` — Illustration Rare.
  - `card.sv1-244.json` — Special Illustration Rare.
  - `card.sv1-258.json` — Hyper Rare basic energy.
  - `card.swshp-SWSH001.json` — Promo, rarity `"Promo"`.
- `data-pipeline/src/adapters/ptcgio/transform.test.ts` — unit tests
  over every fixture; assert produced `Raw{Set,Card,Printing}` shapes
  including round-trip through the zod schemas; `classifyVariant`
  end-to-end assertions on each fixture for the expected variant
  class.
- `data-pipeline/src/adapters/ptcgio/adapter.test.ts` — integration
  tests using the `FetchShim` pattern from
  `tcgdex-en/adapter.test.ts` — happy path, 404, 429 retry,
  malformed JSON, optional `X-Api-Key` header assertion. NO undici
  MockAgent (per the task brief — the FetchShim ratification stuck
  with TCGDEX-EN and we mirror it here).
- `data-pipeline/src/adapters/ptcgio/resolver-integration.test.ts` —
  wires the PTCGIO adapter (with shim) into `resolveCanonicalSets` /
  `resolveCanonicalCards` as the `validation` tier alongside a fake
  primary; asserts agreement → no conflict, disagreement → conflict
  with primary winning, and validation-tier provenance recorded.
- `data-pipeline/src/adapters/index.ts` — uncomment the line
  `export * from './ptcgio/index.js';` in the
  `T-DL-SOURCE-PTCGIO` section. Do NOT modify other adapters'
  sections.
- `data-pipeline/src/normalize/rarity.ts` — extend the `'ptcgio'`
  registry only if a captured-fixture rarity value isn't already
  covered (table is largely seeded by T-DL-SOURCE-INTERFACES).

## Acceptance criteria

- [ ] Adapter implements `SourceAdapter`; declares `name: 'ptcgio'`,
      `language: 'en'`, `tier: 'validation'`. (typecheck + an explicit
      test asserts the values).
- [ ] `createPTCGIOAdapter` accepts a `RateLimitedClient` (host
      enforced to `api.pokemontcg.io`); refuses other hosts via the
      existing `RateLimitedClient` host check.
- [ ] Adapter sets the `X-Api-Key` header when
      `BINDERLY_PTCGIO_API_KEY` is set OR an explicit `apiKey` is
      passed; omits the header otherwise. Asserted via a FetchShim
      header recording test.
- [ ] `ptcgioSetToRaw` covers every documented field in the Set
      mapping table; round-trip through `rawSetSchema` for every
      fixture set; `releaseDate` reformatted from `yyyy/mm/dd` to ISO
      `yyyy-mm-dd`.
- [ ] `ptcgioCardToRaw` covers every documented field in the Card
      mapping table; round-trip through `rawCardSchema` for every
      fixture card; `hp` parsed string → integer; `retreatCost`
      derived from `convertedRetreatCost` or array length.
- [ ] `ptcgioCardToPrintings` produces:
  - 2 printings for `swsh9-1` (Common: NON_HOLO + REVERSE_HOLO after
    classification).
  - 1 printing classified `HOLO` for `swsh9-18` (Charizard VSTAR,
    `Rare Holo VSTAR`, `holofoil` only).
  - 1 printing classified `RAINBOW` for `swsh9-174` (`Rare Rainbow`,
    overlay drives class — even though number > printed_total).
  - 1 printing classified `SECRET_RARE` for `swsh9-181`
    (`Rare Secret`; no special-class overlay; number > printed_total
    triggers the classifier's secret-rare rule).
  - 1 printing classified `HOLO` for `base1-4` (Charizard; only
    `holofoil` key — no FIRST_EDITION/SHADOWLESS flags because PTCGIO
    collapses vintage prints. Documented as a validation-tier limit;
    the resolver retains TCGDEX-EN's primary `variants_detailed`).
  - 1 printing classified `FULL_ART` for `sv1-200` (Illustration Rare).
  - 1 printing classified `ALT_ART` for `sv1-244` (Special
    Illustration Rare).
  - 1 printing classified `GOLD` for `sv1-258` (Hyper Rare).
  - 1 printing classified `PROMO` for `swshp-SWSH001`.
- [ ] Adapter integration tests cover happy path (listSets paginates
      `/v2/sets`, listCardsForSet paginates `/v2/cards?q=set.id:…`,
      listPrintingsForCard hits `/v2/cards/{id}`), 404, 429 retry,
      malformed JSON; all pass without live network.
- [ ] Resolver-integration test feeds the adapter (via shim) as
      validation alongside a fake primary into `resolveCanonicalSets`
      and `resolveCanonicalCards`; asserts a primary canonical set
      with `tcgdex-en` provenance and `ptcgio` agreement metadata; a
      mismatch surfaces as a `DataConflict` with primary winning.
- [ ] Every `card.rarity` value in captured fixtures resolves through
      `normalizeRarity('ptcgio', …)` without throwing (registry
      already seeded; this test guards drift).
- [ ] Variant raw signals (is_holo, is_reverse_holo, is_full_art,
      is_alt_art, is_gold_rare, is_rainbow_rare, is_first_edition,
      is_trainer_gallery, is_promo) populated correctly so
      `classifyVariant` produces the expected `variant_class` for
      every named fixture above.
- [ ] `pnpm --filter @binderly/data-pipeline build typecheck lint
      format:check test` clean.
- [ ] No file modified outside `data-pipeline/src/adapters/ptcgio/`,
      `data-pipeline/src/adapters/index.ts` (1-line uncomment), and
      `data-pipeline/src/normalize/rarity.ts` (additions only, if any).

## Out of scope

- Pricing ingestion: PTCGIO embeds TCGplayer + Cardmarket pricing on
  every `/v2/cards/{id}`. The adapter ignores pricing values entirely
  (only the `tcgplayer.prices` *key set* is read for variant
  signals). The pricing pipeline (`T-DL-PRICING-AGGREGATOR`, distinct
  phase) owns price observations.
- Image downloads / R2 uploads: the adapter only stores
  `imageSourceUrl`. The image pipeline (`T-DL-IMAGE-PIPELINE`)
  owns rehosting.
- Per-set master-set rules: `master_set_rules` is left empty (`{}`)
  on the canonical set; the master-set rules engine
  (`T-DL-MASTER-SET-RULES`) populates it later.
- Trainer Gallery sub-set coverage: PTCGIO does not list the TG / GG
  sub-set cards in the parent set's `total`. The resolver retains the
  primary tier's (TCGDEX-EN) Trainer Gallery records; PTCGIO simply
  has no rows to validate against, which the resolver records as a
  presence asymmetry (not a `DataConflict`).
- Vintage 1st-Edition / Shadowless / Unlimited disambiguation: PTCGIO
  collapses these under a single card id (`base1-4` for Charizard).
  Validation-tier role: no rows to disagree with the primary; the
  primary's TCGDEX-EN `variants_detailed` records are the source of
  truth for vintage variant disambiguation.
- Pattern variants (Cosmos / Galaxy / Poké Ball / Master Ball): PTCGIO
  does not surface these. Recovered from BULBAPEDIA / future filler
  tiers.
- Stamps (prerelease / staff / league / build-and-battle /
  championship): PTCGIO does not surface these.
- Texture variant detection: PTCGIO does not surface this.
- Localizations: out of scope for the EN adapter; the JP adapter
  populates `nameLocalized.jp` separately.

## Branch & PR

- Branch: `agent/T-DL-SOURCE-PTCGIO`
- PR title: `T-DL-SOURCE-PTCGIO: pokemontcg.io adapter (validation source for English)`
- Commit format: Conventional Commits.
  - `docs(tasks): elaborate T-DL-SOURCE-PTCGIO`
  - `feat(data-pipeline): PTCGIO adapter (T-DL-SOURCE-PTCGIO)`

## Escalation triggers

Stop and append to `open-questions.md` if:

- PTCGIO's response shape differs significantly from the field mapping
  tables above and `RawSet` / `RawCard` / `RawPrinting` cannot hold
  the new shape — propose a `data-pipeline/src/types.ts` patch before
  implementing.
- A field needed by the canonical schema in
  `packages/db/src/schema/{sets,cards,printings}.ts` is missing from
  PTCGIO and **no** filler / validation source plausibly carries it
  — flag for ratification (validation source is allowed to be lossy;
  the resolver fills via primary, but the bar is "is the field
  recoverable somewhere downstream?").
- A § 3 variant edge case is unrepresentable from PTCGIO signals —
  propose a `tcg-domain.md` § 8 patch (allowed escalation per the
  dispatch brief).
- 5 req/s sustained turns out to be wrong (PTCGIO returns 429s in
  tests with the API key set, or publishes a different documented
  limit) — adjust with a one-line PR-body justification before
  implementation.

## Notes from execution

- **`tcgplayer.prices` keys are the variant signal, not the values.**
  PTCGIO inlines volatile pricing on every card response. The captured
  fixtures preserve the *key set* (`normal` / `holofoil` /
  `reverseHolofoil` / `1stEditionHolofoil` / `1stEditionNormal`) by
  emptying each entry to `{}`, and strip the `cardmarket` block
  entirely. This keeps the variant-signal-bearing surface stable across
  re-captures without committing daily-changing numbers to source
  control. The adapter only reads the key set; pricing values are
  ignored.
- **PTCGIO is materially less complete than TCGdex-EN for variants.**
  Brilliant Stars: PTCGIO has 186 cards, TCGdex has 216 (the 30 Trainer
  Gallery cards `swsh9-TG01`..`swsh9-TG30` are absent on PTCGIO). Base
  Set Charizard: PTCGIO has one row (`base1-4` with a single
  `holofoil` price key), TCGdex has four rows in `variants_detailed`
  (Holo Unlimited, Holo Shadowless, Holo Shadowless 1st Edition, Holo
  1999-2000 Copyright). This is the documented validation-tier
  posture — the resolver retains the primary's `variants_detailed`
  data and PTCGIO contributes provenance plus rarity/illustrator/HP
  cross-checks.
- **PTCGIO has no `Pokemon Center` / pattern / stamp / texture
  signals.** The adapter sets `pattern: null`, `stamp: null`,
  `isShadowless: false`, `isTextured: false`, `isError: false` on every
  printing. These are recovered (where possible) from BULBAPEDIA in
  T-DL-SOURCE-BULBAPEDIA.
- **Number formats differ between PTCGIO and TCGdex.** PTCGIO emits
  `"18"`, TCGdex emits `"018"`. Both align on the canonical key
  `en-swsh9-018` because `canonical-keys.ts` zero-pads numeric numbers
  to 3 (lettered numbers like `SWSH001` are preserved verbatim). The
  adapter preserves PTCGIO's source formatting on `RawCard.number`.
- **API key handling.** Reads `BINDERLY_PTCGIO_API_KEY` at construction
  time. When set, sends `X-Api-Key: <value>` on every request. Empty
  string is treated as no key. The constructor's explicit `apiKey`
  wins over the env var. Without a key, PTCGIO caps at 1000
  requests/day with a 30/min ceiling — sufficient for fixture capture
  and dev smoke tests but not a full set seed-ingest.
- **Rate-limit floor 5 rps / burst 10.** Matches the
  orchestrator-stated free-API floor and TCGDEX-EN's choice. Well
  below the with-key 20k/day budget; in keyless mode we hit the 30
  rpm cap on long pulls (documented).
- **Rarity registry was already seeded.** The `'ptcgio'` table in
  `data-pipeline/src/normalize/rarity.ts` was added in
  T-DL-SOURCE-INTERFACES (40+ entries covering observed PTCGIO
  vocabulary). A coverage test in `transform.test.ts` walks every
  captured fixture's `rarity` value through `normalizeRarity('ptcgio',
  …)` and asserts no throws. This guards against drift if PTCGIO
  introduces new rarity strings between captures. No registry
  extension was needed for this task.
- **Touched files outside `owns_paths`.** Per the task brief and the
  pre-staged barrel pattern: only `data-pipeline/src/adapters/index.ts`
  (1-line uncomment in the `T-DL-SOURCE-PTCGIO` section). The rarity
  registry was unchanged.
- **Test counts.** 313 / 313 passing across 19 test files. New PTCGIO
  contribution: 32 transform tests, 25 adapter tests, 4 resolver-
  integration tests = 61 tests. The 252 pre-existing tests are
  untouched.
