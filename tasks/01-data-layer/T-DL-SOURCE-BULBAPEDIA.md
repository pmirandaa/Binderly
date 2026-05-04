# T-DL-SOURCE-BULBAPEDIA — Bulbapedia adapter (validation/filler)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** L
**Status:** in_progress

---

## Hard dependencies

- T-DL-SOURCE-INTERFACES (merged @ 51b3727 — provides `SourceAdapter`,
  `RateLimitedClient`, `Raw*` / `Canonical*` types, canonical-key
  helpers, the variant classifier, and the per-source rarity
  registry).
- T-DL-SOURCE-TCGDEX-EN (merged @ 1a741ab — canonical reference
  implementation; this adapter mirrors its folder layout and testing
  patterns. The TCGdex-EN set codes we cross-reference (`base1`,
  `swsh9`, …) are also the codes Bulbapedia output is mapped to so the
  resolver can join filler rows onto primary).

## Soft dependencies

- None. Sibling adapter tasks (T-DL-SOURCE-PTCGIO, T-DL-SOURCE-TCGDEX-JP)
  integrate after merge.

## Required reading

- `PROJECT.md` § 6 (Data Model), § 7 (Sources & Standardization),
  § 8 (Master Set Definition).
- `rules/01-data-layer.md` — stage rules. Bulbapedia-specific notes:
  - "Bulbapedia content is CC-BY-NC-SA — use it only for *factual
    validation*, not as a content source." We therefore keep this
    adapter at `tier: 'filler'` and emit only **factual** fields
    (rarity tier, illustrator, hp, retreat cost, raw variant
    signals). We do not emit prose (flavor text, set descriptions).
  - "No image hotlinking." We never emit Bulbapedia hosted image URLs
    on `imageSourceUrl` — Bulbapedia's images are uploaded under
    Pokémon Company copyright on a CC-BY-NC-SA wiki and rehosting
    them in `printing.image_source_url` would inherit a license we
    can't honor at the app layer. Primary sources (TCGdex EN) carry
    the image URL.
  - "Number formatting: never strip leading zeros from `card.number`."
    Bulbapedia uses bare numerals on card pages (`Charizard (Base
    Set 4)`, not `Charizard (Base Set 004)`). We zero-pad to 3 in the
    transform when the number is purely numeric, mirroring TCGdex EN
    numbering convention; lettered numbers (TG / GG / SWSH-prefixed
    promos) preserve the original form.
- `context/tcg-domain.md` § 1 (variant taxonomy), § 3 (edge cases —
  Trainer Gallery, Galarian Gallery, Base Set Shadowless / 1st Ed /
  Unlimited, Promo "sets", Errors / misprints), § 5 (canonical
  keys), § 6 (rarity normalization), § 8 (variant decision tree).
- `context/legal-and-brand.md` § "Data source ToS" — the
  **Bulbapedia** entry is the operative spec for this task:
  - **Content license:** CC-BY-NC-SA. We use Bulbapedia for
    *factual* cross-validation only; we do not redistribute prose.
  - **API etiquette (mandatory):** every external request must carry
    a contactable User-Agent. Bulbapedia / Bulbagarden has been
    explicit on the BulbaWiki Talk:Manual_of_Style about hostile
    UA-less scrapers; missing UA risks a hard IP block.
  - **Rate-limit etiquette (no published number):** we set a
    conservative floor of **1 req/s sustained, burst 2**. Bulbapedia
    is an unmonetized community wiki funded by Bulbagarden Bulletin
    Board donations; we do not hammer it.
  - **No HTML scraping:** "no scraping the rendered HTML, use the
    API". The MediaWiki action API at `/w/api.php` is the only
    surface this adapter touches.
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
- `data-pipeline/src/normalize/rarity.ts` — registry to extend (the
  `bulbapedia-en` table is already seeded with a small core set in
  T-DL-SOURCE-INTERFACES; this task expands it with the rarity
  vocabulary observed across vintage / SWSH / SV-era card pages).
- `data-pipeline/src/variant-classify.ts` — consumes raw printing
  signals; the adapter must NOT assign `variant_class`.
- `data-pipeline/src/adapters/tcgdex-en/` — canonical reference
  implementation. Folder layout and test pattern mirror this
  directly.

## Goal

Ship the Bulbapedia adapter as the first **filler-tier** English
source (distinct from validation-tier ptcgio) per PROJECT.md § 7.
Bulbapedia's coverage is patchy and prose-heavy; what it carries
reliably are the *raw variant signals* a vintage- and promo-aware
collector needs (1st Edition stamping, Shadowless borders, staff /
prerelease stamping, the "Galarian Gallery" sub-set numbering, the
Trainer Gallery sub-set numbering) plus illustrator and rarity tier
strings. The adapter pulls set lists via MediaWiki
`list=categorymembers`, set / card pages via
`prop=revisions&rvprop=content&rvslots=main` (raw wikitext), parses
infobox templates with a small standalone wikitext infobox parser,
and emits the standard `Raw*` shapes. Because Bulbapedia is filler,
the resolver treats every emitted field as a "fill on null" candidate
behind the primary; field-level conflicts surface to
`data_conflicts` only when validation tiers ALSO disagree (filler
disagreement is silenced by design — the primary wins and Bulbapedia
contributes only the gaps).

## Bulbapedia API research notes

### Endpoints we hit (all GET, JSON, no auth)

| Purpose                                | Path                                                                                                | Example                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Enumerate cards in a set (page titles) | `/w/api.php?action=query&list=categorymembers&cmtitle=Category:<Set>&cmlimit=500&cmnamespace=0`     | `…&cmtitle=Category:Brilliant_Stars`                                                                             |
| Fetch a page's wikitext (revision)     | `/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=<Title>&formatversion=2` | `…&titles=Charizard_(Brilliant_Stars_18)`                                                                        |
| Fetch a set's wikitext (revision)      | same as above                                                                                       | `…&titles=Brilliant_Stars_(TCG)`                                                                                 |

All requests carry `format=json&formatversion=2`. The `formatversion=2`
flag is critical: under v1 the response is keyed by an opaque
internal page id (`pages.{12345}`); under v2 it's an array
(`pages: [{ title, revisions: [{ slots: { main: { content } } }] }]`)
which is much friendlier to type.

We do NOT use the MediaWiki `parse` API. The trade-off below
documents the choice.

### Wikitext-parsing strategy: raw wikitext + small infobox parser (chosen)

| Strategy                                | Pros                                                                                                  | Cons                                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Raw wikitext + infobox parser** *(chosen)* | Stable: template names + parameter names rarely change. No DOM dependency. Smaller payload. Cheap to test against captured fixtures. Easy to identify fields per-era from explicit infobox params. | Requires a small custom parser (regex with brace counting). Gallery sub-pages and complex wikitext constructs we do NOT consume are stripped during fetch by ignoring everything outside the first `{{CardInfobox…}}` template block. |
| MediaWiki `parse` API                   | Returns JSON-rendered HTML w/ stable structure. No wikitext parsing.                                  | HTML / CSS / class-name structure changes more often than infobox templates. Larger payload, slower endpoint, more rate-limit pressure. Heavier test fixtures. Pulls in unreliable rendered text we'd then have to re-parse anyway.   |

Decision rationale: Bulbapedia's `{{CardInfobox}}` /
`{{SetInfobox}}` template parameter names have been documented and
stable for years (see Bulbapedia's `Template:CardInfobox`
documentation page). For the small slice of fields we extract
(name, illustrator, rarity, retreat, hp, type, set, number, raw
variant flags) the wikitext is dramatically more compact and
reliable than the rendered HTML. Future expansion (e.g. parsing the
"Release information" sections that list multiple printings of one
card per era) is also easier from wikitext, where each printing is
a `{{CardPrintInfo|…}}`-style template that round-trips cleanly.

### Rate limit and User-Agent

Bulbapedia publishes no documented per-IP rate limit. The orchestrator
default for free community wikis is **1 req/s sustained, burst 2**.
Per `context/legal-and-brand.md` and the long-standing community
norm on Bulbawiki, this is conservative and respectful; it prevents
the adapter from looking like a scraper. The existing
`RateLimitedClient` defaults (4 retries, 500ms base × 2^n backoff,
15s timeout, honor `Retry-After`) apply unchanged.

`User-Agent`: every request carries a **mandatory** contactable UA.
Per the `RateLimitedClient` constructor we accept either a constructor
argument or the `BINDERLY_DATA_PIPELINE_UA` env var; the README
documents the recommended format
`binderly-data-pipeline/<version> (+https://github.com/pmirandaa/Binderly)`.
Bulbapedia / Bulbagarden has been historically firm about UA-less
scrapers; the adapter refuses to construct without a UA via the
`RateLimitedClient` contract.

### Idempotency posture

Every Raw* the adapter emits derives its identifier from the
**page title**, which is Bulbapedia's primary stable key for an
article. Page titles are stable across renames via a redirect, but
the raw content endpoint returns the canonical (post-rename) title
in the response body. The adapter uses the response's
`pages[0].title` as the source of truth for `RawSet.sourceKey` /
`RawCard.sourceKey`, NOT the requested title. This guarantees that
re-fetches under a redirected title still produce the same source
key.

`RawPrinting.sourceKey` is `${pageTitle}-${variantTag}`, where
`variantTag` encodes the variant axis derived from infobox params:

- `holo` / `nonholo` / `reverse` from the rarity / class flags
- `1stedition` / `shadowless` / `unlimited` flags suffixed
- `staff` / `prerelease` / `league` for stamped variants
- `promo` for promo-set fallbacks

Examples (the format is stable across re-fetches):

- `Charizard (Base Set 4)-holo-shadowless-1stedition`
- `Charizard (Base Set 4)-holo-shadowless`
- `Charizard (Base Set 4)-holo-unlimited`
- `Charizard VSTAR (Brilliant Stars 174)-rainbow`
- `Pikachu V (SWSH Black Star Promos 285)-promo-staff`

### Set code mapping (Bulbapedia → TCGdex)

The resolver joins records by canonical key
(`{language}-{set_code}-{number_padded}`); for Bulbapedia (filler) to
contribute, its emitted `code` MUST match TCGdex EN's set code (the
primary). Bulbapedia uses set names like `Brilliant Stars` while
TCGdex uses lowercase short codes like `swsh9`. The adapter maintains
a small Bulbapedia-name → TCGdex-code mapping table seeded with the
sets needed by the test fixtures plus a slug-based fallback for
unmapped sets. Sets without a mapping land in the fallback
`bulbapedia-<slug>` form; the resolver surfaces those as
`__presence` conflicts so ops can extend the table later.

The mapping table is exported as `BULBAPEDIA_TO_TCGDEX_SET_CODES` so
the orchestrator can audit / extend without recompiling.

## Field mapping tables

### Bulbapedia Set page → `RawSet`

The set page (e.g. "Brilliant Stars (TCG)") is wikitext containing a
`{{SetInfobox|…}}` block. Common parameter names (per the
long-standing template):

| `RawSet` field      | Bulbapedia source                                                                  | Notes                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `source`            | constant `'bulbapedia-en'`                                                         | provenance                                                                                                     |
| `sourceKey`         | response `pages[0].title` (canonical; survives redirect)                           | also used for `listCardsForSet`                                                                                |
| `code`              | `BULBAPEDIA_TO_TCGDEX_SET_CODES[name] ?? slugify(name)`                            | Joining key; lowercased per `tcg-domain.md` § 5                                                                |
| `language`          | constant `'en'`                                                                    | adapter is per-language                                                                                        |
| `name`              | infobox `name` (canonical English set name)                                        |                                                                                                                |
| `series`            | infobox `series` ?? null                                                           | "Sword & Shield", "Scarlet & Violet", "Sun & Moon", …                                                          |
| `releaseDate`       | infobox `released` (US release; ISO `yyyy-mm-dd` after parsing)                    | Bulbapedia stores as `Month DD, YYYY` (e.g. `February 25, 2022`); transform parses to ISO                      |
| `printedTotal`      | infobox `cards` ?? null                                                            | Numeric primary print count; Bulbapedia's "of XXX" on-card count                                               |
| `total`             | infobox `cardstotal` ?? `cards` ?? null                                            | Including secret rares; older set pages omit `cardstotal` and we fall back to `cards`                          |
| `logoUrl`           | `null`                                                                             | We never emit Bulbapedia hosted image URLs (license incompatibility — see `legal-and-brand.md`)                |
| `symbolUrl`         | `null`                                                                             | same                                                                                                           |
| `extra.bulbapediaTitle` | `pages[0].title`                                                               | preserved for ops debugging; not the join key                                                                  |
| `extra.bulbapediaSetName` | infobox `name`                                                               | the human-readable English name used by the mapping table                                                      |

### Bulbapedia Card page → `RawCard`

The card page (e.g. "Charizard (Base Set 4)") is wikitext with a
`{{CardInfobox|…}}` block. The adapter reads only the listed fields;
prose ("Card text", "Release information", "Trivia") is intentionally
ignored.

| `RawCard` field     | Bulbapedia source                                                                    | Notes                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `source`            | constant `'bulbapedia-en'`                                                           |                                                                                                                |
| `sourceKey`         | response `pages[0].title`                                                            | e.g. `Charizard (Base Set 4)`                                                                                  |
| `setCode`           | derived from page-title set portion, mapped via `BULBAPEDIA_TO_TCGDEX_SET_CODES`     | parses the parenthetical: `Charizard (Base Set 4)` → `Base Set` → `base1`                                      |
| `language`          | constant `'en'`                                                                      |                                                                                                                |
| `number`            | infobox `cardno` (split on `/`) ?? page-title trailing token                         | Zero-padded to 3 when purely numeric; lettered numbers (`TG01`, `GG14`, `SWSH001`) preserved as-is             |
| `name`              | infobox `cardname` ?? infobox `name` ?? page-title leading portion                   |                                                                                                                |
| `nameLocalized`     | `{ jp: infobox.jname }` when present, else `null`                                    | Bulbapedia frequently exposes the Japanese name on EN card pages; we surface it for the resolver to merge      |
| `typeRaw`           | infobox `type` ?? null                                                               | Single Pokémon energy type (`Fire`, `Water`, `Lightning`, …); normalized via `normalizePokemonType` downstream |
| `subtypeRaw`        | derived: see "subtype derivation" below                                              | `'Pokemon'` / `'Item'` / `'Supporter'` / `'Stadium'` / `'Tool'` / `'Pokémon Tool'` / `'Basic Energy'` / `'Special Energy'` |
| `hp`                | infobox `hp` (parsed integer) ?? null                                                | absent on Trainer / Energy                                                                                     |
| `illustrator`       | infobox `illus` ?? `caption` (extracted) ?? null                                     | Bulbapedia primary field is `illus`; older pages put the illustrator in `caption` as `Illus. [[Name]]`         |
| `flavorText`        | `null`                                                                               | Prose; we do not redistribute it (CC-BY-NC-SA license)                                                         |
| `attacks`           | `null`                                                                               | Bulbapedia attack data is interleaved with prose; not extracted in this iteration                              |
| `weakness`          | `null`                                                                               | same                                                                                                           |
| `resistance`        | `null`                                                                               | same                                                                                                           |
| `retreatCost`       | infobox `retreatcost` (parsed integer; `-` → 0) ?? null                              | Trainer / Energy → null                                                                                        |
| `rarityRaw`         | infobox `rarity` ?? null                                                             | Mapped via `normalizeRarity('bulbapedia-en', …)` in seed-ingest                                                |
| `extra.bulbapediaTitle` | `pages[0].title`                                                                 |                                                                                                                |
| `extra.evostage`    | infobox `evostage` ?? undefined                                                      |                                                                                                                |
| `extra.evolveFrom`  | infobox `evoname` ?? `evos` ?? undefined                                             |                                                                                                                |
| `extra.species`     | infobox `species` ?? undefined                                                       | e.g. `Charizard` — the Pokédex species name                                                                    |
| `extra.regulationMark` | infobox `regulationmark` ?? undefined                                             | `D` / `E` / `F` / `G`                                                                                          |
| `extra.expansion`   | infobox `expansion` ?? undefined                                                     | The English-language set name as Bulbapedia spells it                                                          |
| `extra.cardno`      | infobox `cardno` (raw form, e.g. `4/102`)                                            | Preserved verbatim for ops debugging                                                                           |

**Subtype derivation:**

- Pokémon page (Pokémon energy type via `type` and `species`/`evostage`/`evoname` present, or `class` is `Pokémon`) → `'Pokemon'`.
- Trainer card page (`class` is `Trainer Card` / `Trainer` and a `cardtype` of `Item` / `Supporter` / `Stadium` / `Tool` / `Pokémon Tool` is set) → that `cardtype` verbatim. When `cardtype` is missing we fall back to `'Item'` (the original / most common Trainer flavor).
- Energy card page (`class` is `Energy` and `cardtype` is `Basic` / `Special`) → `'Basic Energy'` / `'Special Energy'`.
- Anything else → `null`.

These map to our enum via the existing aliases in
`data-pipeline/src/normalize/type.ts` (Pokémon, Item, Supporter,
Stadium, Tool, Pokémon Tool, Basic Energy, Special Energy).

### Bulbapedia Card → `RawPrinting[]` (one or more per card)

The adapter never assigns `variant_class`. It emits one
`RawPrinting` per **distinct print run** the page identifies.
Bulbapedia card pages handle this two ways:

1. **Single infobox + variant flags** — the simple modern case. The
   infobox carries the dominant printing's class (`Holographic`,
   `Reverse Holographic`, `Rare Rainbow`, etc.) plus optional
   variant flags (`1stEdition`, `shadowless`). The adapter emits one
   `RawPrinting` per (infobox, variant-flag) combination derived
   from explicit fields.

2. **"Release information" section + per-print sub-templates** —
   vintage cards (Base Set Charizard) carry the dominant infobox and
   then a Release information section with sub-templates flagging
   each historical print run (1st Edition Shadowless, Shadowless,
   Unlimited). When the sub-templates are present we yield one
   printing per sub-template; otherwise we fall back to deriving
   from the dominant infobox flags.

The adapter's `parsers/wikitext-infobox.ts` exposes:

- `parseTemplateBlocks(wikitext)` — returns every `{{Template|…}}`
  block in the wikitext as `(templateName, params)` pairs.
- `parseInfoboxParams(block)` — splits one block into key/value
  pairs, preserving raw values (square-bracket links / `<br>` / `''`
  italics retained — the consumer trims them).

The transform layer (`transform.ts`) knows the small set of
templates we recognize (`CardInfobox`, `SetInfobox`, the
`PrintInfo` / `PrintData` family for vintage release information)
and ignores the rest.

Per-printing raw signals:

| `RawPrinting` field     | Source                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `source`                | `'bulbapedia-en'`                                                                                                                 |
| `sourceKey`             | `${pageTitle}-${variantTag}` (e.g. `Charizard (Base Set 4)-holo-shadowless-1stedition`); deterministic, idempotent                |
| `cardKey`               | `pageTitle` (the adapter's card key — resolver / classifier consume this; canonical card key is built downstream)                 |
| `sourcePrintingLabel`   | human-readable form of the variant (`Holo`, `Reverse Holo`, `1st Edition Shadowless Holo`, `Rainbow Rare`, `Promo`, …)            |
| `rarityRaw`             | parent card's `rarity` (Bulbapedia value verbatim, with whitespace trimmed)                                                       |
| `isHolo`                | `true` when class is `Holographic` (or rarity carries an explicit holo signal: `Holo Rare`, `Rare Holo`, `Holographic Rare`, etc.) |
| `isReverseHolo`         | `true` when class is `Reverse Holographic` / `Reverse Holo`                                                                       |
| `isFirstEdition`        | `true` when infobox / sub-template carries `1stEdition=yes` or the printing label includes `1st Edition`                          |
| `isShadowless`          | `true` when infobox / sub-template carries `shadowless=yes` or the printing label includes `Shadowless`                           |
| `isFullArt`             | `true` when rarity is `Full Art`, `Illustration Rare`, `Holographic Rare Full Art`, …                                             |
| `isAltArt`              | `true` when rarity is `Special Illustration Rare`                                                                                 |
| `isGoldRare`            | `true` when rarity is `Hyper Rare`                                                                                                |
| `isRainbowRare`         | `true` when rarity is `Rainbow Rare` / `Rare Rainbow`                                                                             |
| `isTextured`            | `false` (Bulbapedia does not carry a texture-rare signal as a class)                                                              |
| `isTrainerGallery`      | `true` when card's number prefix is `TG` / `GG`                                                                                   |
| `isPromo`               | `true` when set is a known promo set (set code mapped via `isBulbapediaPromoSet`) OR sub-template flags an explicit promo run     |
| `isError`               | `false` (this iteration; Bulbapedia documents misprints as their own "Error" cards, which are distinct pages — handled later)     |
| `pattern`               | `null` (Bulbapedia does not carry the pattern axis; ptcgio supplements)                                                           |
| `stamp`                 | `'PRERELEASE'` / `'STAFF'` / `'LEAGUE'` / `'BUILDBATTLE'` / `'CHAMPIONSHIP'` derived from the printing's stamp infobox / sub-template |
| `imageSourceUrl`        | `null` — license-incompatible to rehost                                                                                           |
| `extra.bulbapediaPrintingLabel` | the human-readable label used to build `variantTag`                                                                       |

#### Variant resolution by branch

For each card, in order (the first branch that produces ≥1 printing
wins):

1. **Release-information sub-templates** (vintage). When present:
   one printing per sub-template, each carrying its own
   `class` / `1stedition` / `shadowless` / `stamp` parameters.
2. **Trainer Gallery / Galarian Gallery** number prefix. The card
   number begins with `TG` or `GG` → emit one printing flagged
   `isTrainerGallery: true`. The classifier picks `TRAINER_GALLERY`.
3. **Single dominant infobox class**. The dominant class
   (`Holographic`, `Reverse Holographic`, `Rainbow Rare`, `Hyper
   Rare`, `Full Art`, `Special Illustration Rare`, …) → one
   printing classified via that signal.
4. **Promo-set fallback**. When the parent set is a known promo set
   (per `isBulbapediaPromoSet`) and no other branch fired → one
   printing flagged `isPromo: true`. The classifier picks `PROMO`.
5. **No variant signal at all** → empty array. Logged via the
   adapter's `bulbapedia-en.empty_printings` warn line.

## Rarity normalization registry (additions)

The registry already ships with a small Bulbapedia EN seed in
T-DL-SOURCE-INTERFACES (`Common`, `Uncommon`, `Rare`, `Holo Rare`,
`Ultra Rare`, `Secret Rare`, `Hyper Rare`, `Rainbow Rare`,
`Illustration Rare`, `Special Illustration Rare`, `Double Rare`,
`Amazing Rare`, `Radiant Rare`, `Promo`). The cases below are
observed in live Bulbapedia card pages and need to be added; the
expanded vocabulary covers vintage, EX-era, SWSH-era, and SV-era
rarities:

| Bulbapedia rarity                      | Canonical                          | Reason                                                                                              |
| -------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Rare Holo`                            | `HOLO_RARE`                        | Bulbapedia and TCGdex both use both word orders; we mirror the existing TCGdex-EN entries.          |
| `Holographic Rare`                     | `HOLO_RARE`                        | Older EN releases used "Holographic Rare" in the rarity slot directly.                              |
| `Rare Holo EX`                         | `ULTRA_RARE`                       | Vintage and SWSH era both surface this exact form.                                                  |
| `Rare Holo GX`                         | `ULTRA_RARE`                       |                                                                                                     |
| `Rare Holo V`                          | `ULTRA_RARE`                       | SWSH era VSTAR / VMAX / V mechanics consolidate here.                                               |
| `Rare Holo VMAX`                       | `ULTRA_RARE`                       |                                                                                                     |
| `Rare Holo VSTAR`                      | `ULTRA_RARE`                       |                                                                                                     |
| `Rare Holo LV.X`                       | `ULTRA_RARE`                       | Diamond & Pearl–Platinum era.                                                                       |
| `Rare Ultra`                           | `ULTRA_RARE`                       | Bulbapedia's most generic "ultra rare" form.                                                        |
| `Rare Holo Star`                       | `ULTRA_RARE`                       | Black Star set holo/star tier; one off but observed.                                                |
| `Rare Holo ex`                         | `ULTRA_RARE`                       | SV-era lowercase `ex` mechanic — Bulbapedia keeps the casing.                                       |
| `Rare BREAK`                           | `ULTRA_RARE`                       | XY-era BREAK Evolution mechanic.                                                                    |
| `Rare Prime`                           | `ULTRA_RARE`                       | HGSS-era Prime mechanic.                                                                            |
| `Rare ACE`                             | `ULTRA_RARE`                       | BW-era ACE SPEC.                                                                                    |
| `Rare Prism Star`                      | `ULTRA_RARE`                       | SM-era prism-star mechanic.                                                                         |
| `Rare Shining`                         | `ULTRA_RARE`                       | Neo-era / SM-era Shining Pokémon.                                                                   |
| `Rare Shiny`                           | `ULTRA_RARE`                       | Hidden Fates / SWSH Shining Fates.                                                                  |
| `Rare Secret`                          | `SECRET_RARE`                      | Modern alias for "Secret Rare" used in some Bulbapedia card pages.                                  |
| `Hyper rare` / `Hyper Rare`            | `HYPER_RARE`                       | Already present; ensure case-insensitive variants resolve.                                          |
| `Rare Rainbow`                         | `RAINBOW_RARE`                     | Bulbapedia variant of "Rainbow Rare".                                                               |
| `Full Art`                             | `ILLUSTRATION_RARE`                | Pre-SV "Full Art" maps to our `ILLUSTRATION_RARE` (the visual class is the same axis).              |
| `Trainer Gallery Rare Holo`            | `HOLO_RARE`                        | SWSH Trainer Gallery cards' rarity tier (the variant_class is `TRAINER_GALLERY`, separate axis).    |
| `Rare Promo`                           | `PROMO`                            | Promo cards on Bulbapedia.                                                                          |
| `Black Star Promo`                     | `PROMO`                            | Older Bulbapedia variant string for promo tier.                                                     |
| `None`                                 | _coerced to `null` by adapter_     | Some promo pages omit the `rarity` field; we strip "None" / empty / missing identically.            |

## Deliverables

- `data-pipeline/src/adapters/bulbapedia/index.ts` — public barrel:
  exports the `createBulbapediaAdapter` factory and the
  `BulbapediaAdapter` class along with the parser / transform
  surface needed by sibling adapters.
- `data-pipeline/src/adapters/bulbapedia/adapter.ts` — class that
  implements `SourceAdapter`. Constructor accepts an
  `AdapterContext` + `{ http: RateLimitedClient, basePath?: string }`.
  The default base path is `/w` and the client is pinned to host
  `bulbapedia.bulbagarden.net`. Methods: `listSets()`,
  `listCardsForSet(setKey)`, `listPrintingsForCard(cardKey)`. The
  list-shaped methods translate `NotFoundError` and MediaWiki
  `query.pages.0.missing === true` ("page does not exist") to empty
  arrays.
- `data-pipeline/src/adapters/bulbapedia/transform.ts` — pure
  transform functions: `bulbapediaSetToRaw`, `bulbapediaCardToRaw`,
  `bulbapediaCardToPrintings`. Zero side effects, no HTTP, no
  globals beyond pure helpers.
- `data-pipeline/src/adapters/bulbapedia/wiki-types.ts` — TypeScript
  types describing the MediaWiki API responses we consume + the
  `ParsedCard` / `ParsedSet` intermediate shapes the wikitext
  parsers emit.
- `data-pipeline/src/adapters/bulbapedia/set-codes.ts` — the
  `BULBAPEDIA_TO_TCGDEX_SET_CODES` table and helpers
  (`tcgdexCodeForBulbapediaSet`, `isBulbapediaPromoSet`,
  `slugifyBulbapediaSetName`). Exported so sibling tasks can audit /
  extend.
- `data-pipeline/src/adapters/bulbapedia/parsers/wikitext-infobox.ts` —
  the small wikitext template parser (`parseTemplateBlocks`,
  `parseInfoboxParams`, `stripWikitextLinks`,
  `unwrapWikitextItalics`).
- `data-pipeline/src/adapters/bulbapedia/parsers/card-infobox.ts` —
  field-typed `CardInfobox` / printing sub-template parser building
  on the wikitext parser.
- `data-pipeline/src/adapters/bulbapedia/parsers/set-infobox.ts` —
  field-typed `SetInfobox` parser.
- `data-pipeline/src/adapters/bulbapedia/parsers/page-title.ts` —
  page-title parser (`Charizard (Base Set 4)` →
  `{ name, setName, number }`).
- `data-pipeline/src/adapters/bulbapedia/fixtures/` — captured
  responses + raw wikitext samples:
  - `revisions.charizard-base-set-4.json` — Base Set Charizard
    (vintage; explicit Release information sub-templates flagging
    the three print runs).
  - `revisions.charizard-vstar-rainbow.json` — Brilliant Stars
    Charizard VSTAR Rainbow Rare (modern alt-art / rainbow secret
    rare).
  - `revisions.lugia-staff-promo.json` — SWSH Black Star promo
    (`Lugia V (SWSH Black Star Promos 285)`) with explicit
    `STAMPED_STAFF` flag.
  - `revisions.set-base-set.json` — `Base Set (TCG)`.
  - `revisions.set-brilliant-stars.json` — `Brilliant Stars (TCG)`.
  - `revisions.set-swsh-promos.json` — `SWSH Black Star Promos (TCG)`.
  - `revisions.missing-page.json` — MediaWiki "missing" response
    (200 with `query.pages[0].missing === true`).
  - `revisions.malformed.json` — payload missing `query` (used to
    test PermanentError surfacing).
  - `categorymembers.brilliant-stars.json` — MediaWiki
    `list=categorymembers` response listing two card pages from the
    Brilliant Stars set.
  - `wikitext.charizard-base-set-4.txt` — bare wikitext extracted
    from the corresponding `revisions.*.json` for parser-only tests.
  - `wikitext.charizard-vstar-rainbow.txt` — same.
  - `wikitext.lugia-staff-promo.txt` — same.
- `data-pipeline/src/adapters/bulbapedia/parsers/wikitext-infobox.test.ts`
  — exhaustive parser unit tests including nested templates,
  multi-line params, link / italics stripping, escape edge cases.
- `data-pipeline/src/adapters/bulbapedia/parsers/card-infobox.test.ts`
  — typed `CardInfobox` parser tests.
- `data-pipeline/src/adapters/bulbapedia/parsers/set-infobox.test.ts`
  — typed `SetInfobox` parser tests.
- `data-pipeline/src/adapters/bulbapedia/transform.test.ts` — unit
  tests over every fixture; assert produced
  `Raw{Set,Card,Printing}` shapes, including round-trip through the
  zod schemas.
- `data-pipeline/src/adapters/bulbapedia/adapter.test.ts` —
  integration tests using a `fetchImpl` shim (same pattern as
  `rate-limited-client.test.ts`) — happy path, 404, 429
  retry-exhaustion, MediaWiki `pages[0].missing` translation,
  malformed JSON.
- `data-pipeline/src/adapters/bulbapedia/resolver-integration.test.ts`
  — wires the adapter (with shim) into `resolveCanonicalSets` /
  `resolveCanonicalCards` alongside a fake primary source; assert
  the canonical record carries `bulbapedia-en` provenance under
  `validation` (when used as validation) and that filler-only
  records surface as presence conflicts.
- `data-pipeline/src/adapters/index.ts` — uncomment the **exactly
  one** `export * from './bulbapedia/index.js';` line in the
  pre-staged `T-DL-SOURCE-BULBAPEDIA` section. Do not modify other
  adapters' sections.
- `data-pipeline/src/normalize/rarity.ts` — extend the
  `bulbapedia-en` rarity table with the rows in "Rarity
  normalization registry (additions)" above.

## Acceptance criteria

- [ ] Adapter implements `SourceAdapter`; declares
      `name: 'bulbapedia-en'`, `language: 'en'`, `tier: 'filler'`.
      (typecheck + an explicit test asserts the values).
- [ ] `createBulbapediaAdapter` accepts a `RateLimitedClient` (host
      enforced to `bulbapedia.bulbagarden.net`); refuses other hosts
      via the existing `RateLimitedClient` host check.
- [ ] `bulbapediaSetToRaw` covers every documented field in the Set
      mapping table; round-trip through `rawSetSchema` for every
      fixture set.
- [ ] `bulbapediaCardToRaw` covers every documented field in the Card
      mapping table; round-trip through `rawCardSchema` for every
      fixture card.
- [ ] `bulbapediaCardToPrintings` produces:
  - 3 printings for `Charizard (Base Set 4)` (Holo Unlimited, Holo
    Shadowless, Holo Shadowless 1st Edition); classified `HOLO` w/
    flags including `FIRST_EDITION` + `SHADOWLESS`, `SHADOWLESS`
    alone, and the plain Unlimited carrying the `UNLIMITED` flag via
    `extra.isUnlimited = true`.
  - 1 printing classified `RAINBOW` for the Charizard VSTAR Rainbow
    fixture (rarity `Rainbow Rare`).
  - 1 printing classified `PROMO` for the SWSH staff promo fixture,
    with the `STAMPED_STAFF` flag.
- [ ] Wikitext infobox parser tests pass for nested templates,
      multi-line params, link stripping, italics stripping, and the
      "Release information" sub-template family.
- [ ] Adapter integration tests cover happy path,
      404 → empty, MediaWiki `missing: true` → empty, 429 →
      RateLimitError after retries, malformed JSON → PermanentError;
      all pass without live network.
- [ ] Resolver-integration test feeds the adapter (via shim) into
      `resolveCanonicalSets` alongside a fake primary; asserts the
      filler tier contributes `series` / `printedTotal` only when
      the primary leaves them null.
- [ ] Rarity registry has the new bulbapedia-en entries from the
      table above; covered by tests in
      `data-pipeline/src/normalize/rarity.test.ts` OR a test in the
      adapter folder (whichever is closest to the data).
- [ ] Variant raw signals (is_holo, is_reverse_holo, is_rainbow_rare,
      is_first_edition, is_shadowless, is_trainer_gallery, is_promo)
      populated correctly so `classifyVariant` produces the expected
      variant_class for every named fixture above. The
      `extra.isUnlimited = true` signal flows through to the
      classifier's `UNLIMITED` flag for the Base Set Unlimited
      printing.
- [ ] Set-code mapping table joins every fixture set's emitted
      `code` to the corresponding TCGdex EN set code (`base1`,
      `swsh9`, `swshp`).
- [ ] User-Agent header is asserted on every recorded request in
      adapter tests.
- [ ] `pnpm --filter @binderly/data-pipeline build typecheck lint
      format:check test` clean.
- [ ] No file modified outside
      `data-pipeline/src/adapters/bulbapedia/`,
      `data-pipeline/src/adapters/index.ts` (1-line uncomment), and
      `data-pipeline/src/normalize/rarity.ts` (registry extension is
      in scope per the task instructions).

## Out of scope

- **Bulbapedia hosted images:** never written to `imageSourceUrl`
  (CC-BY-NC-SA license incompatibility). Image rehosting is owned by
  `T-DL-IMAGE-PIPELINE`, which sources from the primary tier
  (TCGdex EN) for English cards.
- **Prose** — flavor text, set descriptions, "Trivia" sections,
  card-text reproductions: out of scope. Prose is what falls under
  Bulbapedia's commercial-reuse restriction.
- **Attacks / weakness / resistance:** these live in interleaved
  prose on Bulbapedia card pages. Extracting them reliably across
  eras is a separate (much larger) parser project. The primary
  source carries them; filler does not need to.
- **Multi-language card name discovery beyond `jname`:** Bulbapedia
  English card pages routinely list the Japanese name (we surface
  it). Other languages (`German`, `French`, …) are inconsistently
  present; out of scope for this iteration. The JP adapter and
  future EU adapters fill those.
- **Pricing:** never scraped from Bulbapedia. Pricing pipeline owns
  it.
- **Per-set master-set rules:** `master_set_rules` is left empty
  (`{}`) on the canonical set; the master-set rules engine
  populates it later.
- **Pattern variants** (Cosmos / Galaxy / Poké Ball / Master Ball
  reverse-holos): Bulbapedia does not surface a stable pattern
  signal; ptcgio is the source for these.
- **Texture variant detection:** Bulbapedia does not carry it.
- **Error / misprint cards:** Bulbapedia models them as standalone
  pages (e.g. "Charizard (Base Set 4) (error printing)"). The
  adapter does not enumerate or fetch these in this iteration; a
  follow-up task can extend coverage.
- **Live capture of Bulbapedia content as test fixtures:**
  Bulbapedia has a documented hostility toward UA-less or
  high-volume scrapers. The adapter intentionally does not perform
  bulk fixture capture from CI / dev. Fixtures used in tests are
  authored to faithfully match Bulbapedia's documented infobox
  template format and sized to exercise every variant branch the
  transform supports — they are NOT live-captured from the wiki at
  test time. Production runs still go through the live API.

## Branch & PR

- Branch: `agent/T-DL-SOURCE-BULBAPEDIA`
- PR title: `T-DL-SOURCE-BULBAPEDIA: Bulbapedia adapter (validation/filler)`
- Commit format: Conventional Commits.
  - `docs(tasks): elaborate T-DL-SOURCE-BULBAPEDIA`
  - `feat(data-pipeline): Bulbapedia adapter (T-DL-SOURCE-BULBAPEDIA)`

## Escalation triggers

Stop and append to `open-questions.md` if:

- Bulbapedia infobox shapes vary so much across eras that one
  parser can't handle them — propose splitting (e.g. vintage parser
  vs modern parser) before implementing.
- Bulbapedia returns the rendered HTML (`action=parse`) reliably
  while the wikitext API rate-limits more aggressively in practice
  — re-evaluate the parsing-strategy choice.
- A required field is unreliably present such that filler tier
  *cannot* contribute — flag for the orchestrator (filler-tier is
  fine for nullable fields by design; this is escalation territory
  only if EVERY field we promised to fill turns out unreliable).
- The Bulbapedia → TCGdex set-code mapping requires more than ~150
  entries to be useful — propose deferring full set coverage and
  shipping a small representative table first.

## Notes from execution

_(empty until the sub-agent runs)_
